import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { hostLaunch } from "./dfsc-launch.mjs";
import {
  configurationRevision, isolatedEnvironment, pluginRoot, prepareLaunch, readConfiguration, validateProvider,
} from "../plugins/bilibili-video-research/server/config.mjs";

const execute = promisify(execFile);
const repository = dirname(dirname(fileURLToPath(import.meta.url)));
const api = {
  CODEX_VIDEO_PROVIDER: "stepfun", STEPFUN_API_KEY: "bvr-test-key",
  STEPFUN_BASE_URL: "https://api.stepfun.com/v1",
};

async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "bvr-dfsc-test-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const runtime = join(root, "runtime with spaces");
  await mkdir(join(runtime, "src"), { recursive: true });
  await writeFile(join(runtime, "package.json"), JSON.stringify({ name: "bilibili-video-research-mcp", type: "module", dfscHostApiVersion: 1 }));
  await writeFile(join(runtime, "src", "index.ts"),
    `process.stdout.write(JSON.stringify({provider:process.env.CODEX_VIDEO_PROVIDER,key:process.env.STEPFUN_API_KEY,base:process.env.STEPFUN_BASE_URL,foreign:process.env.GEMINI_API_KEY,inject:process.env.NODE_OPTIONS,envFile:process.env.DOTENV_CONFIG_PATH,override:process.env.DOTENV_CONFIG_OVERRIDE,quiet:process.env.DOTENV_CONFIG_QUIET,configPath:process.env.BVR_DFSC_SETUP_PATH,revision:process.env.BVR_DFSC_SETUP_REVISION,mode:JSON.parse(process.env.DFSC_LAUNCH_CONTEXT).mode,legacyToken:process.env.BVR_DFSC_TOKEN,cwd:process.cwd()}));`);
  for (const dependency of ["tsx", "dotenv", "@modelcontextprotocol/sdk", "ffmpeg-static", "yt-dlp-exec"]) {
    const directory = join(runtime, "node_modules", dependency);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "package.json"), JSON.stringify({
      name: dependency, main: "index.mjs",
      ...(dependency === "@modelcontextprotocol/sdk" ? { exports: { "./server/index.js": "./index.mjs" } } : {}),
    }));
    await writeFile(join(directory, "index.mjs"), "");
  }
  const envFile = join(root, "private provider.env");
  await writeFile(envFile, Object.entries(api).map(([key, value]) => `${key}=${value}`).join("\n"));
  const config = { schemaVersion: 1, runtimeDirectory: runtime, envFile };
  return { root, runtime, envFile, config };
}

test("DFSC manifest declares real resources and no install hook", async () => {
  const manifest = JSON.parse(await readFile(join(pluginRoot, "step.plugin.json"), "utf8"));
  assert.equal(manifest.id, "bilibili-video-research");
  assert.equal(manifest.version, "0.2.0");
  assert.deepEqual(manifest.skills, ["skills"]);
  assert.deepEqual(manifest.commands, ["commands"]);
  assert.equal(manifest.entry, undefined);
  assert.equal(manifest.provision, undefined);
  assert.deepEqual(manifest.mcpServers.bvr.args, ["server/start.mjs"]);
  assert.deepEqual(manifest.mcpServers.bvr.env, { STEPFUN_API_KEY: "DFSC_INDEPENDENT_PLUGIN" });
  assert.equal(manifest.mcpServers.bvr.tool_timeout_sec, 600);
  for (const path of ["commands/bvr.md", "skills/bilibili-video-research/SKILL.md", "server/start.mjs", "LICENSE"])
    assert.ok((await stat(join(pluginRoot, path))).isFile());
  const icon = await readFile(join(pluginRoot, manifest.icon));
  assert.deepEqual(icon.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  assert.ok(icon.length <= 128 * 1024);
  assert.ok(icon.readUInt32BE(16) <= 512 && icon.readUInt32BE(20) <= 512);
  const skill = await readFile(join(pluginRoot, "skills/bilibili-video-research/SKILL.md"), "utf8");
  assert.match(skill, /bilibili-video-research__bvr/);
  assert.doesNotMatch(skill, /codex_video|mcp__codex/);
});

test("DFSC presentation declares reviewed classification, bilingual docs and safe author links", async () => {
  const bytes = await readFile(join(pluginRoot, "dfsc.plugin.json"));
  assert.ok(bytes.length <= 64 * 1024);
  const presentation = JSON.parse(bytes.toString("utf8"));
  assert.equal(presentation.schemaVersion, 1);
  assert.deepEqual(presentation.categories, ["research", "audio-video"]);
  assert.deepEqual(presentation.keywords, ["视频研究", "字幕", "语音转写"]);
  assert.equal(presentation.stars, undefined, "Stars must come from live repository metadata, not author claims");
  assert.deepEqual(Object.keys(presentation.locales).sort(), ["en", "zh"]);
  const documents = new Set([presentation.documentation.readme]);
  for (const locale of Object.values(presentation.locales)) {
    assert.ok(locale.description.trim().length > 0 && locale.description.length <= 2048);
    documents.add(locale.documentation.readme);
  }
  assert.deepEqual([...documents].sort(), ["docs/DFSC.en.md", "docs/DFSC.md"]);
  for (const path of documents) {
    assert.match(path, /^docs\/[a-zA-Z0-9.-]+\.md$/);
    const guide = await readFile(join(pluginRoot, path), "utf8");
    assert.ok(guide.includes("/bvr"));
    assert.ok(guide.includes("../README.md"), "Keep the market-maintained technical guide reachable");
  }
  assert.equal(presentation.tutorials.length, 1);
  assert.equal(presentation.tutorials[0].kind, "community");
  assert.ok(presentation.tutorials[0].creator.trim());
  for (const link of [...presentation.tutorials, ...presentation.links]) {
    const url = new URL(link.url);
    assert.equal(url.protocol, "https:");
    assert.equal(url.username, "");
    assert.equal(url.password, "");
    assert.ok(link.title.trim().length > 0 && link.title.length <= 160);
  }
  for (const link of presentation.links) assert.deepEqual(Object.keys(link).sort(), ["title", "url"]);
});

test("DFSC requirements declare the verified host and actual external preparation", async () => {
  const presentation = JSON.parse(await readFile(join(pluginRoot, "dfsc.plugin.json"), "utf8"));
  const runtime = JSON.parse(await readFile(join(repository, "package.json"), "utf8"));
  const requirements = presentation.requirements;
  assert.ok(requirements, "Declare requirements in metadata, not only in the README");
  assert.deepEqual(Object.keys(requirements).sort(), ["dfsc", "external"]);
  assert.equal(requirements.dfsc, "0.6.0", "Do not claim unverified future host versions");
  assert.equal(runtime.engines.node, ">=24");
  assert.equal(runtime.dfscHostApiVersion, 1);
  assert.deepEqual(requirements.external.map(item => [item.name, item.optional]), [
    ["Node.js 24+", false],
    ["BVR 本体与依赖", false],
    ["模型访问与额度", false],
    ["Bilibili Cookie（按需）", true],
  ]);
  for (const item of requirements.external) {
    assert.deepEqual(Object.keys(item).sort(), ["description", "name", "optional", "url"]);
    assert.ok(item.name.length > 0 && item.name.length <= 160);
    assert.ok(item.description.length > 0 && item.description.length <= 512);
    assert.doesNotMatch(item.name + item.description, /[\u0000-\u001f]/);
    assert.ok(item.url.length <= 2048);
    const url = new URL(item.url);
    assert.equal(url.href, item.url, "Use canonical URLs so native projection preserves the declaration");
    assert.equal(url.protocol, "https:");
    assert.equal(url.username, "");
    assert.equal(url.password, "");
  }
  const bvr = requirements.external[1];
  assert.match(bvr.description, /dfscHostApiVersion: 1/);
  assert.match(bvr.description, /npm ci/);
  assert.match(bvr.description, /FFmpeg.*yt-dlp/);
  assert.match(requirements.external[2].description, /ASR/);
  assert.match(requirements.external[3].description, /不绕过/);
  for (const path of ["README.md", "docs/DFSC.md", "docs/DFSC.en.md"]) {
    const guide = await readFile(join(pluginRoot, path), "utf8");
    assert.ok(guide.includes(requirements.dfsc), "Keep the declared host version visible in both guides");
    assert.ok(guide.includes("dcab32806645502250ba1c8efd56e153e95d657b"),
      "Identify the tested build instead of treating matching versions as feature detection");
    assert.ok(guide.includes("FFmpeg") && guide.includes("yt-dlp"));
  }
});

test("the three supported provider routes must be selected explicitly", () => {
  assert.deepEqual(validateProvider(api), { provider: "stepfun", channel: "api" });
  assert.deepEqual(validateProvider({ ...api, STEPFUN_BASE_URL: "https://api.stepfun.com/step_plan/v1/" }),
    { provider: "stepfun", channel: "plan" });
  assert.deepEqual(validateProvider({ CODEX_VIDEO_PROVIDER: "gemini", GEMINI_API_KEY: "gemini-test" }),
    { provider: "gemini", channel: "gemini-api" });
});

test("missing, mismatched and custom configuration does not default to API or another provider", () => {
  for (const configured of [
    {}, { ...api, CODEX_VIDEO_PROVIDER: "" }, { ...api, STEPFUN_API_KEY: "" },
    { ...api, STEPFUN_BASE_URL: "" }, { ...api, STEPFUN_BASE_URL: "http://api.stepfun.com/v1" },
    { ...api, STEPFUN_BASE_URL: "https://example.invalid/v1" },
    { CODEX_VIDEO_PROVIDER: "gemini", STEPFUN_API_KEY: "wrong-provider" },
    { CODEX_VIDEO_PROVIDER: "other", GEMINI_API_KEY: "wrong-provider" },
  ]) assert.throws(() => validateProvider(configured));
});

test("DFSC credentials, Cookie settings and Node injection are not inherited", () => {
  const inherited = {
    Path: "fixture-path", HOME: "/isolated-dfsc", TEMP: "/tmp",
    STEPFUN_API_KEY: "desktop-login-secret", GEMINI_API_KEY: "foreign-secret",
    BILIBILI_COOKIES_FILE: "foreign-cookie", NODE_OPTIONS: "--require evil.cjs",
    ELECTRON_RUN_AS_NODE: "1", DOTENV_CONFIG_PATH: "foreign.env",
  };
  const result = isolatedEnvironment(inherited, { ...api, NODE_OPTIONS: "--require other.cjs" });
  assert.equal(result.Path, "fixture-path");
  assert.equal(result.HOME, "/isolated-dfsc");
  assert.equal(result.STEPFUN_API_KEY, "bvr-test-key");
  for (const key of ["GEMINI_API_KEY", "BILIBILI_COOKIES_FILE", "NODE_OPTIONS", "ELECTRON_RUN_AS_NODE", "DOTENV_CONFIG_PATH"])
    assert.equal(result[key], undefined);
});

test("private configuration, including paths containing spaces, produces a pinned launch", async t => {
  const { config, runtime, envFile } = await fixture(t);
  const launch = await prepareLaunch(config, { STEPFUN_API_KEY: "desktop-secret", DOTENV_CONFIG_PATH: "foreign.env" });
  assert.equal(launch.provider, "stepfun");
  assert.equal(launch.channel, "api");
  assert.equal(launch.runtimeDirectory, runtime);
  assert.equal(launch.environment.STEPFUN_API_KEY, "bvr-test-key");
  assert.equal(launch.environment.DOTENV_CONFIG_PATH, envFile);
  assert.equal(launch.environment.DOTENV_CONFIG_OVERRIDE, "");
  assert.equal(launch.environment.DOTENV_CONFIG_QUIET, "true");
  assert.equal(launch.args[0], "--import");
  assert.equal(launch.args[2], join(runtime, "src", "index.ts"));
});

test("missing private key cannot be filled from DFSC's environment", async t => {
  const { config, envFile } = await fixture(t);
  await writeFile(envFile, "CODEX_VIDEO_PROVIDER=stepfun\nSTEPFUN_BASE_URL=https://api.stepfun.com/step_plan/v1\n");
  await assert.rejects(prepareLaunch(config, { STEPFUN_API_KEY: "desktop-secret" }), /Set STEPFUN_API_KEY/);
});

test("invalid configuration is bounded and does not echo secret-bearing JSON", async t => {
  const { root, config } = await fixture(t);
  for (const value of [
    null, {}, { ...config, schemaVersion: 99 }, { ...config, runtimeDirectory: "relative" },
    { ...config, envFile: "relative.env" }, { ...config, unknown: "accidental-secret" },
  ]) await assert.rejects(prepareLaunch(value), /BVR config must/);
  const path = join(root, "invalid.json");
  await writeFile(path, 'not-json accidental-secret');
  await assert.rejects(readConfiguration(path), error => /not configured/.test(error.message) && !error.message.includes("accidental-secret"));
  await writeFile(path, " ".repeat(64 * 1024 + 1));
  await assert.rejects(readConfiguration(path), /not configured/);
});

test("an uninstalled runtime reports a setup error without invoking npm", async t => {
  const { config, runtime } = await fixture(t);
  await rm(join(runtime, "node_modules"), { recursive: true });
  await assert.rejects(prepareLaunch(config), /npm ci completed/);
});

test("a copied plugin uses its native follow mode, ignoring legacy mode and all old provider credentials", async t => {
  const { root, runtime, envFile, config } = await fixture(t);
  const profile = join(root, "profile");
  const installed = join(profile, "plugins", "bilibili-video-research");
  await cp(pluginRoot, installed, { recursive: true });
  await mkdir(join(profile, "bvr"), { recursive: true });
  await writeFile(join(profile, "bvr", "config.json"), JSON.stringify(config));
  const result = await execute(process.execPath, [join(installed, "server", "start.mjs")], {
    cwd: root, timeout: 15_000,
    env: { ...process.env, DFSC_LAUNCH_CONTEXT: JSON.stringify(hostLaunch()),
      STEPFUN_API_KEY: "desktop-secret", GEMINI_API_KEY: "foreign-secret", BVR_DFSC_TOKEN: "old-token" },
  });
  const output = JSON.parse(result.stdout);
  assert.equal(result.stderr, "");
  assert.equal(output.key, undefined);
  assert.equal(output.mode, "follow");
  assert.equal(output.legacyToken, undefined);
  assert.equal(output.foreign, undefined);
  assert.equal(output.cwd, runtime);
  assert.equal(output.envFile, process.platform === "win32" ? "NUL" : "/dev/null");
  assert.equal(output.override, "");
  assert.equal(output.quiet, "true");
  assert.equal(output.configPath, join(profile, "bvr", "config.json"));
  const { createHash } = await import("node:crypto");
  assert.equal(output.revision, createHash("sha256").update(await readFile(output.configPath)).digest("hex"));
});

test("launcher fails closed without private setup and writes no protocol output", async t => {
  const { root } = await fixture(t);
  const installed = join(root, "profile", "plugins", "bilibili-video-research");
  await cp(pluginRoot, installed, { recursive: true });
  await assert.rejects(execute(process.execPath, [join(installed, "server", "start.mjs")], {
    timeout: 10_000, env: { ...process.env, STEPFUN_API_KEY: "desktop-secret" },
  }), error => error.code === 1 && error.stdout === "" && /HOST_UNAVAILABLE/.test(error.stderr)
    && !error.stderr.includes("desktop-secret"));
});

test("native launcher rejects oversized runtime setup before starting a child", async t => {
  const { root } = await fixture(t);
  const profile = join(root, "profile");
  const installed = join(profile, "plugins", "bilibili-video-research");
  await cp(pluginRoot, installed, { recursive: true });
  await mkdir(join(profile, "bvr"), { recursive: true });
  await writeFile(join(profile, "bvr", "config.json"), " ".repeat(65537));
  await assert.rejects(execute(process.execPath, [join(installed, "server", "start.mjs")], {
    timeout: 10_000, env: { ...process.env, DFSC_LAUNCH_CONTEXT: JSON.stringify(hostLaunch()) },
  }), error => error.code === 1 && error.stdout === "" && /too large/.test(error.stderr));
});

test("legacy configuration flags cannot select a new mode or import credentials", async t => {
  const { root, runtime, envFile } = await fixture(t);
  for (const option of [["--mode", "dfsc"], ["--env-file", envFile]]) {
    await assert.rejects(execute(process.execPath, [join(pluginRoot, "server", "configure.mjs"),
      "--profile", join(root, "profile"), "--runtime", runtime, ...option], { timeout: 10_000 }),
    error => error.code === 1 && /no legacy authorization or key is migrated/.test(error.stderr));
  }
  await assert.rejects(stat(join(root, "profile", "bvr", "config.json")), { code: "ENOENT" });
});

test("real dotenv cannot change the pinned file or enable protocol-breaking logs", async t => {
  const { config, envFile } = await fixture(t);
  await writeFile(envFile, [
    ...Object.entries(api).map(([key, value]) => `${key}=${value}`),
    "DOTENV_CONFIG_PATH=foreign.env", "DOTENV_CONFIG_QUIET=false", "DOTENV_CONFIG_OVERRIDE=true", "DOTENV_CONFIG_DEBUG=true",
  ].join("\n"));
  const launch = await prepareLaunch(config);
  const require = createRequire(import.meta.url);
  const result = await execute(process.execPath, [
    "-r", require.resolve("dotenv/config"), "-e",
    "process.stdout.write(JSON.stringify({path:process.env.DOTENV_CONFIG_PATH,quiet:process.env.DOTENV_CONFIG_QUIET,override:process.env.DOTENV_CONFIG_OVERRIDE,debug:process.env.DOTENV_CONFIG_DEBUG}));",
  ], { env: launch.environment, timeout: 10_000 });
  const output = JSON.parse(result.stdout);
  assert.equal(output.path, envFile);
  assert.equal(output.quiet, "true");
  assert.equal(output.override, "");
  assert.equal(output.debug, "");
  assert.equal(result.stderr, "");
});

test("configuration tool saves paths only, refuses overwrites and survives resource reinstall", async t => {
  const { root, runtime, envFile } = await fixture(t);
  const profile = join(root, "profile");
  const args = [join(pluginRoot, "server", "configure.mjs"),
    "--profile", profile, "--runtime", runtime];
  const result = await execute(process.execPath, args, { timeout: 10_000 });
  assert.match(result.stdout, /No credentials were copied/);
  const path = join(profile, "bvr", "config.json");
  const original = await readFile(path, "utf8");
  assert.ok(!original.includes("bvr-test-key"));
  await assert.rejects(execute(process.execPath, args), error => /already exists/.test(error.stderr));
  await execute(process.execPath, [...args, "--replace"]);
  const installed = join(profile, "plugins", "bilibili-video-research");
  await cp(pluginRoot, installed, { recursive: true });
  const checked = await execute(process.execPath, [join(installed, "server", "start.mjs"), "--check"]);
  assert.match(checked.stdout, /runtime configuration OK/);
  assert.ok(!checked.stdout.includes("bvr-test-key"));
  await rm(installed, { recursive: true });
  await cp(pluginRoot, installed, { recursive: true });
  assert.equal(await readFile(path, "utf8"), original);
  assert.ok((await stat(envFile)).isFile());
});

test("the legacy setup can still locate the runtime but does not grant generic host authorization", async t => {
  const { root, runtime } = await fixture(t);
  const profile = join(root, "hosted profile");
  await execute(process.execPath, [join(pluginRoot, "server", "configure.mjs"),
    "--profile", profile, "--runtime", runtime], { timeout: 10000 });
  const config = JSON.parse(await readFile(join(profile, "bvr", "config.json"), "utf8"));
  assert.equal(config.schemaVersion, 3);
  assert.equal(config.mode, undefined);
  assert.equal(config.hostAccess, undefined);
  assert.equal(config.envFile, undefined);
  await assert.rejects(prepareLaunch(config, {}, { hostPath: join(profile, "bvr", "host.json") }), /BVR config must/);
  await assert.rejects(execute(process.execPath, [join(pluginRoot, "server", "configure.mjs"),
    "--profile", profile, "--runtime", runtime, "--mode", "dfsc", "--replace"]), /no legacy authorization/);
});

test("Follow DFSC strips keys and channel overrides and pins dotenv away from local .env", async t => {
  const { root, config, envFile } = await fixture(t);
  await writeFile(envFile, [
    ...Object.entries(api).map(([key, value]) => `${key}=${value}`),
    "GEMINI_API_KEY=foreign", "STEPFUN_VIDEO_MODEL=wrong-model", "BILIBILI_COOKIES_FILE=D:/private/cookies.txt",
  ].join("\n"));
  const hosted = { ...config, schemaVersion: 2, mode: "dfsc", hostAccess: "confirm" };
  const hostPath = join(root, "host.json");
  await writeFile(hostPath, JSON.stringify({ version: 1, url: "http://127.0.0.1:12345", token: "a".repeat(64) }));
  const launch = await prepareLaunch(hosted, { ...process.env, STEPFUN_API_KEY: "desktop-secret" }, { validateOnly: true });
  assert.equal(launch.environment.BVR_DFSC_MODE, "1");
  assert.equal(launch.environment.BVR_DFSC_RUNTIME_PID, undefined);
  for (const key of ["STEPFUN_API_KEY", "GEMINI_API_KEY", "STEPFUN_BASE_URL", "STEPFUN_VIDEO_MODEL"])
    assert.equal(launch.environment[key], undefined);
  assert.equal(launch.environment.BILIBILI_COOKIES_FILE, "D:/private/cookies.txt");
  assert.equal(launch.environment.DOTENV_CONFIG_PATH, process.platform === "win32" ? "NUL" : "/dev/null");
});

test("Follow DFSC refuses remote, malformed and credential-bearing host descriptors", async t => {
  const { root, config } = await fixture(t);
  const hosted = { schemaVersion: 2, mode: "dfsc", hostAccess: "confirm", runtimeDirectory: config.runtimeDirectory };
  const hostPath = join(root, "host.json");
  for (const url of ["https://example.com", "http://localhost:12345", "http://user:secret@127.0.0.1:12345", "http://127.0.0.1:12345/path"]) {
    await writeFile(hostPath, JSON.stringify({ version: 1, url, token: "a".repeat(64) }));
    await assert.rejects(prepareLaunch(hosted, {}, { hostPath }), /requires the generic DFSC/);
  }
});

test("configuration CLI rejects relative profiles and unknown options", async () => {
  for (const arguments_ of [[], ["--profile", "relative"], ["--api-key", "do-not-echo-this"]]) {
    await assert.rejects(execute(process.execPath, [join(pluginRoot, "server", "configure.mjs"), ...arguments_]),
      error => error.code === 1 && error.stdout === "" && !error.stderr.includes("do-not-echo-this"));
  }
});

test("market resource directory has no private state or dependency tree", async () => {
  const { readdir } = await import("node:fs/promises");
  for (const item of await readdir(pluginRoot, { recursive: true })) {
    assert.doesNotMatch(item.replaceAll("\\", "/"), /(^|\/)(?:\.env(?:\.|$)|node_modules|cookies\.txt|config\.json)(\/|$)/);
  }
  assert.ok((await stat(join(repository, "plugins", "bilibili-video-research", "provider.example"))).isFile());
});
