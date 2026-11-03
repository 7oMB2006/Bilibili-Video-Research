import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { isolatedEnvironment, pluginRoot } from "../plugins/bilibili-video-research/server/config.mjs";

const execute = promisify(execFile);
const repository = dirname(dirname(fileURLToPath(import.meta.url)));
const arguments_ = process.argv.slice(2);
const options = {};
for (let index = 0; index < arguments_.length; index += 2) {
  const key = arguments_[index];
  const value = arguments_[index + 1];
  assert.ok(["--desktop", "--output", "--marketplace", "--marketplace-name"].includes(key) && !options[key]
    && typeof value === "string" && value.length > 0
    && (!["--desktop", "--output", "--marketplace"].includes(key) || isAbsolute(value)),
    "Usage: node scripts/verify-dfsc-plugin.mjs --desktop <staged Desktop directory> --output <new directory> [--marketplace <absolute market directory> --marketplace-name <name>]");
  options[key] = value;
}
assert.ok(options["--desktop"] && options["--output"], "--desktop and --output are required");
assert.equal(Boolean(options["--marketplace"]), Boolean(options["--marketplace-name"]),
  "--marketplace and --marketplace-name must be supplied together");
const output = resolve(options["--output"]);
await mkdir(output, { recursive: false });
const desktop = resolve(options["--desktop"]);
const profile = join(output, "profile", "step-runtime");
const agentDir = join(profile, "agent");
const marketplace = options["--marketplace"] ?? join(output, "bvr-local-preview");
const marketplaceName = options["--marketplace-name"] ?? "bvr-local-preview";
const fixtureEnv = join(output, "fixture-provider.env");
await mkdir(agentDir, { recursive: true });
if (!options["--marketplace"]) {
  await mkdir(join(marketplace, ".step-plugin"), { recursive: true });
  await cp(pluginRoot, join(marketplace, "plugins", "bilibili-video-research"), { recursive: true });
  await writeFile(join(marketplace, ".step-plugin", "marketplace.json"), JSON.stringify({
    name: marketplaceName,
    plugins: [{ name: "bilibili-video-research", source: "./plugins/bilibili-video-research",
      description: "Local BVR companion preview. A separately configured runtime is required." }],
  }, null, 2));
}
await writeFile(fixtureEnv, [
  "CODEX_VIDEO_PROVIDER=stepfun", "STEPFUN_API_KEY=offline-fixture-not-a-real-key",
  "STEPFUN_BASE_URL=https://api.stepfun.com/step_plan/v1", "",
].join("\n"), { mode: 0o600 });

// Set isolation before importing the real DFSC/upstream management bundle.
const isolated = isolatedEnvironment(process.env, {});
for (const key of Object.keys(process.env)) delete process.env[key];
Object.assign(process.env, isolated, {
  HOME: profile, USERPROFILE: profile, STEPCODE_STORAGE_ROOT_DIR: profile,
  STEP_CODING_AGENT_DIR: agentDir, STEP_CODING_AGENT_SESSION_DIR: join(agentDir, "sessions"),
  STEPCODE_AUTH_PATH: join(agentDir, "auth.json"),
});
const upstream = await import(pathToFileURL(join(desktop, "runtime", "step", "dist", "bundle", "index.js")).href);
const { createCapabilitySettings } = await import(pathToFileURL(join(desktop, "runtime", "capability-settings.mjs")).href);
const manager = createCapabilitySettings(upstream, { root: profile });
const report = {
  kind: "local-unpublished-preview",
  marketplace: marketplaceName,
  marketplaceSource: marketplace,
  desktopRuntime: JSON.parse(await readFile(join(desktop, "runtime", "manifest.json"), "utf8")).commit,
  realProviderRequests: false,
  checks: [],
};
const check = name => report.checks.push(name);
await manager.mutate({ action: "marketplace-add", source: marketplace }, AbortSignal.timeout(30_000));
let catalog = await manager.catalog();
assert.ok(catalog.available.some(item => item.name === "bilibili-video-research" && item.marketplace === marketplaceName));
check("DFSC native marketplace discovery");
await manager.mutate({ action: "plugin-install", name: "bilibili-video-research", marketplace: marketplaceName },
  AbortSignal.timeout(30_000));
catalog = await manager.catalog();
const plugin = catalog.plugins.find(item => item.id === "bilibili-video-research");
assert.ok(plugin);
assert.equal(plugin.icon?.kind, "png");
assert.ok(catalog.mcp.some(item => item.name === "bilibili-video-research__bvr" && item.source === "plugin"));
assert.ok(catalog.skills.some(item => item.name === "bilibili-video-research" && item.source === "plugin"));
check("DFSC native install, PNG icon, skill and MCP declaration");
const resources = await upstream.discoverStepPluginResourcePaths({ userDir: join(profile, "plugins"), projectTrusted: false });
assert.deepEqual(resources.warnings, []);
const loader = new upstream.DefaultResourceLoader({
  cwd: output, agentDir, settingsManager: upstream.SettingsManager.inMemory(),
  noExtensions: true, noThemes: true, noContextFiles: true,
});
const resourcePaths = paths => paths.map(path => ({ path,
  metadata: { source: "plugin:bilibili-video-research", scope: "user", origin: "top-level", baseDir: profile } }));
loader.extendResources({ skillPaths: resourcePaths(resources.skillPaths), promptPaths: resourcePaths(resources.promptPaths) });
assert.ok(loader.getSkills().skills.some(item => item.name === "bilibili-video-research"));
assert.ok(loader.getPrompts().prompts.some(item => item.name === "bvr"));
check("Real DFSC resource loader resolves skill and /bvr prompt");
const installed = join(profile, "plugins", "bilibili-video-research");
await execute(process.execPath, [join(installed, "server", "configure.mjs"), "--profile", profile,
  "--runtime", repository, "--mode", "independent", "--env-file", fixtureEnv], { env: process.env, timeout: 15_000 });
const client = new Client({ name: "bvr-dfsc-offline-verification", version: "0.1.0" }, { capabilities: {} });
const transport = new StdioClientTransport({
  command: process.execPath, args: [join(installed, "server", "start.mjs")], cwd: installed,
  env: { ...process.env, STEPFUN_API_KEY: "desktop-credential-must-not-be-used" }, stderr: "pipe",
});
let stderr = "";
transport.stderr?.on("data", data => { stderr += data.toString(); });
try {
  await client.connect(transport, { timeout: 30_000 });
  const tools = await client.listTools({}, { timeout: 30_000 });
  report.tools = tools.tools.map(tool => tool.name).sort();
  assert.deepEqual(report.tools, ["analyze_bilibili_video", "analyze_video", "inspect_video_window"]);
  assert.equal(stderr, "");
  check("Real BVR process: MCP initialize and three tool declarations (no tools/call)");
} finally {
  await client.close();
}
const saved = await readFile(join(profile, "bvr", "config.json"), "utf8");
await manager.mutate({ action: "plugin-remove", id: "bilibili-video-research" }, AbortSignal.timeout(30_000));
assert.ok(!(await manager.catalog()).plugins.some(item => item.id === "bilibili-video-research"));
assert.equal(await readFile(join(profile, "bvr", "config.json"), "utf8"), saved);
assert.ok((await stat(fixtureEnv)).isFile());
check("Native uninstall preserves independent config and environment file");
await manager.mutate({ action: "plugin-install", name: "bilibili-video-research", marketplace: marketplaceName },
  AbortSignal.timeout(30_000));
const result = await execute(process.execPath, [join(installed, "server", "start.mjs"), "--check"], { env: process.env });
assert.match(result.stdout, /stepfun \/ plan/);
check("Native reinstall keeps explicit Plan selection");
await writeFile(join(output, "verification.json"), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
