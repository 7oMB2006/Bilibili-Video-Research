import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { EventEmitter, once } from "node:events";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { pluginRoot } from "../plugins/bilibili-video-research/server/config.mjs";

assert.equal(process.argv[2], "--desktop-root", "Use --desktop-root <absolute candidate DFSC checkout>");
assert.equal(process.argv.length, 4);
assert.ok(isAbsolute(process.argv[3]));
const desktop = resolve(process.argv[3], "Desktop/electron");
const [{ PluginHostBroker }, { StepPluginHostProvider }, { PluginHostBindingStore },
  { PluginConfigurationStore }, files] = await Promise.all([
  import(pathToFileURL(join(desktop, "plugin-host-broker.ts")).href),
  import(pathToFileURL(join(desktop, "plugin-host-step.ts")).href),
  import(pathToFileURL(join(desktop, "plugin-host-contract.mjs")).href),
  import(pathToFileURL(join(desktop, "plugin-configuration.mjs")).href),
  import(pathToFileURL(join(desktop, "plugin-files.mjs")).href),
]);
const repository = dirname(dirname(fileURLToPath(import.meta.url)));
const root = await realpath(await mkdtemp(join(tmpdir(), "bvr-generic-broker-")));
const installed = join(root, "plugins", "bilibili-video-research");
let broker, client;
const results = [], events = new EventEmitter();
try {
  await mkdir(join(root, "bvr"), { recursive: true });
  await cp(pluginRoot, installed, { recursive: true });
  await writeFile(join(root, "bvr/config.json"), JSON.stringify({
    schemaVersion: 3, runtimeDirectory: repository,
  }));
  const manifest = JSON.parse(await readFile(join(installed, "step.plugin.json"), "utf8"));
  const receipt = files.installationReceipt({ name: "bilibili-video-research" },
    { name: "isolated-local", kind: "local", path: root }, manifest, await files.packageFingerprint(installed));
  receipt.state = "installed";
  await files.writeReceipts(root, { version: 1, installations: [receipt] });
  const descriptor = { root: installed, kind: "installed", name: receipt.folder, id: receipt.id,
    fingerprint: receipt.fingerprint, instance: receipt.instance, provenance: "recorded", ref: "isolated" };
  const state = { approved: false, fail: false, hold: false,
    auth: { step: { type: "oauth", access: "fixture-cn-key", profile: "step_plan", expires: Date.now() + 3600000 } } };
  const worker = { id: randomUUID(), status: "connected", state: { sessionId: randomUUID(),
    model: { provider: "step", id: "step-5-preview", input: ["text", "video"] } } };
  worker.rpc = { request: async () => worker.state };
  let confirmations = 0;
  const pool = { workers: new Map([[worker.id, worker]]), activeId: worker.id,
    confirm: async () => { confirmations++; return state.approved; } };
  const calls = [];
  const provider = new StepPluginHostProvider(pool, () => state.auth, () => false, async (url, init) => {
    calls.push(String(url));
    const body = JSON.parse(init.body);
    assert.equal(body.model, "step-5-preview");
    assert.match(body.messages[0].content[0].video_url.url, /^data:video\/mp4;base64,/);
    assert.equal(new Headers(init.headers).get("Authorization"), `Bearer ${state.auth.step.access}`);
    if (state.hold) return new Promise((_done, reject) => {
      init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
      events.emit("provider", init.signal);
    });
    return state.fail ? new Response("fixture-provider-body-must-not-escape", { status: 429 })
      : Response.json({ choices: [{ message: { content: "isolated BVR visual result" } }] });
  });
  const selections = new PluginHostBindingStore(root), configurations = new PluginConfigurationStore(root);
  let selection = await selections.select(descriptor, { revision: "unconfigured", mode: "follow" });
  broker = new PluginHostBroker({ root, pool, provider, language: () => "zh",
    validateConsumer: async () => true });
  await broker.start();
  const executable = createRequire(import.meta.url)("ffmpeg-static");
  const video = join(root, "fixture.mp4");
  await promisify(execFile)(executable, ["-hide_banner", "-loglevel", "error", "-f", "lavfi",
    "-i", "color=c=red:s=64x64:d=0.2", "-c:v", "libx264", video], { timeout: 15000 });
  let stderr = "", lastLaunch;
  const connect = async () => {
    await client?.close();
    lastLaunch = await broker.issue(descriptor, worker);
    client = new Client({ name: "bvr-generic-host-acceptance", version: "0.1.0" });
    const transport = new StdioClientTransport({ command: process.execPath, args: [join(installed, "server/start.mjs")],
      cwd: root, stderr: "pipe", env: {
        PATH: process.env.PATH ?? process.env.Path, SystemRoot: process.env.SystemRoot,
        TEMP: process.env.TEMP, TMP: process.env.TMP, HOME: root, USERPROFILE: root,
        DFSC_LAUNCH_CONTEXT: JSON.stringify(lastLaunch),
        STEPFUN_API_KEY: "wrong-inherited-key", GEMINI_API_KEY: "wrong-gemini-key",
      } });
    transport.stderr?.on("data", data => { stderr += data.toString(); });
    await client.connect(transport);
    assert.equal((await client.listTools()).tools.length, 3);
  };
  const call = options => client.callTool({ name: "analyze_video", arguments: {
    video_path: video, question: "Describe the visible color", media_detail: "low",
  } }, undefined, { timeout: 15000, ...options });
  await connect();
  assert.equal(calls.length, 0, "Discovery must not call a model");
  for (let n = 0; n < 2; n++) {
    const result = await call();
    assert.equal(result.isError, true);
    assert.match(JSON.stringify(result), /DENIED/);
    results.push(result);
  }
  assert.equal(calls.length, 0); assert.equal(confirmations, 1);
  state.approved = true; broker.invalidate();
  await connect();
  for (let n = 0; n < 2; n++) {
    const result = await call();
    assert.notEqual(result.isError, true); assert.match(JSON.stringify(result), /isolated BVR visual result/);
    results.push(result);
  }
  assert.equal(calls.length, 2); assert.equal(confirmations, 2);
  state.fail = true;
  const failed = await call();
  assert.equal(failed.isError, true); assert.match(JSON.stringify(failed), /PROVIDER_FAILED/);
  results.push(failed);
  assert.equal(calls.length, 3); state.fail = false;

  state.hold = true;
  const entered = once(events, "provider", { signal: AbortSignal.timeout(10000) });
  const controller = new AbortController(), pending = call({ signal: controller.signal });
  const rejected = assert.rejects(pending, /isolated-mcp-cancel/);
  const [providerSignal] = await entered;
  const aborted = once(providerSignal, "abort", { signal: AbortSignal.timeout(10000) });
  controller.abort(new Error("isolated-mcp-cancel"));
  await rejected; await aborted;
  assert.equal(providerSignal.reason.code, "CANCELLED");
  assert.equal(calls.length, 4); state.hold = false;
  state.auth.step = { ...state.auth.step, access: "fixture-oversea-key", profile: "platform_oversea" };
  broker.invalidate();
  const stale = await call();
  assert.equal(stale.isError, true); assert.match(JSON.stringify(stale), /STALE_CONTEXT/);
  results.push(stale); assert.equal(calls.length, 4);
  await connect();
  const renewed = await call();
  assert.notEqual(renewed.isError, true); results.push(renewed);
  assert.equal(calls.length, 5); assert.equal(confirmations, 3);
  assert.ok(calls.slice(0, 4).every(url => url === "https://api.stepfun.com/step_plan/v1/chat/completions"));
  assert.equal(calls[4], "https://api.stepfun.ai/v1/chat/completions");

  const initial = await configurations.read(descriptor);
  const config = await configurations.save(descriptor, { ref: descriptor.ref, revision: initial.revision,
    values: { provider: "stepfun", base_url: "https://api.stepfun.com/v1", model: "independent-fixture" },
    secrets: { api_key: { action: "replace", value: "independent-fixture-key" }, asr_api_key: { action: "keep" } } });
  selection = await selections.select(descriptor, { revision: selection.revision, mode: "independent",
    configurationRevision: config.revision });
  broker.invalidate(); state.auth = {};
  await connect();
  assert.equal(lastLaunch.mode, "independent"); assert.equal(lastLaunch.broker, undefined);
  assert.equal(calls.length, 5); assert.equal(confirmations, 3);
  await configurations.save(descriptor, { ref: descriptor.ref, revision: config.revision,
    values: { ...config.values, model: "changed-fixture" },
    secrets: { api_key: { action: "keep" }, asr_api_key: { action: "keep" } } });
  const obsolete = await call();
  assert.equal(obsolete.isError, true); assert.match(JSON.stringify(obsolete), /Restart the session/);
  results.push(obsolete); assert.equal(calls.length, 5);
  assert.doesNotMatch(JSON.stringify([results, stderr]),
    /fixture-cn-key|fixture-oversea-key|independent-fixture-key|wrong-inherited-key|wrong-gemini-key|fixture-provider-body-must-not-escape/);
  assert.equal(stderr, "");
  console.log(JSON.stringify({
    realBvrMcp: true, realLocalFfmpeg: true, realGenericBrokerAndStepAdapter: true,
    nativeLauncherOrElectronUi: false, realAccountOrPaidProvider: false,
    isolatedProviderCalls: calls.length,
    checks: ["discovery is free", "denial without retry", "approval and launch reuse", "provider failure without fallback",
      "MCP cancellation reaches provider", "account replacement rejects old launch", "fresh overseas approval",
      "independent sealed configuration without login", "stale independent revision blocks before network"],
  }, null, 2));
} finally {
  try { await client?.close(); }
  finally {
    try { await broker?.close(); }
    finally { await rm(root, { recursive: true, force: true, maxRetries: 5 }); }
  }
}
