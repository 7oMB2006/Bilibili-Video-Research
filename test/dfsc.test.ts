import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzeWithDfsc, withDfscOperation } from "../src/dfsc.js";
import { analyzeMediaWithProvider, analyzeTextWithProvider } from "../src/video-analysis.js";
import { hostLaunch } from "./dfsc-launch.mjs";

test("generic hosted BVR pins one context, consumes its launch and never uses independent credentials", async t => {
  const root = await mkdtemp(join(tmpdir(), "bvr-dfsc-audio-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const audio = join(root, "fixture.wav");
  await writeFile(audio, Buffer.from("abcd"));
  const originalFetch = globalThis.fetch;
  const keys = ["DFSC_LAUNCH_CONTEXT", "BVR_DFSC_MODE", "STEPFUN_API_KEY", "STEPFUN_BASE_URL", "CODEX_VIDEO_PROVIDER"];
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, { DFSC_LAUNCH_CONTEXT: JSON.stringify(hostLaunch()),
    STEPFUN_API_KEY: "must-not-be-used", STEPFUN_BASE_URL: "https://api.stepfun.com/v1", CODEX_VIDEO_PROVIDER: "gemini" });
  try {
    const requests: { path: string; body: any }[] = [];
    let version = "b".repeat(64), asr = true, failure = "";
    let hold = false, cancelled = 0;
    let entered: (() => void) | undefined;
    globalThis.fetch = async (url, init) => {
      const path = new URL(String(url)).pathname;
      const body = JSON.parse(String(init!.body));
      requests.push({ path, body });
      assert.equal(new URL(String(url)).hostname, "127.0.0.1");
      assert.doesNotMatch(String(init!.body), /must-not-be-used/);
      if (path === "/v1/context") return Response.json({ version: 1, revision: version,
        capabilities: ["model.text", "model.video", "model.asr"].map(id => id === "model.asr" && !asr
          ? { id, available: false, reason: "CAPABILITY_UNAVAILABLE" }
          : { id, available: true, model: id === "model.asr" ? "stepaudio-2.5-asr" : "step-5-preview", channel: "plan", region: "cn" }) });
      if (path === "/v1/cancel") {
        cancelled++;
        return Response.json({ version: 1, requestId: body.requestId, cancelled: true });
      }
      assert.equal(path, "/v1/invoke");
      assert.equal(body.runtimePid, undefined);
      if (body.revision !== version) return Response.json({ version: 1, error: { code: "STALE_CONTEXT" } }, { status: 409 });
      if (failure) return Response.json({ version: 1, error: { code: failure } }, { status: 403 });
      if (hold) {
        entered?.();
        return new Promise<Response>((_done, reject) => {
          if (init?.signal?.aborted) reject(new DOMException("Aborted", "AbortError"));
          else init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
        });
      }
      return Response.json({ version: 1, requestId: body.requestId, result: { type: "text", text: "hosted result" } });
    };
    await withDfscOperation(async () => {
      assert.equal(await analyzeTextWithProvider("summarize"), "hosted result");
      assert.equal(process.env.DFSC_LAUNCH_CONTEXT, undefined);
      version = "c".repeat(64);
      await assert.rejects(analyzeTextWithProvider("second stage"), /STALE_CONTEXT/);
    });
    assert.equal(requests.filter(item => item.path === "/v1/context").length, 1);
    assert.equal(requests.filter(item => item.path === "/v1/invoke").length, 2);
    assert.equal(await analyzeTextWithProvider("new research"), "hosted result");
    const before = requests.length;
    assert.equal(await analyzeMediaWithProvider(audio, "transcribe"), "hosted result");
    assert.deepEqual(requests.slice(before).map(item => item.path), ["/v1/context", "/v1/invoke", "/v1/invoke"]);
    assert.equal(requests[before + 1].body.capability, "model.asr");
    assert.deepEqual(requests[before + 1].body.input, { audio: { mimeType: "audio/wav", data: "YWJjZA==" } });
    assert.equal(requests[before + 2].body.revision, version);
    assert.match(requests[before + 2].body.input.messages[0].content, /ASR TRANSCRIPT \(language evidence\):\nhosted result/);
    for (failure of ["DENIED", "AUTHORIZATION_REQUIRED", "STALE_CONTEXT", "PROVIDER_FAILED"]) {
      const failed = requests.length;
      await assert.rejects(analyzeMediaWithProvider(audio, "transcribe"), new RegExp(failure));
      assert.deepEqual(requests.slice(failed).map(item => item.path), ["/v1/context", "/v1/invoke"]);
    }
    failure = "";
    asr = false;
    const disabled = requests.length;
    await assert.rejects(analyzeWithDfsc("asr", "transcribe", { mimeType: "audio/wav", data: "YWJjZA==" }), /CAPABILITY_UNAVAILABLE/);
    assert.equal(requests.length, disabled + 1);
    const video = await analyzeWithDfsc("video", "inspect", { mimeType: "video/mp4", data: "YWJjZA==" });
    assert.equal(video, "hosted result");
    assert.deepEqual(requests.at(-1)!.body.input.video, { mimeType: "video/mp4", data: "YWJjZA==" });
    assert.equal(requests.at(-1)!.body.capability, "model.video");
    hold = true;
    const controller = new AbortController();
    const waiting = new Promise<void>(done => { entered = done; });
    const pending = withDfscOperation(() => analyzeTextWithProvider("cancel"), controller.signal);
    await waiting;
    controller.abort();
    await assert.rejects(pending, /CANCELLED/);
    assert.equal(cancelled, 1);
    const beforeCancelled = requests.length;
    await assert.rejects(withDfscOperation(() => analyzeTextWithProvider("already cancelled"), controller.signal), /CANCELLED/);
    assert.equal(requests.slice(beforeCancelled).some(item => item.path === "/v1/invoke"), false);
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of keys) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; }
  }
});
