import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, readdir, readFile, realpath, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { isolatedEnvironment, pluginRoot } from "../plugins/bilibili-video-research/server/config.mjs";

const execute = promisify(execFile), repository = dirname(dirname(fileURLToPath(import.meta.url)));
const baselines = {
  "0.1.1": "db78c19f9ac27070540e5ff31addff4a31cf63a4",
  "0.2.0": "3624427c4c9da65dc634cba1a65ff021d11194d2",
};
const options = {};
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index], value = process.argv[index + 1];
  assert.ok(!options[key] && (key === "--from" ? Object.hasOwn(baselines, value)
    : ["--desktop-root", "--desktop-exe", "--bvr-runtime", "--output"].includes(key) && isAbsolute(value ?? "")),
  "Use --desktop-root <built checkout> --output <new absolute directory> [--from 0.1.1|0.2.0] [--desktop-exe <exe>] [--bvr-runtime <checkout>]");
  options[key] = value;
}
assert.ok(options["--desktop-root"] && options["--output"]);
const desktop = await realpath(resolve(options["--desktop-root"], "Desktop"));
const executable = options["--desktop-exe"] ? await realpath(options["--desktop-exe"]) : undefined;
const bvrRuntime = options["--bvr-runtime"] ? await realpath(options["--bvr-runtime"]) : repository;
const stagedRuntime = executable ? join(dirname(executable), "resources", "runtime") : join(desktop, "runtime");
const fromDesktop = name => import(pathToFileURL(join(desktop, name)).href);
const { mkdtemp, removeTestProfile } = await fromDesktop("scripts/test-profile.mjs");
const output = resolve(options["--output"]), scratch = join(dirname(output), "bvr-native-scratch");
await mkdir(output);
await mkdir(scratch, { recursive: true });
const profile = await realpath(await mkdtemp(join(scratch, "profile-"))), root = join(profile, "step-runtime");
const legacyVersion = options["--from"] ?? "0.1.1", hostedBaseline = legacyVersion === "0.2.0";
const fixtureApp = join(profile, "application"), runtime = executable ? stagedRuntime : join(fixtureApp, "runtime");
if (!executable) {
  await mkdir(runtime, { recursive: true });
  const sourceHelpers = new Set(["capability-settings.mjs", "plugin-schema-update.mjs"]);
  // Exercise candidate update workers without writing through a staged runtime junction.
  for (const entry of await readdir(stagedRuntime, { withFileTypes: true })) {
    const target = join(runtime, entry.name), staged = join(stagedRuntime, entry.name);
    if (entry.isDirectory()) await symlink(await realpath(staged), target, process.platform === "win32" ? "junction" : "dir");
    else await cp(sourceHelpers.has(entry.name) ? join(desktop, "electron", entry.name) : staged, target);
  }
}
const market = join(profile, "local-market"), marketName = "bvr-native-acceptance";
const id = "bilibili-video-research", resource = `plugins/${id}`;
const marketPlugin = join(market, resource);
const legacyCommit = baselines[legacyVersion];
const legacyRuntime = join(profile, "bvr-runtime"), archive = join(profile, "legacy.tar");
await execute("git", ["archive", "--format=tar", `--output=${archive}`, legacyCommit, "src", "package.json", resource],
  { cwd: repository, timeout: 15000 });
await mkdir(legacyRuntime);
await execute("tar", ["-xf", archive, "-C", legacyRuntime], { timeout: 15000 });
await symlink(join(bvrRuntime, "node_modules"), join(legacyRuntime, "node_modules"),
  process.platform === "win32" ? "junction" : "dir");
const git = (...args) => execute("git", args, { cwd: market, timeout: 15000 });
const publish = async label => {
  await git("add", "--all");
  await git("-c", "user.name=BVR Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", label);
};
await mkdir(join(root, "plugins"), { recursive: true });
await mkdir(join(market, ".step-plugin"), { recursive: true });
await cp(join(legacyRuntime, resource), marketPlugin, { recursive: true });
await writeFile(join(market, ".step-plugin", "marketplace.json"), JSON.stringify({
  name: marketName, plugins: [{ name: id, source: `./${resource}` }],
}));
// Both the archived legacy files and the candidate must reach DFSC byte-for-byte.
await writeFile(join(market, ".gitattributes"), "* -text\n");
await git("init", "--initial-branch=main");
await publish(`Existing BVR ${legacyVersion}`);
const candidateManifest = JSON.parse(await readFile(join(pluginRoot, "step.plugin.json"), "utf8"));
const candidateVersion = candidateManifest.version;
const setupPath = join(root, "bvr/config.json");
let legacySetup, legacyEnvironmentPath, legacyEnvironment, savedIndependent;
await writeFile(join(root, "plugins", ".stepcode-preinstalled"), '["steppage"]');
await writeFile(join(root, "config.toml"),
  'defaultProvider = "step"\ndefaultModel = "step-5-preview"\n[telemetry]\nenabled = false\n');
await writeFile(join(root, "models.json"), JSON.stringify({ providers: {
  step: { baseUrl: "https://api.stepfun.com/v1", api: "openai-completions",
    models: [{ id: "step-5-preview", name: "Isolated Step", input: ["text", "image"], contextWindow: 256000, maxTokens: 2048 }] },
} }));
await writeFile(join(profile, "preferences.json"), JSON.stringify({
  language: "zh", theme: "light", workspaces: [], autoCheckUpdates: false, autoGenerateSessionTitles: false,
}));

const requireDesktop = createRequire(join(desktop, "package.json"));
const { _electron: electron } = requireDesktop("playwright");
const { closeDesktopFixtureAndWait } = await import(pathToFileURL(join(desktop, "scripts", "close-desktop-fixture.mjs")).href);
const { restartIdleSessionFixture, waitForSessionFixtureTools } = await fromDesktop("scripts/session-fixture.mjs");
const { installRuntimeFixturePreload } = await fromDesktop("scripts/runtime-transport-fixture.mjs");
const { packageFingerprint } = await import(pathToFileURL(join(desktop, "electron", "plugin-files.mjs")).href);
const runtimeManifest = JSON.parse(await readFile(join(runtime, "manifest.json"), "utf8"));
assert.ok(runtimeManifest.patches.includes("desktop-plugin-host-launch"));
const video = join(profile, "offline.mp4"), fixtureUrl = "https://www.bilibili.com/video/BV1aaaaaaaaa/";
await execute(createRequire(import.meta.url)("ffmpeg-static"), [
  "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=red:s=64x64:d=0.2",
  "-f", "lavfi", "-i", "sine=frequency=440:duration=0.2", "-shortest", "-c:v", "libx264", "-c:a", "aac", video,
], { timeout: 15000 });

const keys = { cn: "native-fixture-cn-key", oversea: "native-fixture-oversea-key",
  independent: "native-fixture-independent-key", asr: "native-fixture-asr-key",
  legacy: "native-fixture-legacy-key", legacyAsr: "native-fixture-legacy-asr-key", agent: "native-fixture-agent-key",
  saved: "native-fixture-saved-host-key" };
const failures = [], pageErrors = [], providerCalls = [], agentCalls = [], toolResults = new Map(), checks = [];
let region = "cn", rejectProvider = false, rejectAsr = false, holdProvider = false, heldResponse, app, page, phase = "startup", ref, report;
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
    assert.ok(["api.stepfun.com", "api.stepfun.ai", "api.bilibili.com", "127.0.0.1"].includes(url.hostname));
    response.setHeader("content-type", "application/json");
    if (request.method === "GET") {
      if (url.hostname === "api.bilibili.com") {
        assert.equal(url.searchParams.get("bvid"), "BV1aaaaaaaaa");
        assert.ok(["/x/web-interface/view", "/x/tag/archive/tags"].includes(url.pathname));
        response.end(JSON.stringify({ code: 0, data: url.pathname.endsWith("/view")
          ? { aid: 1, cid: 1, title: "Isolated video", pubdate: 1, duration: 1 } : [] }));
      } else if (url.pathname.endsWith("/models")) response.end(JSON.stringify({ data: [{
        id: "step-5-preview", name: "Isolated Step", context_window: 256000, input_modalities: ["text", "image", "video"],
      }] }));
      else if (url.pathname.includes("/models/")) response.end(JSON.stringify({
        id: "step-5-preview", enable_reason: false, reasoning_effort_support_list: ["off"],
      }));
      else if (url.pathname.endsWith("/accounts")) response.end(JSON.stringify({ type: "prepaid", balance: 12 }));
      else throw new Error("Unexpected metadata route");
      return;
    }
    assert.ok(/\/(?:chat\/completions|audio\/asr\/sse)$/.test(url.pathname));
    let raw = "";
    for await (const chunk of request) { raw += chunk; assert.ok(raw.length < 4 * 1024 * 1024); }
    const body = JSON.parse(raw);
    if (url.pathname.endsWith("/audio/asr/sse")) {
      assert.equal(url.hostname, "api.stepfun.com");
      assert.equal(url.pathname, "/v1/audio/asr/sse");
      assert.equal(request.headers.authorization, `Bearer ${keys.asr}`);
      assert.equal(body.audio.input.transcription.model, "stepaudio-2.5-asr");
      providerCalls.push({ mode: "independent-asr", failed: rejectAsr });
      if (rejectAsr) response.writeHead(429).end("provider-body-must-not-escape");
      else response.setHeader("content-type", "text/event-stream")
        .end('data: {"type":"transcript.text.done","text":"isolated native ASR text"}\n\n');
      return;
    }
    if (body.stream === true) {
      const index = body.messages.findLastIndex(message => message.role === "user"
        && /^NATIVE-BVR-[A-Z-]+$/.test(messageText(message.content)));
      assert.ok(index >= 0, "Agent calls belong to an explicit fixture scenario");
      const scenario = messageText(body.messages[index].content);
      assert.equal(url.hostname === "127.0.0.1", scenario !== "NATIVE-BVR-LEGACY");
      if (url.hostname !== "127.0.0.1") {
        assert.equal(url.hostname, region === "cn" ? "api.stepfun.com" : "api.stepfun.ai");
        assert.equal(request.headers.authorization, `Bearer ${keys[region]}`);
        assert.equal(body.model, "step-5-preview");
      } else {
        assert.equal(body.model, "offline-agent");
        assert.equal(request.headers.authorization, `Bearer ${keys.agent}`);
      }
      agentCalls.push(scenario);
      response.setHeader("content-type", "text/event-stream");
      const result = body.messages.slice(index + 1).find(message => message.role === "tool");
      if (result) {
        toolResults.set(scenario, messageText(result.content));
        response.end(frame(body.model, { role: "assistant", content: `${scenario} COMPLETE` }, "stop") + "data: [DONE]\n\n");
      } else {
        const isSpeech = scenario === "NATIVE-BVR-SPEECH" || scenario === "NATIVE-BVR-ASR-FAIL";
        const tool = body.tools?.find(item => item.function.name ===
          `bilibili-video-research__bvr__${isSpeech ? "analyze_bilibili_video" : "analyze_video"}`);
        assert.ok(tool, "The real runtime must discover the unchanged BVR MCP");
        response.end(frame(body.model, { role: "assistant", tool_calls: [{
          index: 0, id: scenario, type: "function", function: { name: tool.function.name, arguments: JSON.stringify(isSpeech
            ? { url: fixtureUrl, question: "Summarize the audio", mode: "language", include_comments: false } : {
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
    const text = typeof body.messages[0].content === "string";
    if (text) assert.match(body.messages[0].content, /ASR TRANSCRIPT .*:\nisolated native ASR text/);
    else assert.match(body.messages[0].content[0].video_url.url, /^data:video\/mp4;base64,/);
    providerCalls.push({ mode: independent ? "independent" : "follow", region: independent ? null : region,
      model: body.model, capability: text ? "text" : "video" });
    if (holdProvider) heldResponse = response;
    else if (rejectProvider) {
      response.writeHead(429);
      response.end('{"error":"provider-body-must-not-escape"}');
    } else response.end(JSON.stringify({ choices: [{
      message: { content: text ? "isolated-native-bvr-text-result" : "isolated-native-bvr-visual-result" },
    }] }));
  } catch (error) {
    const assertion = /verify-dfsc-electron\.mjs:(\d+):\d+/u.exec(error?.stack ?? "")?.[1] ?? "unknown";
    failures.push(`Unexpected fixture route, credential or payload at assertion line ${assertion}`);
    if (!response.headersSent) response.writeHead(500);
    response.end("{}");
  }
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const base = `http://127.0.0.1:${server.address().port}`, preload = join(profile, "loopback-only.cjs");
const modelPath = join(root, "models.json");
const modelConfig = JSON.parse(await readFile(modelPath, "utf8"));
modelConfig.providers["fixture-agent"] = { baseUrl: `${base}/agent/v1`, api: "openai-completions", apiKey: keys.agent,
  models: [{ id: "offline-agent", name: "Isolated agent", input: ["text"], contextWindow: 32768, maxTokens: 2048 }] };
await writeFile(modelPath, JSON.stringify(modelConfig));
const mcpDiagnostics = join(profile, "mcp-startup.log");
// Transport instrumentation only: no broker/launcher/confirmation implementation is replaced.
await writeFile(preload, `
const cp = require("node:child_process");
const { basename } = require("node:path");
const { appendFileSync } = require("node:fs");
let transport = globalThis.fetch;
const routed = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.hostname === "127.0.0.1") return transport(input, init);
  if (!["api.stepfun.com", "api.stepfun.ai", "api.bilibili.com"].includes(url.hostname))
    throw new Error("External request blocked by isolated BVR acceptance");
  return transport(${JSON.stringify(base)} + "/?url=" + encodeURIComponent(url.href), init);
};
Object.defineProperty(globalThis, "fetch", { configurable: true, get: () => routed,
  set: value => { if (value !== routed) transport = value; } });
const spawn = cp.spawn;
cp.spawn = function(file, args, options) {
  if (/^node(?:\\.exe)?$/i.test(basename(String(file))) && Array.isArray(args) && !args.includes(__filename))
    args = ["--require", __filename, ...args];
  const child = spawn.call(this, file, args, options);
  if (args?.some(arg => /(?:^|[\\\\/])server[\\\\/]start\\.mjs$/.test(arg))) {
    const log = line => appendFileSync(${JSON.stringify(mcpDiagnostics)}, line + "\\n");
    log("BVR launcher spawned; hosted=" + Boolean(options?.env?.DFSC_LAUNCH_CONTEXT));
    child.stderr?.on("data", chunk => {
      const text = chunk.toString();
      const error = text.match(/BVR: ([^\\r\\n]{1,400})/);
      if (error) log(error[1].replace(/native-fixture-[\\w-]+/g, "[fixture credential]"));
      else if (/ERR_MODULE_NOT_FOUND/.test(text)) log("BVR runtime module missing");
    });
    child.once("exit", code => log("BVR launcher exited: " + code));
  }
  return child;
};
// Replace external download only. The real BVR process still probes/selects a
// format, extracts audio with FFmpeg and invokes its configured providers.
const { promisify } = require("node:util");
const execFile = cp.execFile;
const fixtureDownload = ${JSON.stringify(`
const fs = require("node:fs");
const [video, expectedUrl, ...args] = process.argv.slice(1);
if (args.at(-1) !== expectedUrl) process.exit(2);
const output = args.indexOf("-o");
if (output >= 0) fs.copyFileSync(video, args[output + 1].replace("%(ext)s", "mp4"));
console.log(JSON.stringify({ formats: [
  { format_id: "video", vcodec: "avc1", acodec: "none", height: 1080, fps: 30 },
  { format_id: "audio", vcodec: "none", acodec: "mp4a", abr: 128 },
], requested_formats: output >= 0 ? [
  { format_id: "video", vcodec: "avc1", acodec: "none", height: 1080, fps: 30 },
  { format_id: "audio", vcodec: "none", acodec: "mp4a", abr: 128 },
] : [] }));
`)};
const fixtureArgs = (file, args, rest) => /^yt-dlp(?:\\.exe)?$/i.test(basename(String(file)))
  ? [process.execPath, ["-e", fixtureDownload, "--", ${JSON.stringify(video)}, ${JSON.stringify(fixtureUrl)}, ...args], ...rest]
  : [file, args, ...rest];
cp.execFile = (file, args, ...rest) => execFile(...fixtureArgs(file, args, rest));
cp.execFile[promisify.custom] = (file, args, ...rest) => execFile[promisify.custom](...fixtureArgs(file, args, rest));
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
const confirmation = () => page.getByRole("dialog", { name: "允许插件使用已选额度账户？", exact: true });
const prompt = async scenario => {
  assert.equal((await snapshot()).state?.isStreaming, false);
  await page.evaluate(message => window.desktop.command("prompt", { message }), scenario);
};
const finish = async scenario => {
  await until(async () => !(await snapshot()).state?.isStreaming && toolResults.has(scenario), `${scenario} did not finish`);
  return toolResults.get(scenario);
};
const restart = async () => {
  await restartIdleSessionFixture(page, (await snapshot()).runtimeId);
  await page.reload();
  await page.locator(".connection .online").waitFor({ timeout: 60000 });
  await until(async () => (await settings()).runtime.status === "connected", "Native BVR did not reconnect", 65000);
};
const openForm = async () => {
  const catalog = page.getByRole("region", { name: "插件中心", exact: true });
  if (!(await catalog.isVisible())) await page.getByRole("button", { name: "插件市场", exact: true }).click();
  await page.getByRole("button", { name: "配置 Bilibili Video Research", exact: true }).click();
  const form = page.locator(".pc-host-form");
  await form.getByRole("group", { name: "连接来源", exact: true }).waitFor();
  return form;
};
const choose = async (form, label, value) => {
  await form.getByRole("button", { name: label, exact: true }).click();
  await page.getByRole("menuitemradio", { name: value, exact: true }).click();
};
const bind = async (form, label) => {
  await choose(form, `${label} · 调用来源`, "开放平台 API");
  await choose(form, `${label} · 模型`, "step-5-preview");
};
const api = form => form.getByRole("switch", { name: "开放平台 API（按量计费）", exact: true });
const independent = form => form.getByRole("switch", { name: "独立配置", exact: true });
const save = () => page.getByRole("button", { name: "保存配置", exact: true }).click();
const assertPrivate = value => {
  for (const secret of Object.values(keys)) assert.ok(!JSON.stringify(value).includes(secret));
  assert.doesNotMatch(JSON.stringify(value), /provider-body-must-not-escape|dfsc-launch-v1|DFSC_LAUNCH_CONTEXT|"broker"|"token"/);
};
try {
  app = await electron.launch({ executablePath: executable ?? requireDesktop("electron"),
    args: executable ? [] : [desktop], cwd: executable ? desktop : fixtureApp, env, timeout: 60000 });
  page = await app.firstWindow();
  page.on("pageerror", error => pageErrors.push(error.message));
  await app.evaluate(installRuntimeFixturePreload, { preload });
  await app.evaluate(({ BrowserWindow, net, dialog, shell }, { base }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive(); window.setSize(1360, 900);
    dialog.showMessageBox = async () => ({ response: 1 });
    shell.openExternal = async () => { throw new Error("External navigation blocked by BVR fixture"); };
    net.fetch = (input, init) => {
      const url = new URL(String(input));
      if (url.origin === base) return fetch(input, init);
      if (!["api.stepfun.com", "api.stepfun.ai"].includes(url.hostname))
        throw new Error("External main request blocked by BVR fixture");
      return fetch(base + "/?url=" + encodeURIComponent(url.href), init);
    };
  }, { base });
  await page.getByRole("heading", { name: /^(让想法阶跃星辰|星辰因你而阶跃)$/ }).waitFor();
  assert.equal(await app.evaluate(({ app }) => app.getPath("userData")), profile);
  assert.equal(await app.evaluate(({ app }) => app.isPackaged), Boolean(executable));
  if (executable) assert.equal(await realpath(await app.evaluate(() => process.execPath)), executable);
  assert.deepEqual(await app.evaluate(({ BrowserWindow }) => {
    const preferences = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
    return { sandbox: preferences.sandbox, contextIsolation: preferences.contextIsolation, nodeIntegration: preferences.nodeIntegration };
  }), { sandbox: true, contextIsolation: true, nodeIntegration: false });
  assert.equal(await page.evaluate(() => typeof window.require), "undefined");
  const mutate = input => page.evaluate(input => window.desktop.capabilityMutate(input), input);
  const plugin = async () => (await page.evaluate(() => window.desktop.capabilityCatalog())).plugins.find(entry => entry.id === id);
  const installed = join(root, "plugins", id);
  const receipt = async () => JSON.parse(await readFile(join(root, "desktop-plugins/installations.json"), "utf8"))
    .installations.find(entry => entry.id === id);
  mark(`install and approve the genuine BVR ${legacyVersion}`);
  await mutate({ action: "marketplace-add", source: pathToFileURL(market).href });
  await mutate({ action: "plugin-install", name: id, marketplace: marketName });
  const baselinePlugin = await plugin();
  assert.equal(baselinePlugin.version, legacyVersion);
  assert.equal(baselinePlugin.package.hostSettingsAvailable, hostedBaseline);
  assert.equal(await packageFingerprint(installed), await packageFingerprint(marketPlugin));
  const oldReceipt = await receipt();
  await page.evaluate(async ({ legacyRuntime, keys, profile }) => {
    const current = await window.desktop.bvrConfiguration();
    return window.desktop.bvrSaveConfiguration({ revision: current.revision, runtimeDirectory: legacyRuntime,
      mode: "dfsc", apiBase: "https://api.stepfun.com/v1", model: "legacy-main-model", apiKey: keys.legacy,
      asrApiBase: "https://api.stepfun.com/v1", asrModel: "stepaudio-2.5-asr", asrApiKey: keys.legacyAsr,
      cookieFile: "", proxy: "", downloadDirectory: profile, preferCaptions: false });
  }, { legacyRuntime, keys, profile });
  legacySetup = await readFile(setupPath);
  legacyEnvironmentPath = JSON.parse(legacySetup).envFile;
  legacyEnvironment = await readFile(legacyEnvironmentPath);
  assert.ok(legacyEnvironment.includes(keys.legacy));
  assert.ok(legacyEnvironment.includes(keys.legacyAsr));
  await page.evaluate(key => window.desktop.login("platform_cn", key), keys.cn);
  if (hostedBaseline) {
    ref = baselinePlugin.package.ref;
    const current = await settings();
    const saved = await page.evaluate(input => window.desktop.pluginSaveHostSettings(input), {
      ref, revision: current.revision, mode: "independent",
      configuration: { ref, revision: current.independent.revision,
        values: { provider: "stepfun", base_url: "https://api.stepfun.com/step_plan/v1", model: "independent-native-model" },
        secrets: { api_key: { action: "replace", value: keys.saved }, asr_api_key: { action: "keep" } } },
    });
    savedIndependent = saved.independent;
    assert.equal(savedIndependent.hasSecret.api_key, true);
    await page.evaluate(input => window.desktop.pluginSaveHostSettings(input), {
      ref, revision: saved.revision, mode: "account", accountTicket: current.account.ticket,
      models: { "model.video": "step-5-preview" },
    });
  }
  await page.evaluate(() => window.desktop.newIndependentSession());
  const started = await snapshot();
  await waitForSessionFixtureTools(page, started.runtimeId);
  const legacyAgent = (await snapshot()).models.find(model => model.provider === "step" && model.id === "step-5-preview");
  assert.ok(legacyAgent, "The old bridge needs the fixture Step chat model");
  await page.evaluate(runtimeId => window.desktop.command("set_model", { provider: "step", modelId: "step-5-preview" }, runtimeId), started.runtimeId);
  await page.reload();
  await page.locator(".connection .online").waitFor({ timeout: 60000 });
  const session = (await snapshot()).state.sessionId;
  await prompt("NATIVE-BVR-LEGACY");
  const legacyConfirm = hostedBaseline ? confirmation()
    : page.getByRole("dialog", { name: "允许 BVR 使用此会话的模型账户？", exact: true });
  await legacyConfirm.getByRole("button", { name: "确认", exact: true }).click();
  assert.match(await finish("NATIVE-BVR-LEGACY"), /isolated-native-bvr-visual-result/);
  assert.equal(providerCalls.length, 1);
  providerCalls.length = 0;
  checks.push(`Genuine BVR ${legacyVersion} installed from a local market and approved through ${hostedBaseline ? "the generic Broker" : "the legacy bridge"}`);

  mark(`update the same installation to BVR ${candidateVersion}`);
  // The external checkout imports its own SDK and configuration reader.
  await cp(join(bvrRuntime, "src"), join(legacyRuntime, "src"), { recursive: true });
  await cp(join(bvrRuntime, "package.json"), join(legacyRuntime, "package.json"));
  await cp(join(bvrRuntime, resource), join(legacyRuntime, resource), { recursive: true });
  await cp(pluginRoot, marketPlugin, { recursive: true });
  assert.equal(await packageFingerprint(marketPlugin), await packageFingerprint(pluginRoot));
  await publish(`BVR ${candidateVersion} candidate`);
  await mutate({ action: "plugin-check-updates" });
  const previous = await plugin();
  assert.equal(previous.update?.version, candidateVersion);
  const preflight = await page.evaluate(input => window.desktop.pluginUpdatePreflight(input),
    { id, ref: previous.package.ref, candidate: previous.update.ref });
  assert.equal(preflight.status, "compatible");
  assert.deepEqual(preflight.changes, hostedBaseline ? [
    { code: "required-relaxed", field: "api_key" }, { code: "presentation", field: "api_key" },
    { code: "required-relaxed", field: "model" }, { code: "host-reconfigure" },
  ] : [{ code: "configuration-added" }]);
  assert.equal(preflight.readiness, "needs-release");
  const applied = await page.evaluate(token => window.desktop.pluginUpdateApply({ token, release: true }), preflight.token);
  assert.equal(applied.installation, "committed");
  const upgraded = await plugin();
  assert.equal(upgraded.version, candidateVersion);
  assert.equal(upgraded.package.hostSettingsAvailable, true);
  const newReceipt = await receipt();
  assert.equal(newReceipt.instance, oldReceipt.instance);
  assert.equal(newReceipt.source, oldReceipt.source);
  assert.equal(await packageFingerprint(installed), await packageFingerprint(pluginRoot));
  assert.ok((await readFile(setupPath)).equals(legacySetup));
  assert.ok((await readFile(legacyEnvironmentPath)).equals(legacyEnvironment));
  assert.equal((await snapshot()).state?.sessionId, session);
  ref = upgraded.package.ref;
  const upgradedSettings = await settings();
  assert.equal(upgradedSettings.mode, null);
  assert.equal(upgradedSettings.source, undefined);
  assert.equal(upgradedSettings.independent.configured, hostedBaseline);
  assert.equal(upgradedSettings.independent.hasSecret.api_key, hostedBaseline);
  assert.equal(upgradedSettings.independent.hasSecret.asr_api_key, false);
  assert.equal(upgradedSettings.runtime.capabilities, undefined);
  if (hostedBaseline) {
    assert.notEqual(upgradedSettings.independent.revision, savedIndependent.revision);
    assert.deepEqual(upgradedSettings.independent.values, savedIndependent.values);
    const snapshotPath = revision => join(root, "desktop-plugins/settings", newReceipt.instance, `${revision}.json`);
    const readSaved = async revision => JSON.parse(await readFile(snapshotPath(revision), "utf8"));
    const [before, after] = await Promise.all([readSaved(savedIndependent.revision), readSaved(upgradedSettings.independent.revision)]);
    assert.ok(before.secrets.api_key === keys.saved && after.secrets.api_key === keys.saved, "Saved independent key was not preserved");
  }
  assert.deepEqual(providerCalls, []);
  let form = await openForm();
  const sources = form.getByRole("group", { name: "连接来源", exact: true }).getByRole("switch");
  assert.deepEqual(await sources.allTextContents(), ["使用我的 Step Plan 额度", "开放平台 API（按量计费）", "独立配置"]);
  assert.equal(await form.locator(".pc-mode [aria-checked=true]").count(), 0);
  await form.getByRole("status").filter({ hasText: "尚未选择模型来源" }).waitFor();
  await page.screenshot({ path: join(output, "upgraded-unconfigured.png"), animations: "disabled" });
  await api(form).click();
  await bind(form, "视频理解");
  await save();
  await until(async () => (await settings()).mode === "account", "Explicit API source was not saved");
  await restart();
  await until(async () => (await snapshot()).models.some(model => model.id === "offline-agent"), "Custom chat model did not apply");
  const offlineModel = (await snapshot()).models.find(model => model.id === "offline-agent");
  assert.ok(offlineModel, "The connected session must expose the custom chat model");
  await page.evaluate(({ model, runtimeId }) => window.desktop.command("set_model", {
    provider: model.provider, modelId: model.id,
  }, runtimeId), { model: offlineModel, runtimeId: (await snapshot()).runtimeId });
  await until(async () => (await snapshot()).state?.model?.id === "offline-agent", "Fixture chat model was not selected");
  assert.equal((await settings()).runtime.capabilities.find(item => item.id === "model.video").available, true);
  assert.equal((await settings()).runtime.capabilities.find(item => item.id === "model.video").authorization, "required");
  checks.push("Real update preserves the installation, conversation and legacy files, uses the common three-source form, and requires explicit routing and approval");
  checks.push("All post-upgrade chat traffic uses a custom transport and never supplies the Broker credential");
  if (hostedBaseline) checks.push("Previously saved independent values and secret are preserved without selecting or invoking that connection");

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
  assert.equal((await settings()).accountMatches, false);
  form = await openForm();
  await api(form).click();
  await api(form).click();
  await bind(form, "视频理解");
  await save();
  await until(async () => (await settings()).accountMatches, "Replacement account not explicitly rebound");
  await restart();
  await prompt("NATIVE-BVR-OVERSEA");
  await confirmation().waitFor();
  assert.match(await confirmation().innerText(), /oversea/);
  assert.equal(providerCalls.length, 4);
  await page.screenshot({ path: join(output, "video-authorization-oversea.png") });
  await confirmation().getByRole("button", { name: "确认", exact: true }).click();
  assert.match(await finish("NATIVE-BVR-OVERSEA"), /isolated-native-bvr-visual-result/);
  assert.equal(providerCalls.at(-1).region, "oversea");
  checks.push("Account replacement revokes old approval and routes a newly approved call to the overseas endpoint");

  mark("real mixed-route settings form and stale-launch rejection");
  form = await openForm();
  await independent(form).click();
  await bind(form, "文本");
  await choose(form, "语音识别 · 调用来源", "独立配置");
  await form.getByText("独立语音转写 / Separate ASR", { exact: true }).click();
  await form.getByLabel("ASR 接口地址 / ASR Endpoint", { exact: true }).fill("https://api.stepfun.com/v1");
  await form.getByLabel("ASR API Key", { exact: true }).fill(keys.asr);
  await form.getByLabel("ASR 模型 / ASR Model", { exact: true }).fill("stepaudio-2.5-asr");
  await form.getByText("独立模式下载设置 / Independent Downloads", { exact: true }).click();
  await form.getByLabel("优先字幕 / Prefer Captions", { exact: true }).uncheck();
  const priorRuntime = (await snapshot()).runtimeId;
  await save();
  await until(async () => (await settings()).mode === "routed", "Mixed mode was not committed");
  assert.equal((await snapshot()).runtimeId, priorRuntime);
  assert.equal((await settings()).runtime.status, "restart-required");
  const mixed = await settings();
  assert.equal(mixed.independent.hasSecret.api_key, hostedBaseline);
  assert.equal(mixed.independent.hasSecret.asr_api_key, true);
  assert.deepEqual(mixed.independentCapabilities, ["model.asr"]);
  assert.deepEqual(Object.keys(mixed.models).sort(), ["model.text", "model.video"]);
  await page.screenshot({ path: join(output, "mixed-settings.png"), animations: "disabled" });
  await restart();
  await prompt("NATIVE-BVR-MIXED-VIDEO");
  await confirmation().getByRole("button", { name: "确认", exact: true }).click();
  assert.match(await finish("NATIVE-BVR-MIXED-VIDEO"), /isolated-native-bvr-visual-result/);
  assert.equal(providerCalls.at(-1).capability, "video");
  const beforeSpeech = providerCalls.length;
  await prompt("NATIVE-BVR-SPEECH");
  await confirmation().waitFor();
  assert.match(await confirmation().innerText(), /model\.text/);
  assert.deepEqual(providerCalls.slice(beforeSpeech), [{ mode: "independent-asr", failed: false }]);
  await confirmation().getByRole("button", { name: "确认", exact: true }).click();
  assert.match(await finish("NATIVE-BVR-SPEECH"), /isolated-native-bvr-text-result/);
  assert.deepEqual(providerCalls.slice(beforeSpeech), [
    { mode: "independent-asr", failed: false },
    { mode: "follow", region: "oversea", model: "step-5-preview", capability: "text" },
  ]);
  rejectAsr = true;
  const beforeFailure = providerCalls.length;
  await prompt("NATIVE-BVR-ASR-FAIL");
  assert.match(await finish("NATIVE-BVR-ASR-FAIL"), /Media analysis unavailable:.*429/);
  assert.deepEqual(providerCalls.slice(beforeFailure), [{ mode: "independent-asr", failed: true }]);
  assert.equal(await confirmation().count(), 0);
  rejectAsr = false;
  checks.push("Real BVR MCP routes video and text to the Broker, extracts local audio and calls independent ASR, and stops on ASR failure without fallback");

  mark("independent native launch without a host account");
  form = await openForm();
  await api(form).click();
  await choose(form, "视频理解 · 调用来源", "独立配置");
  await form.getByText("主力模型 / Main Model", { exact: true }).first().click();
  await form.getByLabel("Step 接口地址 / Step Endpoint", { exact: true }).fill("https://api.stepfun.com/step_plan/v1");
  await form.getByLabel("主力 API Key / Main API Key", { exact: true }).fill(keys.independent);
  await form.getByLabel("主力模型 / Main Model", { exact: true }).fill("independent-native-model");
  await save();
  await until(async () => (await settings()).mode === "routed" && !(await settings()).source, "Independent-only routes not committed");
  await page.evaluate(() => window.desktop.logout());
  await restart();
  assert.equal((await settings()).runtime.capabilities, undefined);
  const beforeIndependent = providerCalls.length;
  await prompt("NATIVE-BVR-INDEPENDENT");
  assert.match(await finish("NATIVE-BVR-INDEPENDENT"), /isolated-native-bvr-visual-result/);
  assert.equal(providerCalls.length, beforeIndependent + 1);
  assert.equal(providerCalls.at(-1).mode, "independent");
  assert.equal(await confirmation().count(), 0);
  checks.push("A real BVR independent launch invokes only its configured connection without a DFSC account or broker approval");
  mark("changed independent revision rejects the existing BVR process");
  form = await openForm();
  await form.getByText("主力模型 / Main Model", { exact: true }).first().click();
  await form.getByLabel("主力模型 / Main Model", { exact: true }).fill("changed-independent-model");
  await page.getByRole("button", { name: "保存配置", exact: true }).click();
  await until(async () => (await settings()).runtime.status === "restart-required", "Independent change did not invalidate the launch");
  await prompt("NATIVE-BVR-INDEPENDENT-STALE");
  assert.match(await finish("NATIVE-BVR-INDEPENDENT-STALE"), /Restart the session/i);
  assert.equal(providerCalls.length, beforeIndependent + 1);
  assert.ok((await readFile(setupPath)).equals(legacySetup));
  assert.ok((await readFile(legacyEnvironmentPath)).equals(legacyEnvironment));
  checks.push("A changed independent settings revision blocks the old BVR process before another provider call");
  assertPrivate([await snapshot(), await settings(), [...toolResults], await page.locator("body").innerText()]);
  assert.deepEqual(failures, []);
  assert.deepEqual(pageErrors, []);
  const revision = async cwd => (await execute("git", ["rev-parse", "HEAD"], { cwd, timeout: 10000 })).stdout.trim();
  report = {
    bvrCommit: await revision(repository), desktopCommit: await revision(options["--desktop-root"]),
    legacyCommit, legacyVersion, candidateVersion, candidateFingerprint: await packageFingerprint(pluginRoot),
    updateWorkerSha256: createHash("sha256").update(await readFile(join(runtime, "capability-settings.mjs"))).digest("hex"),
    schemaWorkerSha256: createHash("sha256").update(await readFile(join(runtime, "plugin-schema-update.mjs"))).digest("hex"),
    verifierSha256: createHash("sha256").update(await readFile(fileURLToPath(import.meta.url))).digest("hex"),
    desktopMainSha256: createHash("sha256").update(executable
      ? requireDesktop("@electron/asar").extractFile(join(dirname(executable), "resources", "app.asar"), "dist/main.cjs")
      : await readFile(join(desktop, "dist", "main.cjs"))).digest("hex"),
    runtimeCommit: runtimeManifest.commit, bvrRuntime, realSourceElectron: !executable,
    realPackagedElectron: Boolean(executable), executable: executable ?? null, defaultSandbox: true,
    unchangedPluginManifest: true, nativeLauncher: true, productionConfirmationUi: true, realBvrMcp: true,
    realAccountsOrPaidRequests: false, transportFixture: "loopback-only", nativeAsrCall: true,
    pluginUpgrade: true, packagedDesktop: Boolean(executable),
    providerFixtureRequests: providerCalls.length, agentFixtureRequests: agentCalls.length, checks,
  };
} catch (error) {
  console.error(`BVR native acceptance failed during ${phase}`);
  await writeFile(join(output, "failure.json"), JSON.stringify({
    phase, providerCalls, agentCalls, failures, pageErrors,
    hostStatus: ref && page && !page.isClosed() ? await settings().then(value => value.runtime.status).catch(() => null) : null,
    mcpStartup: await readFile(mcpDiagnostics, "utf8").catch(() => ""),
    models: page && !page.isClosed() ? await snapshot().then(value => value.models.map(({ id, provider }) => ({ id, provider }))).catch(() => []) : [],
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
    if (stopped) await removeTestProfile(profile);
  }
}
await writeFile(join(output, "verification.json"), JSON.stringify(report, null, 2) + "\n");
console.log(`BVR native acceptance passed: ${checks.length} checks; ${providerCalls.length} isolated provider calls. ${output}`);
