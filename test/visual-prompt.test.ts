import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { analyzeMediaWithProvider, analyzeTextWithProvider, buildVisualResearchPrompt } from "../src/video-analysis.js";
import { researchBilibiliVideo, resolveSourceQualityFailureProvenance, selectCaptionCues, selectRepresentativeComments, validateBilibiliWindow } from "../src/bilibili.js";
import { resolveSourceQuality } from "../src/media-quality.js";

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

test("pinned comments are included outside the hot and high-signal quotas", () => {
  const pinned = { rpid: 999, like: 1, member: { uname: "uploader" }, content: { message: "Pinned framework note" } };
  const sampled = [
    { rpid: 1, like: 100, content: { message: "hot one" } },
    { rpid: 2, like: 90, content: { message: "hot two" } },
    { rpid: 3, like: 80, content: { message: "hot three" } },
    { rpid: 4, like: 70, content: { message: "The GitHub repository is linked below." } },
    { rpid: 5, like: 60, content: { message: "Correction: this is version 2." } },
    { rpid: 999, like: 1, content: { message: "Pinned framework note" } },
  ];

  const selected = selectRepresentativeComments(sampled, [pinned]);
  assert.equal(selected.length, 6);
  assert.equal(selected[0].pinned, true);
  assert.deepEqual(selected.slice(1, 4).map((item) => item.rpid), [1, 2, 3]);
  assert.deepEqual(selected.slice(4).map((item) => item.rpid), [4, 5]);
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


test("StepFun is the default provider and missing credentials do not fall back to Gemini", async () => {
  const previousProvider = process.env.CODEX_VIDEO_PROVIDER;
  const previousBaseUrl = process.env.STEPFUN_BASE_URL;
  const previousApiKey = process.env.STEPFUN_API_KEY;
  const previousGeminiApiKey = process.env.GEMINI_API_KEY;
  const previousFetch = globalThis.fetch;
  const requestedUrls: string[] = [];

  try {
    delete process.env.CODEX_VIDEO_PROVIDER;
    delete process.env.STEPFUN_BASE_URL;
    process.env.STEPFUN_API_KEY = "test-key";
    process.env.GEMINI_API_KEY = "must-not-be-used";
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      requestedUrls.push(url);
      assert.equal(url, "https://api.stepfun.com/v1/chat/completions");
      assert.equal(init?.method, "POST");
      const body = JSON.parse(String(init?.body));
      assert.equal(body.model, "step-3.7-flash");
      return new Response(JSON.stringify({ choices: [{ message: { content: "stepfun response" } }] }), { status: 200 });
    }) as typeof fetch;

    assert.equal(await analyzeTextWithProvider("default provider"), "stepfun response");

    delete process.env.STEPFUN_API_KEY;
    await assert.rejects(() => analyzeTextWithProvider("missing key"), /STEPFUN_API_KEY is not configured/);
    assert.deepEqual(requestedUrls, ["https://api.stepfun.com/v1/chat/completions"]);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousProvider === undefined) delete process.env.CODEX_VIDEO_PROVIDER;
    else process.env.CODEX_VIDEO_PROVIDER = previousProvider;
    if (previousBaseUrl === undefined) delete process.env.STEPFUN_BASE_URL;
    else process.env.STEPFUN_BASE_URL = previousBaseUrl;
    if (previousApiKey === undefined) delete process.env.STEPFUN_API_KEY;
    else process.env.STEPFUN_API_KEY = previousApiKey;
    if (previousGeminiApiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousGeminiApiKey;
  }
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
      assert.match(body.messages[0].content[1].text, /Analysis detail: coarse pass/);
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const result = await analyzeMediaWithProvider(mediaPath, "Inspect this video.", "low");
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

test("downloaded source quality remains visible when later media analysis fails", () => {
  const quality = resolveSourceQuality();
  const downloadedQuality = {
    status: "matched" as const,
    requestedResolution: "1080p" as const,
    requestedFps: 30 as const,
    onUnavailable: "error" as const,
    actualHeight: 1080,
    actualFps: 30,
    formatId: "137+140",
  };

  const afterDownloadFailure = resolveSourceQualityFailureProvenance(
    quality,
    downloadedQuality,
    new Error("StepFun API request failed (500)."),
  );
  assert.equal(afterDownloadFailure?.status, "matched");
  assert.equal(afterDownloadFailure?.actual_resolution, 1080);
  assert.equal(afterDownloadFailure?.actual_fps, 30);

  const beforeDownloadFailure = resolveSourceQualityFailureProvenance(
    quality,
    undefined,
    new Error("yt-dlp could not produce a readable video."),
  );
  assert.equal(beforeDownloadFailure?.status, "unavailable");
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
      data: [{ tag_name: "finance" }, { tag_name: "quant" }],
    },
    {
      code: 0,
      data: { replies: [{ like: 10, member: { uname: "commenter" }, content: { message: "Useful repository link" } }], top: { rpid: 321, like: 1, member: { uname: "uploader" }, content: { message: "Pinned note" } } },
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
    assert.match(result, /"category": "Research"/);
    assert.match(result, /"tags": \[\n\s+"finance",\n\s+"quant"\n\s+\]/);
    assert.match(result, /Useful repository link/);
    assert.match(result, /"pinned": true/);
    assert.match(result, /Pinned note/);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousCookieFile === undefined) delete process.env.BILIBILI_COOKIES_FILE;
    else process.env.BILIBILI_COOKIES_FILE = previousCookieFile;
  }
});

test("Bilibili research keeps deterministic context outside the model answer", async () => {
  const previousProvider = process.env.CODEX_VIDEO_PROVIDER;
  const previousBaseUrl = process.env.STEPFUN_BASE_URL;
  const previousApiKey = process.env.STEPFUN_API_KEY;
  const previousFetch = globalThis.fetch;
  let providerPrompt = "";

  try {
    process.env.CODEX_VIDEO_PROVIDER = "stepfun";
    process.env.STEPFUN_BASE_URL = "https://api.stepfun.com/v1";
    process.env.STEPFUN_API_KEY = "test-key";
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      if (url.includes("/x/web-interface/view")) {
        return new Response(JSON.stringify({
          code: 0,
          data: {
            aid: 1,
            cid: 2,
            title: "Context video",
            desc: "Description from Bilibili",
            owner: { name: "Context uploader", mid: 3 },
            pubdate: 1_700_000_000,
            tname: "Tutorial",
            stat: { view: 7 },
            duration: 60,
          },
        }), { status: 200 });
      }
      if (url.includes("/x/tag/archive/tags")) {
        return new Response(JSON.stringify({ code: 0, data: [{ tag_name: "agent" }] }), { status: 200 });
      }
      if (url.includes("/x/v2/reply")) {
        return new Response(JSON.stringify({ code: 0, data: { replies: [{ rpid: 4, like: 9, member: { uname: "viewer" }, content: { message: "Community comment" } }] } }), { status: 200 });
      }
      if (url.includes("/x/player/v2")) {
        return new Response(JSON.stringify({ code: 0, data: { subtitle: { subtitles: [{ subtitle_url: "https://subtitle.test/subtitle.json" }] } } }), { status: 200 });
      }
      if (url === "https://subtitle.test/subtitle.json") {
        return new Response(JSON.stringify({ body: [{ from: 0, to: 2, content: "A caption" }] }), { status: 200 });
      }
      if (url.endsWith("/chat/completions")) {
        const body = JSON.parse(String(init?.body));
        providerPrompt = body.messages[0].content;
        return new Response(JSON.stringify({ choices: [{ message: { content: "model answer intentionally omits context" } }] }), { status: 200 });
      }
      throw new Error(`Unexpected request: ${url}`);
    }) as typeof fetch;

    const result = await researchBilibiliVideo({
      url: "https://www.bilibili.com/video/BV1Dg5W69Ecx/",
      question: "What is said?",
      mode: "language",
      mediaDetail: "default",
      includeComments: true,
    });

    assert.match(result, /"analysis":"complete"/);
    assert.match(result, /VIDEO CONTEXT/);
    assert.match(result, /Context video/);
    assert.match(result, /Context uploader/);
    assert.match(result, /Community comment/);
    assert.match(result, /model answer intentionally omits context/);
    assert.match(providerPrompt, /VIDEO CONTEXT/);
    assert.match(providerPrompt, /Community comment/);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousProvider === undefined) delete process.env.CODEX_VIDEO_PROVIDER;
    else process.env.CODEX_VIDEO_PROVIDER = previousProvider;
    if (previousBaseUrl === undefined) delete process.env.STEPFUN_BASE_URL;
    else process.env.STEPFUN_BASE_URL = previousBaseUrl;
    if (previousApiKey === undefined) delete process.env.STEPFUN_API_KEY;
    else process.env.STEPFUN_API_KEY = previousApiKey;
  }
});

test("Bilibili research distinguishes empty context from auxiliary API failures", async () => {
  const previousCookieFile = process.env.BILIBILI_COOKIES_FILE;
  const previousFetch = globalThis.fetch;
  const missingCookieFile = path.join(os.tmpdir(), "codex-video-mcp-missing-cookies.txt");
  let tagPayload: unknown = { code: 0, data: [] };
  let commentPayload: unknown = { code: 0, data: { replies: [] } };

  try {
    process.env.BILIBILI_COOKIES_FILE = missingCookieFile;
    globalThis.fetch = (async (input) => {
      const url = String(input);
      if (url.includes("/x/web-interface/view")) {
        return new Response(JSON.stringify({
          code: 0,
          data: {
            aid: 10,
            cid: 20,
            title: "Status video",
            desc: "Description",
            owner: { name: "Uploader", mid: 30 },
            pubdate: 1_700_000_000,
            tname: "Research",
            stat: { view: 1 },
            duration: 30,
          },
        }), { status: 200 });
      }
      if (url.includes("/x/tag/archive/tags")) return new Response(JSON.stringify(tagPayload), { status: 200 });
      if (url.includes("/x/v2/reply")) return new Response(JSON.stringify(commentPayload), { status: 200 });
      throw new Error(`Unexpected request: ${url}`);
    }) as typeof fetch;

    const emptyResult = await researchBilibiliVideo({
      url: "https://www.bilibili.com/video/BV1Dg5W69Ecx/",
      question: "What is shown?",
      mode: "vision",
      mediaDetail: "low",
      includeComments: true,
    });
    assert.match(emptyResult, /"community_status":"empty"/);
    assert.match(emptyResult, /"tags_status":"empty"/);
    assert.match(emptyResult, /"status": "empty"/);
    assert.match(emptyResult, /"displayed_count": 0/);

    tagPayload = { code: -400, message: "tags unavailable" };
    commentPayload = { code: -403, message: "comments unavailable" };
    const failedResult = await researchBilibiliVideo({
      url: "https://www.bilibili.com/video/BV1Dg5W69Ecx/",
      question: "What is shown?",
      mode: "vision",
      mediaDetail: "low",
      includeComments: true,
    });
    assert.match(failedResult, /"analysis":"unavailable"/);
    assert.match(failedResult, /"community_status":"fetch_failed"/);
    assert.match(failedResult, /"tags_status":"fetch_failed"/);
    assert.match(failedResult, /Status video/);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousCookieFile === undefined) delete process.env.BILIBILI_COOKIES_FILE;
    else process.env.BILIBILI_COOKIES_FILE = previousCookieFile;
  }
});
