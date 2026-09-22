import assert from "node:assert/strict";
import test from "node:test";
import {
  assessDownloadedQuality,
  parseYtDlpMetadata,
  resolveSourceQuality,
  selectYtDlpFormat,
} from "../src/media-quality.js";

const standardFormats = {
  formats: [
    { format_id: "137", vcodec: "avc1", acodec: "none", height: 1080, fps: 30, tbr: 4500 },
    { format_id: "30280", vcodec: "hev1", acodec: "none", height: 720, fps: 30, tbr: 2200 },
    { format_id: "140", vcodec: "none", acodec: "mp4a", abr: 128 },
  ],
};

test("standard source quality resolves to 1080p30", () => {
  assert.deepEqual(resolveSourceQuality(), {
    profile: "standard",
    resolution: "1080p",
    height: 1080,
    fps: 30,
    onUnavailable: "error",
  });
});

test("strict source quality selects the exact video and audio formats", () => {
  const quality = resolveSourceQuality();
  const selection = selectYtDlpFormat(standardFormats, quality);

  assert.equal(selection.selector, "137+140");
  assert.equal(selection.height, 1080);
  assert.equal(selection.fps, 30);
});

test("strict source quality accepts a higher available frame rate", () => {
  const quality = resolveSourceQuality();
  const selection = selectYtDlpFormat({
    formats: [
      { format_id: "399", vcodec: "av01", acodec: "none", height: 1080, fps: 60, tbr: 6500 },
      { format_id: "140", vcodec: "none", acodec: "mp4a", abr: 128 },
    ],
  }, quality);

  assert.equal(selection.selector, "399+140");
  assert.equal(selection.height, 1080);
  assert.equal(selection.fps, 60);
  assert.equal(assessDownloadedQuality({
    format_id: selection.formatId,
    height: selection.height,
    fps: selection.fps,
  }, quality, selection).status, "matched");
});

test("strict source quality rejects a lower-only source", () => {
  const quality = resolveSourceQuality();

  assert.throws(
    () => selectYtDlpFormat({
      formats: [
        { format_id: "30280", vcodec: "hev1", acodec: "none", height: 720, fps: 30 },
        { format_id: "140", vcodec: "none", acodec: "mp4a", abr: 128 },
      ],
    }, quality),
    /Requested source quality 1080p@30fps is unavailable/,
  );
});

test("warn source quality reports an explicit lower-quality fallback", () => {
  const quality = resolveSourceQuality({ onUnavailable: "warn" });
  const metadata = {
    ...standardFormats,
    formats: [
      { format_id: "30280", vcodec: "hev1", acodec: "none", height: 720, fps: 30, tbr: 2200 },
      { format_id: "140", vcodec: "none", acodec: "mp4a", abr: 128 },
    ],
  };
  const selection = selectYtDlpFormat(metadata, quality);
  const report = assessDownloadedQuality({
    ...metadata,
    format_id: selection.formatId,
    height: selection.height,
    fps: selection.fps,
    requested_formats: metadata.formats,
  }, quality, selection);

  assert.equal(selection.selector, "30280+140");
  assert.equal(report.status, "degraded");
  assert.match(report.degradationReason ?? "", /720p/);
});

test("yt-dlp JSON parsing ignores non-JSON output lines", () => {
  const metadata = parseYtDlpMetadata([
    "[download] 100% of 10MiB",
    JSON.stringify({ format_id: "137", height: 1080, fps: 30 }),
  ].join("\n"));

  assert.equal(metadata.format_id, "137");
  assert.equal(metadata.height, 1080);
});
