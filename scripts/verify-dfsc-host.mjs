import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { pluginRoot } from "../plugins/bilibili-video-research/server/config.mjs";

const execute = promisify(execFile), options = {};
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index], value = process.argv[index + 1];
  assert.ok(["--bridge-module", "--output"].includes(key) && !options[key] && isAbsolute(value ?? ""),
    "Use --bridge-module <compiled DFSC bvr-bridge.mjs> --output <new absolute directory>");
  options[key] = value;
}
assert.ok(options["--bridge-module"] && options["--output"]);
const output = resolve(options["--output"]);
await mkdir(output, { recursive: false });
const profile = join(output, "profile", "step-runtime");
const installed = join(profile, "plugins", "bilibili-video-research");
await mkdir(join(profile, "bvr"), { recursive: true });
await cp(pluginRoot, installed, { recursive: true });
const repository = dirname(dirname(fileURLToPath(import.meta.url)));
await execute(process.execPath, [join(installed, "server", "configure.mjs"),
  "--profile", profile, "--runtime", repository], { timeout: 15000 });
const require = createRequire(import.meta.url);
const video = join(output, "offline-video.mp4");
await execute(require("ffmpeg-static"), ["-hide_banner", "-loglevel", "error", "-f", "lavfi",
  "-i", "color=c=red:s=64x64:d=0.2", "-c:v", "libx264", video], { timeout: 15000 });
const { BvrBridge } = await import(pathToFileURL(options["--bridge-module"]).href);
let auth = { step: { type: "oauth", access: "fixture-host-key-never-exported", profile: "step_plan", expires: Number.MAX_SAFE_INTEGER } };
let fail = false, confirmations = 0;
const source = { id: "offline-resident-fixture", status: "connected", state: {
  sessionId: "offline-session", model: { provider: "step", id: "step-5-preview", input: ["text", "image"] },
}, rpc: { pid: process.pid, request: async () => source.state } };
const pool = { workers: new Map([[source.id, source]]), confirm: async () => { confirmations++; return true; } };
const calls = [];
const bridge = new BvrBridge(profile, pool, () => auth, () => false, () => "en", async (url, init) => {
  calls.push(String(url));
  const data = JSON.parse(init.body);
  assert.equal(data.model, "step-5-preview");
  assert.equal(data.messages[0].content[0].type, "video_url");
  assert.match(data.messages[0].content[0].video_url.url, /^data:video\/mp4;base64,/);
  return fail ? new Response("private fixture error", { status: 401 })
    : Response.json({ choices: [{ message: { content: "offline visual fixture result" } }] });
});
await bridge.start();
const client = new Client({ name: "bvr-host-offline-acceptance", version: "0.1.0" }, { capabilities: {} });
const transport = new StdioClientTransport({
  command: process.execPath, args: [join(installed, "server", "start.mjs")], cwd: installed,
  // These must not influence hosted routing or become credentials in the BVR child.
  env: { PATH: process.env.PATH ?? process.env.Path, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP,
    HOME: profile, USERPROFILE: profile, STEPFUN_API_KEY: "wrong-inherited-key",
    STEPFUN_BASE_URL: "https://example.invalid/v1", GEMINI_API_KEY: "wrong-provider-key" },
  stderr: "pipe",
});
let stderr = "";
transport.stderr?.on("data", chunk => { stderr += chunk; });
try {
  await client.connect(transport, { timeout: 30000 });
  const tools = await client.listTools();
  assert.equal(tools.tools.length, 3);
  const call = () => client.callTool({ name: "analyze_video", arguments: {
    video_path: video, question: "Describe the visible color", media_detail: "low",
  } }, undefined, { timeout: 30000 });
  const plan = await call();
  assert.notEqual(plan.isError, true);
  assert.match(JSON.stringify(plan), /offline visual fixture result/);
  fail = true;
  const denied = await call();
  assert.equal(denied.isError, true);
  assert.match(JSON.stringify(denied), /HTTP 401/);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(url => url === "https://api.stepfun.com/step_plan/v1/chat/completions"));
  fail = false;
  auth = { step: { ...auth.step, profile: "platform_oversea", access: "another-fixture-key" } };
  const api = await call();
  assert.notEqual(api.isError, true);
  assert.equal(calls.at(-1), "https://api.stepfun.ai/v1/chat/completions");
  assert.equal(confirmations, 2);
  auth = {};
  bridge.invalidate();
  const loggedOut = await call();
  assert.equal(loggedOut.isError, true);
  assert.equal(calls.length, 3);
  assert.doesNotMatch(JSON.stringify([plan, denied, api, loggedOut]), /fixture-host-key-never-exported|another-fixture-key|wrong-inherited-key/);
  assert.equal(stderr, "");
  const descriptor = await readFile(join(profile, "bvr", "host.json"), "utf8");
  assert.doesNotMatch(descriptor, /fixture-host-key/);
  const report = {
    realBvrMcpProcess: true, realStepRuntimeSession: false, nativeConsentFixture: true,
    realProviderRequests: false, checks: [
      "real launcher/MCP initialize/tools list",
      "real silent-video processing and host-routed tools/call",
      "Plan failure has no API fallback",
      "new research follows overseas API switch and asks again",
      "logout rejects tools/call without provider request",
      "provider credentials stay out of descriptor, child configuration and results",
    ],
    providerFixtureRoutes: calls,
  };
  await writeFile(join(output, "verification.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  await client.close();
  await bridge.stop();
}
