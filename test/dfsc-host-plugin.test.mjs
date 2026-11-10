import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { downloadEnvironment, independentEnvironment, prepareHostLaunch } from "../plugins/bilibili-video-research/server/host-config.mjs";
import { parseHostDeclaration } from "../plugins/bilibili-video-research/server/host-client/protocol.mjs";
import { hostLaunch } from "./dfsc-launch.mjs";

const execute = promisify(execFile);
async function runtime(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "bvr-generic-launch-")));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5 }));
  await mkdir(join(root, "src"));
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "bilibili-video-research-mcp", dfscHostApiVersion: 1 }));
  await writeFile(join(root, "src", "index.ts"), "");
  for (const name of ["tsx", "dotenv", "@modelcontextprotocol/sdk", "ffmpeg-static", "yt-dlp-exec"]) {
    const path = join(root, "node_modules", name);
    await mkdir(path, { recursive: true });
    await writeFile(join(path, "package.json"), JSON.stringify({ name, main: "index.mjs",
      ...(name === "@modelcontextprotocol/sdk" ? { exports: { "./server/index.js": "./index.mjs" } } : {}) }));
    await writeFile(join(path, "index.mjs"), "");
  }
  return root;
}
const independent = () => ({
  revision: "f".repeat(64),
  values: { provider: "stepfun", base_url: "https://api.stepfun.com/step_plan/v1", model: "step-5-preview",
    asr_base_url: "https://api.stepfun.ai/v1", asr_model: "stepaudio-2.5-asr" },
  secrets: { api_key: "independent-main-key", asr_api_key: "independent-asr-key" },
});

test("the candidate uses the public host declaration and a separate independent connection schema", async () => {
  const directory = new URL("../plugins/bilibili-video-research/", import.meta.url);
  const manifest = JSON.parse(await readFile(new URL("step.plugin.json", directory), "utf8"));
  const declaration = JSON.parse(await readFile(new URL("dfsc.host.json", directory), "utf8"));
  const schema = JSON.parse(await readFile(new URL("dfsc.settings.json", directory), "utf8"));
  assert.deepEqual(parseHostDeclaration(declaration, manifest).capabilities, ["model.text", "model.video", "model.asr"]);
  assert.deepEqual(schema.consumer, { kind: "json-file-v1", server: "bvr" });
  assert.equal(schema.groups.find(group => group.id === "asr").fields.some(field => field.id === "asr_api_key" && field.type === "secret"), true);
});

test("native follow launch ignores old opt-in, nonexistent private files and all inherited provider credentials", async t => {
  const runtimeDirectory = await runtime(t);
  const launch = hostLaunch();
  const prepared = await prepareHostLaunch({ runtimeDirectory, mode: "independent", envFile: join(runtimeDirectory, "missing-private.env") },
    launch, { PATH: "safe-path", STEPFUN_API_KEY: "desktop-key", GEMINI_API_KEY: "other-key",
      BVR_DFSC_TOKEN: "legacy-token", NODE_OPTIONS: "--require malicious.js", DFSC_LAUNCH_CONTEXT: "wrong-parent" });
  assert.equal(prepared.environment.PATH, "safe-path");
  for (const name of ["STEPFUN_API_KEY", "STEPFUN_BASE_URL", "GEMINI_API_KEY", "BVR_DFSC_TOKEN", "BVR_DFSC_MODE", "NODE_OPTIONS"])
    assert.equal(prepared.environment[name], undefined);
  assert.deepEqual(JSON.parse(prepared.environment.DFSC_LAUNCH_CONTEXT), launch);
  await assert.rejects(prepareHostLaunch({ runtimeDirectory }, launch, {}, independent()), /must not read independent/);
});

test("independent launch uses only its exact committed revision and does not carry a broker", async t => {
  const runtimeDirectory = await runtime(t), configuration = independent();
  const launch = hostLaunch({ mode: "independent", configurationRevision: configuration.revision, broker: undefined });
  const prepared = await prepareHostLaunch({ runtimeDirectory }, launch, { STEPFUN_API_KEY: "desktop-key" }, configuration);
  assert.equal(prepared.environment.STEPFUN_API_KEY, "independent-main-key");
  assert.equal(prepared.environment.STEPFUN_ASR_API_KEY, "independent-asr-key");
  assert.equal(prepared.environment.STEPFUN_BASE_URL, "https://api.stepfun.com/step_plan/v1");
  assert.equal(prepared.environment.STEPFUN_ASR_BASE_URL, "https://api.stepfun.ai/v1");
  assert.equal(JSON.parse(prepared.environment.DFSC_LAUNCH_CONTEXT).broker, undefined);
  await assert.rejects(prepareHostLaunch({ runtimeDirectory }, launch, {}, { ...configuration, revision: "0".repeat(64) }), /revision changed/);
  await assert.rejects(prepareHostLaunch({ runtimeDirectory }, launch, {}), /revision changed/);
});

test("ASR partial settings and wrong providers fail rather than borrow the main model key", () => {
  for (const field of ["asr_base_url", "asr_model", "asr_api_key"]) {
    const configuration = independent();
    delete configuration[field === "asr_api_key" ? "secrets" : "values"][field];
    assert.throws(() => independentEnvironment(configuration), /all three/);
  }
  const configuration = independent();
  configuration.values = { provider: "stepfun", base_url: "https://api.stepfun.com/v1", model: "step-5-preview" };
  configuration.secrets = { api_key: "main-key" };
  const environment = independentEnvironment(configuration);
  assert.equal(environment.STEPFUN_ASR_API_KEY, "");
  assert.equal(environment.STEPFUN_ASR_BASE_URL, "");
  configuration.values.provider = "gemini";
  assert.equal(independentEnvironment(configuration).GEMINI_API_KEY, "main-key");
  configuration.values.provider = "unknown";
  assert.throws(() => independentEnvironment(configuration), /explicitly/);
  const mixed = independent();
  mixed.values.provider = "gemini";
  assert.throws(() => independentEnvironment(mixed), /Gemini main model/);
});

test("follow-mode download settings are explicitly separated from independent model secrets", async t => {
  const runtimeDirectory = await runtime(t);
  const prepared = await prepareHostLaunch({ runtimeDirectory, downloads: {
    cookies_file: join(runtimeDirectory, "cookies.txt"), http_proxy: "http://127.0.0.1:7897", prefer_captions: false,
  } }, hostLaunch(), {});
  assert.equal(prepared.environment.BILIBILI_COOKIES_FILE, join(runtimeDirectory, "cookies.txt"));
  assert.equal(prepared.environment.HTTP_PROXY, "http://127.0.0.1:7897");
  assert.equal(prepared.environment.BILIBILI_PREFER_CAPTIONS, "false");
  assert.throws(() => downloadEnvironment({ api_key: "must-not-be-used" }, true), /credentials/);
  assert.throws(() => downloadEnvironment({ http_proxy: "file:///private" }, true), /HTTP/);
  assert.throws(() => downloadEnvironment({ cookies_file: "relative" }, true), /absolute/);
});

test("wrong identities and old BVR runtimes cannot be repaired using legacy credentials", async t => {
  const runtimeDirectory = await runtime(t);
  await assert.rejects(prepareHostLaunch({ runtimeDirectory }, hostLaunch({ consumer: "other" }), {}), /INVALID_REQUEST/);
  await writeFile(join(runtimeDirectory, "package.json"), JSON.stringify({ name: "bilibili-video-research-mcp" }));
  await assert.rejects(prepareHostLaunch({ runtimeDirectory }, hostLaunch(), {}), /Update the separate BVR runtime/);
});

test("invalid generic startup is sticky after consumption and cannot turn into standalone key fallback", async () => {
  const script = `
    const { followsDfsc } = await import('./src/dfsc.ts');
    for (let n = 0; n < 2; n++) {
      try { followsDfsc(); process.exit(3); }
      catch (error) { if (!/^dfsc-host:/.test(error.message)) process.exit(4); }
    }
    if (process.env.DFSC_LAUNCH_CONTEXT !== undefined) process.exit(5);
  `;
  const result = await execute(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
    cwd: new URL("..", import.meta.url), timeout: 10000,
    env: { ...process.env, DFSC_LAUNCH_CONTEXT: '{"accidental-secret":"do-not-echo"}', STEPFUN_API_KEY: "desktop-secret" },
  });
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
});
