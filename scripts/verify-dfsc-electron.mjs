import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { isolatedEnvironment, pluginRoot } from "../plugins/bilibili-video-research/server/config.mjs";

const execute = promisify(execFile), repository = dirname(dirname(fileURLToPath(import.meta.url)));
const options = {};
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index], value = process.argv[index + 1];
  assert.ok(["--desktop-root", "--output"].includes(key) && !options[key] && isAbsolute(value ?? ""),
    "Use --desktop-root <built candidate checkout> --output <new absolute directory>");
  options[key] = value;
}
assert.ok(options["--desktop-root"] && options["--output"]);
const desktop = await realpath(resolve(options["--desktop-root"], "Desktop"));
const output = resolve(options["--output"]);
await mkdir(output, { recursive: false });
const profile = join(output, "isolated-profile"), root = join(profile, "step-runtime");
const market = join(profile, "local-market"), marketName = "bvr-native-acceptance";
await mkdir(join(root, "plugins"), { recursive: true });
await mkdir(join(market, ".step-plugin"), { recursive: true });
await cp(pluginRoot, join(market, "plugins", "bilibili-video-research"), { recursive: true });
await writeFile(join(market, ".step-plugin", "marketplace.json"), JSON.stringify({
  name: marketName, plugins: [{ name: "bilibili-video-research", source: "./plugins/bilibili-video-research" }],
}));
await mkdir(join(root, "bvr"));
await writeFile(join(root, "bvr", "config.json"), JSON.stringify({
  schemaVersion: 2, mode: "independent", hostAccess: "confirm", runtimeDirectory: repository,
  envFile: join(profile, "nonexistent-legacy-private.env"),
}));
await writeFile(join(root, "plugins", ".stepcode-preinstalled"), '["steppage"]');
await writeFile(join(root, "config.toml"),
  'defaultProvider = "step"\ndefaultModel = "step-5-preview"\n[telemetry]\nenabled = false\n');
await writeFile(join(profile, "preferences.json"), JSON.stringify({
  language: "zh", theme: "light", workspaces: [], autoCheckUpdates: false,
}));

const requireDesktop = createRequire(join(desktop, "package.json"));
const { _electron: electron } = requireDesktop("playwright");
const { closeDesktopFixtureAndWait } = await import(pathToFileURL(join(desktop, "scripts", "close-desktop-fixture.mjs")).href);
const { packageFingerprint } = await import(pathToFileURL(join(desktop, "electron", "plugin-files.mjs")).href);
const runtimeManifest = JSON.parse(await readFile(join(desktop, "runtime", "manifest.json"), "utf8"));
assert.ok(runtimeManifest.patches.includes("desktop-plugin-host-launch"));
const video = join(profile, "offline.mp4");
await execute(createRequire(import.meta.url)("ffmpeg-static"), [
  "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=red:s=64x64:d=0.2", "-c:v", "libx264", video,
], { timeout: 15000 });

const keys = { cn: "native-fixture-cn-key", oversea: "native-fixture-oversea-key",
  independent: "native-fixture-independent-key", asr: "native-fixture-asr-key" };
const failures = [], pageErrors = [], providerCalls = [], agentCalls = [], toolResults = new Map(), checks = [];
let region = "cn", rejectProvider = false, holdProvider = false, heldResponse, app, page, phase = "startup", ref, report;
const messageText = value => typeof value === "string" ? value
  : Array.isArray(value) ? value.filter(part => part.type === "text").map(part => part.text).join("\n") : "";
const frame = (model, delta, finish_reason = null) => `data: ${JSON.stringify({
  id: "native-bvr", object: "chat.completion.chunk", created: 1, model,
  choices: [{ index: 0, delta, finish_reason }],
})}\n\n`;
const server = createServer(async (request, response) => {
  try {
    const routed = new URL(request.url, "http://fixture");
    const url = new URL(routed.searchParams.get("url") ?? request.url, "http://127.0.0.1");
    assert.ok(["api.stepfun.com", "api.stepfun.ai", "127.0.0.1"].includes(url.hostname));
    response.setHeader("content-type", "application/json");
    if (request.method === "GET") {
      if (url.pathname.endsWith("/models")) response.end(JSON.stringify({ data: [{
        id: "step-5-preview", name: "Isolated Step", context_window: 256000, input_modalities: ["text", "image", "video"],
      }] }));
      else if (url.pathname.includes("/models/")) response.end(JSON.stringify({
        id: "step-5-preview", enable_reason: false, reasoning_effort_support_list: ["off"],
      }));
      else if (url.pathname.endsWith("/accounts")) response.end(JSON.stringify({ type: "prepaid", balance: 12 }));
      else throw new Error("Unexpected metadata route");
      return;
    }
    assert.ok(url.pathname.endsWith("/chat/completions"), "Only chat completions are expected");
    let raw = "";
    for await (const chunk of request) { raw += chunk; assert.ok(raw.length < 4 * 1024 * 1024); }
    const body = JSON.parse(raw);
    if (body.stream === true) {
      if (url.hostname !== "127.0.0.1") {
        assert.equal(url.hostname, region === "cn" ? "api.stepfun.com" : "api.stepfun.ai");
        assert.equal(request.headers.authorization, `Bearer ${keys[region]}`);
        assert.equal(body.model, "step-5-preview");
      } else assert.equal(body.model, "offline-agent");
      const index = body.messages.findLastIndex(message => message.role === "user"
        && /^NATIVE-BVR-[A-Z-]+$/.test(messageText(message.content)));
      assert.ok(index >= 0, "Agent calls belong to an explicit fixture scenario");
      const scenario = messageText(body.messages[index].content);
      agentCalls.push(scenario);
      response.setHeader("content-type", "text/event-stream");
      const result = body.messages.slice(index + 1).find(message => message.role === "tool");
      if (result) {
        toolResults.set(scenario, messageText(result.content));
        response.end(frame(body.model, { role: "assistant", content: `${scenario} COMPLETE` }, "stop") + "data: [DONE]\n\n");
      } else {
        const tool = body.tools?.find(item => item.function.name === "bilibili-video-research__bvr__analyze_video");
        assert.ok(tool, "The real runtime must discover the unchanged BVR MCP");
        response.end(frame(body.model, { role: "assistant", tool_calls: [{
          index: 0, id: scenario, type: "function", function: { name: tool.function.name, arguments: JSON.stringify({
            video_path: video, question: "Describe the visible color", media_detail: "low",
          }) },
        }] }, "tool_calls") + "data: [DONE]\n\n");
      }
      return;
    }
    const independent = body.model === "independent-native-model";
    assert.equal(request.headers.authorization, `Bearer ${independent ? keys.independent : keys[region]}`);
    assert.equal(url.hostname, independent || region === "cn" ? "api.stepfun.com" : "api.stepfun.ai");
    assert.equal(url.pathname, independent ? "/step_plan/v1/chat/completions" : "/v1/chat/completions");
    assert.match(body.messages[0].content[0].video_url.url, /^data:video\/mp4;base64,/);
    providerCalls.push({ mode: independent ? "independent" : "follow", region: independent ? null : region, model: body.model });
    if (holdProvider) heldResponse = response;
    else if (rejectProvider) {
      response.writeHead(429);
      response.end('{"error":"provider-body-must-not-escape"}');
    } else response.end(JSON.stringify({ choices: [{ message: { content: "isolated-native-bvr-visual-result" } }] }));
  } catch {
    failures.push("Unexpected fixture route, credential or payload");
    if (!response.headersSent) response.writeHead(500);
    response.end("{}");
  }
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const base = `http://127.0.0.1:${server.address().port}`, preload = join(profile, "loopback-only.cjs");
// Transport instrumentation only: no broker/launcher/confirmation implementation is replaced.
await writeFile(preload, `
const cp = require("node:child_process");
const { basename } = require("node:path");
let transport = globalThis.fetch;
const routed = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.hostname === "127.0.0.1") return transport(input, init);
  if (!["api.stepfun.com", "api.stepfun.ai"].includes(url.hostname))
    throw new Error("External request blocked by isolated BVR acceptance");
  return transport(${JSON.stringify(base)} + "/?url=" + encodeURIComponent(url.href), init);
};
Object.defineProperty(globalThis, "fetch", { configurable: true, get: () => routed,
  set: value => { if (value !== routed) transport = value; } });
const spawn = cp.spawn;
cp.spawn = function(file, args, options) {
  if (/^node(?:\\.exe)?$/i.test(basename(String(file))) && Array.isArray(args) && !args.includes(__filename))
    args = ["--require", __filename, ...args];
  return spawn.call(this, file, args, options);
};
require("node:module").syncBuiltinESMExports();
`);
const env = { ...isolatedEnvironment(process.env, {}), HOME: profile, USERPROFILE: profile,
  DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: "1", DESKTOP_STEPPAGE_BUNDLE: join(profile, "no-steppage.mjs") };
const pathKey = Object.keys(env).find(key => key.toUpperCase() === "PATH") ?? "PATH";
env[pathKey] = dirname(process.execPath) + (process.platform === "win32" ? ";" : ":") + (env[pathKey] ?? "");
const mark = value => { phase = value; console.log(`BVR native acceptance: ${value}`); };
const until = async (condition, label, timeout = 30000) => {
  const deadline = Date.now() + timeout;
  for (;;) {
    try { if (await condition()) return; }
    catch (error) { if (!String(error?.message).includes("capability:busy")) throw error; }
    assert.deepEqual(failures, []);
    assert.deepEqual(pageErrors, []);
    assert.ok(Date.now() < deadline, label);
    await delay(30);
  }
};
const snapshot = () => page.evaluate(() => window.desktop.snapshot());
const settings = () => page.evaluate(ref => window.desktop.pluginHostSettings({ ref }), ref);
const confirmation = () => page.getByRole("dialog", { name: "允许插件使用当前模型账户？", exact: true });
const prompt = async scenario => {
  assert.equal((await snapshot()).state?.isStreaming, false);
  await page.evaluate(message => window.desktop.command("prompt", { message }), scenario);
};
const finish = async scenario => {
  await until(async () => !(await snapshot()).state?.isStreaming && toolResults.has(scenario), `${scenario} did not finish`);
  return toolResults.get(scenario);
};
const restart = async () => {
  await page.evaluate(() => window.desktop.restart());
  await page.reload();
  await page.locator(".connection .online").waitFor({ timeout: 60000 });
  await until(async () => (await settings()).runtime.status === "connected", "Native BVR did not reconnect");
};
const openForm = async () => {
  await page.getByRole("button", { name: "插件市场", exact: true }).click();
  await page.getByRole("button", { name: "配置 Bilibili Video Research", exact: true }).click();
  const form = page.locator(".pc-host-form");
  await form.getByRole("group", { name: "模型来源", exact: true }).waitFor();
  return form;
};
const assertPrivate = value => {
  for (const secret of Object.values(keys)) assert.ok(!JSON.stringify(value).includes(secret));
  assert.doesNotMatch(JSON.stringify(value), /provider-body-must-not-escape|dfsc-launch-v1|DFSC_LAUNCH_CONTEXT|"broker"|"token"/);
};
try {
  app = await electron.launch({ executablePath: requireDesktop("electron"), args: [desktop], cwd: desktop, env, timeout: 60000 });
  page = await app.firstWindow();
  page.on("pageerror", error => pageErrors.push(error.message));
  await app.evaluate(({ BrowserWindow, net, dialog, shell }, { preload, base }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive(); window.setSize(1360, 900);
    dialog.showMessageBox = async () => ({ response: 1 });
    shell.openExternal = async () => { throw new Error("External navigation blocked by BVR fixture"); };
    const cp = process.getBuiltinModule("child_process"), spawn = cp.spawn;
    cp.spawn = function(file, args, options) {
      if (args?.some(arg => /(?:admin\.mjs|step\.js)$/.test(arg))) args = ["--require", preload, ...args];
      return spawn.call(this, file, args, options);
    };
    process.getBuiltinModule("module").syncBuiltinESMExports();
    net.fetch = (input, init) => {
      const url = new URL(String(input));
      if (url.origin === base) return fetch(input, init);
      if (!["api.stepfun.com", "api.stepfun.ai"].includes(url.hostname))
        throw new Error("External main request blocked by BVR fixture");
      return fetch(base + "/?url=" + encodeURIComponent(url.href), init);
    };
  }, { preload, base });
  await page.getByRole("heading", { name: /^(让想法阶跃星辰|星辰因你而阶跃)$/ }).waitFor();
  assert.equal(await app.evaluate(({ app }) => app.getPath("userData")), profile);
  assert.deepEqual(await app.evaluate(({ BrowserWindow }) => {
    const preferences = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
    return { sandbox: preferences.sandbox, contextIsolation: preferences.contextIsolation, nodeIntegration: preferences.nodeIntegration };
  }), { sandbox: true, contextIsolation: true, nodeIntegration: false });
  assert.equal(await page.evaluate(() => typeof window.require), "undefined");
  await page.evaluate(base => window.desktop.saveProvider({
    id: "", name: "Isolated agent", baseUrl: `${base}/agent/v1`, api: "openai-completions", enabled: false, keyless: true,
    models: [{ id: "offline-agent", name: "Isolated agent", reasoning: false, vision: false, contextWindow: 32768, maxTokens: 2048 }],
  }), base);
  mark("unchanged native marketplace installation");
  await page.evaluate(source => window.desktop.capabilityMutate({ action: "marketplace-add", source }), market);
  await page.evaluate(marketplace => window.desktop.capabilityMutate({ action: "plugin-install",
    name: "bilibili-video-research", marketplace }), marketName);
  const installed = join(root, "plugins", "bilibili-video-research");
  assert.equal(await packageFingerprint(installed), await packageFingerprint(pluginRoot));
  ref = await page.evaluate(async () => (await window.desktop.capabilityCatalog()).plugins
    .find(plugin => plugin.id === "bilibili-video-research").package.ref);
  assert.equal((await settings()).mode, null);
  assert.deepEqual(providerCalls, []);
  await page.evaluate(key => window.desktop.login("platform_cn", key), keys.cn);
  let form = await openForm();
  assert.equal(await form.locator(".pc-mode [aria-pressed=true]").count(), 0);
  await form.getByRole("button", { name: "跟随 DFSC 会话", exact: true }).click();
  await page.getByRole("button", { name: "保存配置", exact: true }).click();
  await until(async () => (await settings()).mode === "follow", "Follow source was not saved");
  assert.equal((await snapshot()).runtimeId, undefined, "Saving settings must not start a session");
  await page.evaluate(() => window.desktop.newIndependentSession());
  await page.reload();
  await page.locator(".connection .online").waitFor({ timeout: 60000 });
  await until(async () => (await settings()).runtime.status === "connected", "Unmodified BVR did not start natively");
  assert.equal((await settings()).runtime.capabilities.find(item => item.id === "model.video").available, true);
  checks.push("Unchanged package installed through production marketplace IPC and started by the native launcher");

  mark("production denial without fallback or repeated confirmation");
  await prompt("NATIVE-BVR-DENY");
  await confirmation().waitFor();
  assert.match(await confirmation().innerText(), /bilibili-video-research.*model.video/s);
  assert.deepEqual(providerCalls, []);
  await page.screenshot({ path: join(output, "video-authorization-cn.png") });
  await confirmation().getByRole("button", { name: "取消", exact: true }).click();
  assert.match(await finish("NATIVE-BVR-DENY"), /DENIED/);
  await prompt("NATIVE-BVR-DENY-AGAIN");
  assert.match(await finish("NATIVE-BVR-DENY-AGAIN"), /DENIED/);
  assert.equal(await confirmation().count(), 0);
  assert.deepEqual(providerCalls, []);
  checks.push("Production confirmation denial blocks the real BVR call without retry or fallback");

  mark("approval, launch reuse and provider failure");
  await restart();
  await prompt("NATIVE-BVR-APPROVE");
  await confirmation().waitFor();
  await confirmation().getByRole("button", { name: "确认", exact: true }).click();
  assert.match(await finish("NATIVE-BVR-APPROVE"), /isolated-native-bvr-visual-result/);
  await prompt("NATIVE-BVR-REUSE");
  assert.match(await finish("NATIVE-BVR-REUSE"), /isolated-native-bvr-visual-result/);
  assert.equal(providerCalls.length, 2);
  rejectProvider = true;
  await prompt("NATIVE-BVR-FAIL");
  assert.match(await finish("NATIVE-BVR-FAIL"), /PROVIDER_FAILED/);
  assert.equal(providerCalls.length, 3);
  rejectProvider = false;
  checks.push("Approved video calls reuse the native launch; provider failure cannot change credentials or channel");

  mark("pending native cancellation");
  await restart();
  await prompt("NATIVE-BVR-CANCEL");
  await confirmation().waitFor();
  await page.evaluate(() => window.desktop.command("abort"));
  await until(async () => (await snapshot()).requests.length === 0 && !(await snapshot()).state?.isStreaming,
    "Cancellation did not withdraw the production confirmation");
  assert.equal(providerCalls.length, 3);
  mark("in-flight native cancellation after an explicit restart");
  await restart();
  holdProvider = true;
  await prompt("NATIVE-BVR-HOLD");
  await confirmation().waitFor();
  await confirmation().getByRole("button", { name: "确认", exact: true }).click();
  await until(() => Boolean(heldResponse), "Held provider request did not arrive");
  await page.evaluate(() => window.desktop.command("abort"));
  await until(() => heldResponse.destroyed, "Native MCP cancellation did not close the provider request");
  await until(async () => !(await snapshot()).state?.isStreaming, "Cancelled agent did not become idle");
  holdProvider = false;
  assert.equal(providerCalls.length, 4);
  checks.push("Agent cancellation withdraws pending authorization and reaches the in-flight BVR provider request");

  mark("account replacement requires a new production approval");
  region = "oversea";
  await page.evaluate(key => window.desktop.login("platform_oversea", key), keys.oversea);
  await page.reload();
  await page.locator(".connection .online").waitFor({ timeout: 60000 });
  await until(async () => (await settings()).runtime.status === "connected", "Replacement account did not reconnect");
  await prompt("NATIVE-BVR-OVERSEA");
  await confirmation().waitFor();
  assert.match(await confirmation().innerText(), /oversea/);
  assert.equal(providerCalls.length, 4);
  await page.screenshot({ path: join(output, "video-authorization-oversea.png") });
  await confirmation().getByRole("button", { name: "确认", exact: true }).click();
  assert.match(await finish("NATIVE-BVR-OVERSEA"), /isolated-native-bvr-visual-result/);
  assert.equal(providerCalls.at(-1).region, "oversea");
  checks.push("Account replacement revokes old approval and routes a newly approved call to the overseas endpoint");

  mark("real independent settings form and stale-launch rejection");
  form = await openForm();
  await form.getByRole("button", { name: "独立配置", exact: true }).click();
  await form.getByLabel("Step 接口地址 / Step Endpoint", { exact: true }).fill("https://api.stepfun.com/step_plan/v1");
  await form.getByLabel("主力 API Key / Main API Key", { exact: true }).fill(keys.independent);
  await form.getByLabel("主力模型 / Main Model", { exact: true }).fill("independent-native-model");
  await form.getByText("独立语音转写 / Separate ASR", { exact: true }).click();
  await form.getByLabel("ASR 接口地址 / ASR Endpoint", { exact: true }).fill("https://api.stepfun.ai/v1");
  await form.getByLabel("ASR API Key", { exact: true }).fill(keys.asr);
  await form.getByLabel("ASR 模型 / ASR Model", { exact: true }).fill("stepaudio-2.5-asr");
  const priorRuntime = (await snapshot()).runtimeId;
  await page.getByRole("button", { name: "保存配置", exact: true }).click();
  await until(async () => (await settings()).mode === "independent", "Independent mode was not committed");
  assert.equal((await snapshot()).runtimeId, priorRuntime);
  assert.equal((await settings()).runtime.status, "restart-required");
  assert.equal(await form.getByLabel("主力 API Key / Main API Key", { exact: true }).inputValue(), "");
  assert.equal(await form.getByLabel("ASR API Key", { exact: true }).inputValue(), "");
  await page.screenshot({ path: join(output, "independent-settings.png") });
  await prompt("NATIVE-BVR-STALE");
  assert.match(await finish("NATIVE-BVR-STALE"), /STALE_CONTEXT/);
  assert.equal(providerCalls.length, 5);
  checks.push("Main and ASR fields save through the real form without secret readback or automatic restart; old launch is rejected");

  mark("independent native launch without a host account");
  await page.evaluate(() => window.desktop.logout());
  const configured = await page.evaluate(base => window.desktop.saveProvider({
    id: "", name: "Offline independent agent", baseUrl: `${base}/agent/v1`, api: "openai-completions", enabled: true, keyless: true,
    models: [{ id: "offline-agent", name: "Offline agent", reasoning: false, vision: false, contextWindow: 32768, maxTokens: 2048 }],
  }), base);
  const offlineModel = configured.models.find(model => model.id === "offline-agent");
  assert.ok(offlineModel, "The isolated custom agent must be available without a host account");
  await page.evaluate(() => window.desktop.newIndependentSession());
  await page.evaluate(model => window.desktop.command("set_model", { provider: model.provider, modelId: model.id }), offlineModel);
  await restart();
  assert.equal((await settings()).runtime.capabilities, undefined);
  await prompt("NATIVE-BVR-INDEPENDENT");
  assert.match(await finish("NATIVE-BVR-INDEPENDENT"), /isolated-native-bvr-visual-result/);
  assert.equal(providerCalls.length, 6);
  assert.equal(providerCalls.at(-1).mode, "independent");
  assert.equal(await confirmation().count(), 0);
  checks.push("A real BVR independent launch invokes only its configured connection without a DFSC account or broker approval");
  mark("changed independent revision rejects the existing BVR process");
  form = await openForm();
  await form.getByLabel("主力模型 / Main Model", { exact: true }).fill("changed-independent-model");
  await page.getByRole("button", { name: "保存配置", exact: true }).click();
  await until(async () => (await settings()).runtime.status === "restart-required", "Independent change did not invalidate the launch");
  await prompt("NATIVE-BVR-INDEPENDENT-STALE");
  assert.match(await finish("NATIVE-BVR-INDEPENDENT-STALE"), /Restart the session/);
  assert.equal(providerCalls.length, 6);
  checks.push("A changed independent settings revision blocks the old BVR process before another provider call");
  assertPrivate([await snapshot(), await settings(), [...toolResults], await page.locator("body").innerText()]);
  assert.deepEqual(failures, []);
  assert.deepEqual(pageErrors, []);
  const revision = async cwd => (await execute("git", ["rev-parse", "HEAD"], { cwd, timeout: 10000 })).stdout.trim();
  report = {
    bvrCommit: await revision(repository), desktopCommit: await revision(options["--desktop-root"]),
    verifierSha256: createHash("sha256").update(await readFile(fileURLToPath(import.meta.url))).digest("hex"),
    desktopMainSha256: createHash("sha256").update(await readFile(join(desktop, "dist", "main.cjs"))).digest("hex"),
    runtimeCommit: runtimeManifest.commit, realSourceElectron: true, defaultSandbox: true,
    unchangedPluginManifest: true, nativeLauncher: true, productionConfirmationUi: true, realBvrMcp: true,
    realAccountsOrPaidRequests: false, transportFixture: "loopback-only", nativeAsrCall: false, packagedUpgrade: false,
    providerFixtureRequests: providerCalls.length, agentFixtureRequests: agentCalls.length, checks,
  };
} catch (error) {
  console.error(`BVR native acceptance failed during ${phase}`);
  await writeFile(join(output, "failure.json"), JSON.stringify({
    phase, providerCalls, failures, pageErrors,
    toolCodes: [...toolResults].map(([scenario, text]) => ({ scenario, code: text.match(/dfsc-host:[A-Z_]+/)?.[0] ?? "other" })),
  }, null, 2) + "\n").catch(() => {});
  if (page && !page.isClosed()) await page.screenshot({ path: join(output, "failure.png") }).catch(() => {});
  throw error;
} finally {
  let stopped = !app;
  try {
    if (app) await closeDesktopFixtureAndWait(app);
    stopped = true;
  }
  finally {
    server.closeAllConnections();
    await new Promise(done => server.close(done));
    if (stopped) await rm(profile, { recursive: true, force: true, maxRetries: 5 });
    else console.error("Isolated test profile retained because application shutdown was not confirmed.");
  }
}
await writeFile(join(output, "verification.json"), JSON.stringify(report, null, 2) + "\n");
console.log(`BVR native acceptance passed: ${checks.length} checks; ${providerCalls.length} isolated provider calls. ${output}`);
