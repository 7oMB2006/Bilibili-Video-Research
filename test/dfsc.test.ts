import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzeWithDfsc, withDfscOperation } from "../src/dfsc.js";
import { analyzeMediaWithProvider, analyzeTextWithProvider } from "../src/video-analysis.js";

test("hosted BVR pins one context per research and never reaches independent credentials", async t => {
  const root = await mkdtemp(join(tmpdir(), "bvr-dfsc-audio-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const audio = join(root, "fixture.wav");
  await writeFile(audio, Buffer.from("abcd"));
  const originalFetch = globalThis.fetch;
  const keys = ["BVR_DFSC_MODE", "BVR_DFSC_URL", "BVR_DFSC_TOKEN", "BVR_DFSC_RUNTIME_PID", "STEPFUN_API_KEY", "STEPFUN_BASE_URL", "CODEX_VIDEO_PROVIDER"];
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, { BVR_DFSC_MODE: "1", BVR_DFSC_URL: "http://127.0.0.1:12345",
    BVR_DFSC_TOKEN: "a".repeat(64), BVR_DFSC_RUNTIME_PID: "1234",
    STEPFUN_API_KEY: "must-not-be-used", STEPFUN_BASE_URL: "https://api.stepfun.com/v1", CODEX_VIDEO_PROVIDER: "gemini" });
  try {
    const requests: { path: string; body: any }[] = [];
    let version = "b".repeat(48), asr = true, failAsr = false;
    globalThis.fetch = async (url, init) => {
      const path = new URL(String(url)).pathname;
      const body = JSON.parse(String(init!.body));
      requests.push({ path, body });
      assert.equal(new URL(String(url)).hostname, "127.0.0.1");
      assert.doesNotMatch(String(init!.body), /must-not-be-used/);
      if (path === "/context") return Response.json({ version: 1, revision: version, channel: "plan",
        region: "cn", model: "step-5-preview", capabilities: { text: true, video: true, asr } });
      if (body.revision !== version) return Response.json({ error: "DFSC account changed; start a new research" }, { status: 409 });
      if (failAsr && body.kind === "asr")
        return Response.json({ error: "Step plan request failed (HTTP 429); no fallback was used" }, { status: 400 });
      return Response.json({ text: "hosted result" });
    };
    await withDfscOperation(async () => {
      assert.equal(await analyzeTextWithProvider("summarize"), "hosted result");
      version = "c".repeat(48);
      await assert.rejects(analyzeTextWithProvider("second stage"), /account changed/);
    });
    assert.equal(requests.filter(item => item.path === "/context").length, 1);
    assert.equal(requests.filter(item => item.path === "/complete").length, 2);
    assert.equal(await analyzeTextWithProvider("new research"), "hosted result");
    const before = requests.length;
    assert.equal(await analyzeMediaWithProvider(audio, "transcribe"), "hosted result");
    assert.deepEqual(requests.slice(before).map(item => item.path), ["/context", "/complete", "/complete"]);
    assert.deepEqual(requests[before + 1].body, { runtimePid: 1234, revision: version, kind: "asr",
      prompt: "transcribe", media: { mimeType: "audio/wav", data: "YWJjZA==" } });
    assert.equal(requests[before + 2].body.revision, version);
    assert.match(requests[before + 2].body.prompt, /ASR TRANSCRIPT \(language evidence\):\nhosted result/);
    failAsr = true;
    const failed = requests.length;
    await assert.rejects(analyzeMediaWithProvider(audio, "transcribe"), /Step plan request failed.*no fallback/);
    assert.deepEqual(requests.slice(failed).map(item => item.path), ["/context", "/complete"]);
    asr = false;
    const disabled = requests.length;
    await assert.rejects(analyzeWithDfsc("asr", "transcribe", { mimeType: "audio/wav", data: "YWJjZA==" }), /host did not enable ASR/);
    assert.equal(requests.length, disabled + 1);
    process.env.BVR_DFSC_URL = "https://example.invalid";
    await assert.rejects(analyzeTextWithProvider("must not fallback"), /missing or invalid/);
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of keys) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; }
  }
});
