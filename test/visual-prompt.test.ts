import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { analyzeMediaWithProvider, buildVisualResearchPrompt } from "../src/video-analysis.js";
import { researchBilibiliVideo, selectCaptionCues, selectRepresentativeComments, validateBilibiliWindow } from "../src/bilibili.js";

test("visual research prompt excludes audio while retaining useful visible text", () => {
  const prompt = buildVisualResearchPrompt({
    videoPath: "C:\\research\\trial.mp4",
    question: "Describe the hand movement.",
    mediaDetail: "default",
  });

  assert.match(prompt, /audio stream was removed/);
  assert.match(prompt, /visible text, code, interfaces, charts, labels, and subtitles/i);
  assert.match(prompt, /timestamped direct observations/);
});

test("comment selection shows the top three plus distinct high-signal comments", () => {
  const comments = [
    { like: 100, content: { message: "great video" } },
    { like: 90, content: { message: "thanks" } },
    { like: 80, content: { message: "very useful" } },
    { like: 70, content: { message: "The GitHub repository link is in the description." } },
    { like: 60, content: { message: "Correction: the framework is not version 2." } },
    { like: 50, content: { message: "another generic comment" } },
  ];

  const selected = selectRepresentativeComments(comments);
  assert.equal(selected.length, 5);
  assert.deepEqual(selected.slice(0, 3).map((item) => item.like), [100, 90, 80]);
  assert.deepEqual(selected.slice(3).map((item) => item.like), [70, 60]);
});

test("window prompt preserves source timing", () => {
  const prompt = buildVisualResearchPrompt({
    videoPath: "C:\\research\\trial.mp4",
    question: "Describe the hand movement.",
    mediaDetail: "low",
    sourceStartSeconds: 12,
    sourceEndSeconds: 18.5,
  });

  assert.match(prompt, /12\.00s to 18\.50s/);
});


test("caption selection respects an explicit source interval", () => {
  const cues = [
    { start: 0, end: 10, content: "before and overlap" },
    { start: 20, end: 30, content: "inside" },
    { start: 40, end: 50, content: "after" },
    { start: Number.NaN, end: Number.NaN, content: "untimed" },
  ];

  assert.deepEqual(selectCaptionCues(cues, 8, 22).map((cue) => cue.content), ["before and overlap", "inside", "untimed"]);
});

test("Bilibili source windows require a valid bounded pair", () => {
  assert.doesNotThrow(() => validateBilibiliWindow(60));
  assert.doesNotThrow(() => validateBilibiliWindow(60, 10, 20));
  assert.throws(() => validateBilibiliWindow(60, 10), /provided together/);
  assert.throws(() => validateBilibiliWindow(60, 20, 10), /greater than start_seconds/);
  assert.throws(() => validateBilibiliWindow(60, 10, 61), /within the video duration/);
});

test("Step Plan sends video data URLs directly without the pay-as-you-go files endpoint", async () => {
  const previousProvider = process.env.CODEX_VIDEO_PROVIDER;
  const previousBaseUrl = process.env.STEPFUN_BASE_URL;
  const previousApiKey = process.env.STEPFUN_API_KEY;
  const previousFetch = globalThis.fetch;
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codex-video-mcp-test-"));
  const mediaPath = path.join(directory, "sample.mp4");
  const requestedUrls: string[] = [];

  try {
    await fs.writeFile(mediaPath, Buffer.from("test-video"));
    process.env.CODEX_VIDEO_PROVIDER = "stepfun";
    process.env.STEPFUN_BASE_URL = "https://api.stepfun.com/step_plan/v1";
    process.env.STEPFUN_API_KEY = "test-key";
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      requestedUrls.push(url);
      assert.equal(init?.method, "POST");
      const body = JSON.parse(String(init?.body));
      assert.equal(body.messages[0].content[0].type, "video_url");
      assert.match(body.messages[0].content[0].video_url.url, /^data:video\/mp4;base64,/);
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const result = await analyzeMediaWithProvider(mediaPath, "Inspect this video.");
    assert.equal(result, "ok");
    assert.deepEqual(requestedUrls, ["https://api.stepfun.com/step_plan/v1/chat/completions"]);
  } finally {
    globalThis.fetch = previousFetch;
    await fs.rm(directory, { recursive: true, force: true });
    if (previousProvider === undefined) delete process.env.CODEX_VIDEO_PROVIDER;
    else process.env.CODEX_VIDEO_PROVIDER = previousProvider;
    if (previousBaseUrl === undefined) delete process.env.STEPFUN_BASE_URL;
    else process.env.STEPFUN_BASE_URL = previousBaseUrl;
    if (previousApiKey === undefined) delete process.env.STEPFUN_API_KEY;
    else process.env.STEPFUN_API_KEY = previousApiKey;
  }
});

test("Bilibili research preserves metadata and comments when media analysis is unavailable", async () => {
  const previousCookieFile = process.env.BILIBILI_COOKIES_FILE;
  const previousFetch = globalThis.fetch;
  const responses = [
    {
      code: 0,
      data: {
        aid: 123,
        cid: 456,
        title: "Test video",
        desc: "A public description",
        owner: { name: "Test uploader", mid: 789 },
        pubdate: 1_700_000_000,
        tname: "Research",
        stat: { view: 42 },
        duration: 60,
      },
    },
    {
      code: 0,
      data: { replies: [{ like: 10, member: { uname: "commenter" }, content: { message: "Useful repository link" } }] },
    },
  ];

  try {
    process.env.BILIBILI_COOKIES_FILE = path.join(os.tmpdir(), "codex-video-mcp-missing-cookies.txt");
    globalThis.fetch = (async () => new Response(JSON.stringify(responses.shift()), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch;

    const result = await researchBilibiliVideo({
      url: "https://www.bilibili.com/video/BV1Dg5W69Ecx/",
      question: "What is shown?",
      mode: "vision",
      mediaDetail: "low",
      includeComments: true,
    });

    assert.match(result, /"analysis":"unavailable"/);
    assert.match(result, /Test video/);
    assert.match(result, /Useful repository link/);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousCookieFile === undefined) delete process.env.BILIBILI_COOKIES_FILE;
    else process.env.BILIBILI_COOKIES_FILE = previousCookieFile;
  }
});
