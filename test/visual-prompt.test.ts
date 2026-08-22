import assert from "node:assert/strict";
import test from "node:test";
import { buildVisualResearchPrompt } from "../src/video-analysis.js";
import { selectCaptionCues, selectRepresentativeComments, validateBilibiliWindow } from "../src/bilibili.js";

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
