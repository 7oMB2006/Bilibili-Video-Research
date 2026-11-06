import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { analyzeMediaWithProvider } from "../src/video-analysis.js";
import { createResearchDirectory } from "../src/bilibili.js";

test("independent ASR and synthesis use their own endpoints, keys and models, without failure fallback", async t => {
  const root = await mkdtemp(join(tmpdir(), "bvr-separate-asr-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const audio = join(root, "audio.wav");
  await writeFile(audio, "fixture");
  const values = {
    CODEX_VIDEO_PROVIDER: "stepfun", BVR_DFSC_MODE: "",
    STEPFUN_BASE_URL: "https://api.stepfun.com/v1", STEPFUN_API_KEY: "main-key", STEPFUN_VIDEO_MODEL: "visual-main",
    STEPFUN_ASR_BASE_URL: "https://api.stepfun.ai/step_plan/v1", STEPFUN_ASR_API_KEY: "asr-key", STEPFUN_ASR_MODEL: "speech-model",
  };
  const saved = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  const fetch = globalThis.fetch;
  Object.assign(process.env, values);
  const calls: { url: string; key: string | null; body: any }[] = [];
  let fail = false;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), key: new Headers(init?.headers).get("Authorization"), body: JSON.parse(String(init?.body)) });
    return fail ? new Response("unavailable", { status: 429 })
      : String(url).endsWith("/audio/asr/sse") ? new Response('data: {"type":"transcript.text.done","text":"speech"}\n\n')
        : Response.json({ choices: [{ message: { content: "synthesized" } }] });
  };
  try {
    assert.equal(await analyzeMediaWithProvider(audio, "summarize"), "synthesized");
    assert.equal(calls[0].url, "https://api.stepfun.ai/step_plan/v1/audio/asr/sse");
    assert.equal(calls[0].key, "Bearer asr-key");
    assert.equal(calls[0].body.audio.input.transcription.model, "speech-model");
    assert.equal(calls[1].url, "https://api.stepfun.com/v1/chat/completions");
    assert.equal(calls[1].key, "Bearer main-key");
    assert.equal(calls[1].body.model, "visual-main");
    calls.length = 0; fail = true;
    await assert.rejects(analyzeMediaWithProvider(audio, "summarize"), /429/);
    assert.equal(calls.length, 1);
    calls.length = 0; delete process.env.STEPFUN_ASR_API_KEY;
    await assert.rejects(analyzeMediaWithProvider(audio, "summarize"), /No fallback/);
    assert.equal(calls.length, 0);
  } finally {
    globalThis.fetch = fetch;
    for (const key of Object.keys(values)) {
      if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
    }
  }
});

test("configured download root produces separate temporary directories", async t => {
  const root = await mkdtemp(join(tmpdir(), "bvr-download-root-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const saved = process.env.BILIBILI_DOWNLOAD_DIRECTORY;
  process.env.BILIBILI_DOWNLOAD_DIRECTORY = join(root, "downloads");
  try {
    const first = await createResearchDirectory(), second = await createResearchDirectory();
    assert.equal(dirname(first), process.env.BILIBILI_DOWNLOAD_DIRECTORY);
    assert.notEqual(first, second);
    process.env.BILIBILI_DOWNLOAD_DIRECTORY = "relative-folder";
    await assert.rejects(createResearchDirectory(), /absolute/);
  } finally {
    if (saved === undefined) delete process.env.BILIBILI_DOWNLOAD_DIRECTORY; else process.env.BILIBILI_DOWNLOAD_DIRECTORY = saved;
  }
});
