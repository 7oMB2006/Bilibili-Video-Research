import { createPartFromUri, FileState, GoogleGenAI, PartMediaResolutionLevel } from "@google/genai";
import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { execFile as execFileCallback } from "node:child_process";

const execFile = promisify(execFileCallback);
const require = createRequire(import.meta.url);
const ffmpegStatic = require("ffmpeg-static") as string | null;
const PROCESSING_TIMEOUT_MS = 5 * 60 * 1000;
const SUPPORTED_VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".avi", ".mkv", ".webm", ".mpeg", ".mpg"]);
const SUPPORTED_MEDIA_EXTENSIONS = new Set([...SUPPORTED_VIDEO_EXTENSIONS, ".m4a", ".mp3", ".wav", ".aac", ".ogg"]);

export type MediaDetail = "low" | "default";
export type VideoProvider = "gemini" | "stepfun";

export interface AnalysisRequest {
  videoPath: string;
  question: string;
  mediaDetail: MediaDetail;
  sourceStartSeconds?: number;
  sourceEndSeconds?: number;
}

function selectedProvider(): VideoProvider {
  const value = (process.env.CODEX_VIDEO_PROVIDER ?? "gemini").toLowerCase();
  if (value === "gemini" || value === "stepfun") return value;
  throw new Error("CODEX_VIDEO_PROVIDER must be gemini or stepfun. MiniMax has no documented video-input understanding API.");
}

function mediaMimeType(mediaPath: string): string {
  const extension = path.extname(mediaPath).toLowerCase();
  const types: Record<string, string> = {
    ".mp4": "video/mp4", ".mov": "video/quicktime", ".mkv": "video/x-matroska",
    ".webm": "video/webm", ".m4a": "audio/mp4", ".mp3": "audio/mpeg",
    ".wav": "audio/wav", ".aac": "audio/aac", ".ogg": "audio/ogg",
  };
  return types[extension] ?? "application/octet-stream";
}

export function buildVisualResearchPrompt(request: AnalysisRequest): string {
  const range = request.sourceStartSeconds === undefined
    ? "Inspect the complete supplied clip."
    : `This clip is the source-video interval ${request.sourceStartSeconds.toFixed(2)}s to ${request.sourceEndSeconds?.toFixed(2)}s.`;

  return [
    "You are a scientific visual-observation assistant.",
    "Use the video frames only. The audio stream was removed before upload.",
    "Treat visible text, code, interfaces, charts, labels, and subtitles as visual evidence when they help answer the question.",
    "Do not identify people, infer intent, diagnose, or assert causes beyond what the pixels support.",
    range,
    `Research question: ${request.question}`,
    "Return: (1) timestamped direct observations, (2) explicitly labeled tentative visual inferences only when necessary, (3) uncertainty or occlusion limits.",
    "For every claimed action, name the actor only with neutral labels such as Person A and describe body movement, object interaction, direction, and temporal order.",
  ].join("\n");
}

function partResolution(detail: MediaDetail): PartMediaResolutionLevel | undefined {
  return detail === "low" ? PartMediaResolutionLevel.MEDIA_RESOLUTION_LOW : undefined;
}

async function assertReadableMedia(videoPath: string): Promise<void> {
  const stat = await fs.stat(videoPath);
  if (!stat.isFile()) {
    throw new Error("video_path must point to a file.");
  }
  if (!SUPPORTED_MEDIA_EXTENSIONS.has(path.extname(videoPath).toLowerCase())) {
    throw new Error(`Unsupported media extension: ${path.extname(videoPath) || "(none)"}.`);
  }
}

async function waitForFile(ai: GoogleGenAI, name: string): Promise<{ uri: string; mimeType: string }> {
  const deadline = Date.now() + PROCESSING_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const current = await ai.files.get({ name });
    if (current.state === FileState.ACTIVE && current.uri && current.mimeType) {
      return { uri: current.uri, mimeType: current.mimeType };
    }
    if (current.state === FileState.FAILED) {
      throw new Error(`Gemini could not process the video: ${current.error?.message ?? "unknown processing error"}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error("Timed out while Gemini processed the video.");
}

export function getFfmpegPath(): string {
  const executable = process.env.FFMPEG_PATH ?? ffmpegStatic;
  if (!executable) {
    throw new Error("ffmpeg-static did not provide an executable. Set FFMPEG_PATH to a working ffmpeg executable.");
  }
  return executable;
}

export async function createSilentWindow(videoPath: string, startSeconds: number, endSeconds: number): Promise<{ directory: string; clipPath: string }> {
  if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) || startSeconds < 0 || endSeconds <= startSeconds) {
    throw new Error("start_seconds must be >= 0 and end_seconds must be greater than start_seconds.");
  }
  const directory = await fs.mkdtemp(path.join(tmpdir(), "codex-video-mcp-"));
  const clipPath = path.join(directory, "window.mp4");
  try {
    await execFile(getFfmpegPath(), [
      "-hide_banner", "-loglevel", "error", "-y",
      "-ss", String(startSeconds),
      "-i", videoPath,
      "-t", String(endSeconds - startSeconds),
      "-map", "0:v:0?",
      "-an",
      "-c:v", "libx264",
      "-movflags", "+faststart",
      clipPath,
    ]);
    return { directory, clipPath };
  } catch (error) {
    await fs.rm(directory, { recursive: true, force: true });
    throw error;
  }
}

export async function createSilentVideo(videoPath: string): Promise<{ directory: string; videoPath: string }> {
  const directory = await fs.mkdtemp(path.join(tmpdir(), "codex-video-mcp-"));
  const silentPath = path.join(directory, "silent.mp4");
  try {
    await execFile(getFfmpegPath(), [
      "-hide_banner", "-loglevel", "error", "-y", "-i", videoPath,
      "-map", "0:v:0?", "-an", "-c:v", "libx264", "-movflags", "+faststart", silentPath,
    ]);
    return { directory, videoPath: silentPath };
  } catch (error) {
    await fs.rm(directory, { recursive: true, force: true });
    throw error;
  }
}

export async function createAudioTrack(videoPath: string): Promise<{ directory: string; audioPath: string }> {
  const directory = await fs.mkdtemp(path.join(tmpdir(), "codex-video-mcp-"));
  const audioPath = path.join(directory, "audio.wav");
  try {
    await execFile(getFfmpegPath(), [
      "-hide_banner", "-loglevel", "error", "-y", "-i", videoPath,
      "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", audioPath,
    ]);
    return { directory, audioPath };
  } catch (error) {
    await fs.rm(directory, { recursive: true, force: true });
    throw error;
  }
}

export async function analyzeMediaWithProvider(mediaPath: string, prompt: string, mediaDetail: MediaDetail = "default"): Promise<string> {
  await assertReadableMedia(mediaPath);
  if (selectedProvider() === "stepfun") return analyzeMediaWithStepfun(mediaPath, prompt);
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured for codex-video-mcp.");
  }

  const ai = new GoogleGenAI({ apiKey });
  const uploaded = await ai.files.upload({
    file: mediaPath,
    config: { displayName: path.basename(mediaPath) },
  });
  if (!uploaded.name) {
    throw new Error("Gemini did not return a file name after upload.");
  }

  try {
    const file = await waitForFile(ai, uploaded.name);
    const response = await ai.models.generateContent({
      model: process.env.GEMINI_VIDEO_MODEL ?? "gemini-2.5-flash",
      contents: [{
        role: "user",
        parts: [
          createPartFromUri(file.uri, file.mimeType, partResolution(mediaDetail)),
          { text: prompt },
        ],
      }],
    });
    if (!response.text) {
      throw new Error("Gemini returned no text response for this video.");
    }
    return response.text;
  } finally {
    await ai.files.delete({ name: uploaded.name }).catch(() => undefined);
  }
}

function stepfunBaseUrl(): string {
  const configured = process.env.STEPFUN_BASE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  const provider = selectedProvider();
  if (provider === "stepfun") {
    throw new Error("STEPFUN_BASE_URL must be configured. Use https://api.stepfun.com/step_plan/v1 for Step Plan (subscription Credit) or https://api.stepfun.com/v1 for pay-as-you-go balance.");
  }
  return "https://api.stepfun.com/step_plan/v1";
}

async function stepfunRequest(pathname: string, init: RequestInit): Promise<Response> {
  const apiKey = process.env.STEPFUN_API_KEY;
  if (!apiKey) throw new Error("STEPFUN_API_KEY is not configured for codex-video-mcp.");
  const response = await fetch(`${stepfunBaseUrl()}${pathname}`, {
    ...init,
    headers: { Authorization: `Bearer ${apiKey}`, ...(init.headers ?? {}) },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`StepFun API request failed (${response.status}): ${body.slice(0, 500)}`);
  }
  return response;
}

async function analyzeMediaWithStepfun(mediaPath: string, prompt: string): Promise<string> {
  const sourceMimeType = mediaMimeType(mediaPath);
  if (sourceMimeType.startsWith("audio/")) {
    const transcript = await transcribeAudioWithStepfun(mediaPath, sourceMimeType);
    return analyzeTextWithStepfun(`${prompt}\n\nASR TRANSCRIPT (language evidence):\n${transcript}`);
  }
  if (stepfunBaseUrl().includes("step_plan")) {
    const bytes = await fs.readFile(mediaPath);
    const dataUrl = `data:${sourceMimeType};base64,${bytes.toString("base64")}`;
    return analyzeContentWithStepfun([
      { type: "video_url", video_url: { url: dataUrl } },
      { type: "text", text: prompt },
    ]);
  }
  const bytes = await fs.readFile(mediaPath);
  const mimeType = sourceMimeType;
  const form = new FormData();
  form.append("purpose", "storage");
  form.append("file", new Blob([bytes], { type: mimeType }), path.basename(mediaPath));
  const uploadResponse = await stepfunRequest("/files", { method: "POST", body: form });
  const uploaded = await uploadResponse.json() as { id?: string; data?: { id?: string } };
  const fileId = uploaded.id ?? uploaded.data?.id;
  if (!fileId) throw new Error("StepFun did not return a file ID after upload.");
  try {
    return await analyzeContentWithStepfun([
      { type: "video_url", video_url: { url: `stepfile://${fileId}` } },
      { type: "text", text: prompt },
    ]);
  } finally {
    await stepfunRequest(`/files/${fileId}`, { method: "DELETE" }).catch(() => undefined);
  }
}

async function analyzeContentWithStepfun(content: unknown[]): Promise<string> {
  const completion = await stepfunRequest("/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.STEPFUN_VIDEO_MODEL ?? "step-3.7-flash",
      messages: [{ role: "user", content }],
    }),
  });
  const result = await completion.json() as { choices?: Array<{ message?: { content?: string } }> };
  const text = result.choices?.[0]?.message?.content;
  if (!text) throw new Error("StepFun returned no text response for this media.");
  return text;
}

async function transcribeAudioWithStepfun(audioPath: string, mimeType: string): Promise<string> {
  const bytes = await fs.readFile(audioPath);
  const response = await stepfunRequest("/audio/asr/sse", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "text/event-stream",
    },
    body: JSON.stringify({
      audio: {
        data: bytes.toString("base64"),
        input: {
          transcription: {
            model: process.env.STEPFUN_ASR_MODEL ?? "stepaudio-2.5-asr",
            language: process.env.STEPFUN_ASR_LANGUAGE ?? "zh",
            enable_itn: true,
          },
          format: { type: "wav" },
        },
      },
    }),
  });
  const streamText = await response.text();
  const deltas: string[] = [];
  const doneTexts: string[] = [];
  for (const rawEvent of streamText.split(/\r?\n\r?\n/)) {
    const dataLine = rawEvent.split(/\r?\n/).find((line) => line.startsWith("data:"));
    if (!dataLine) continue;
    let event: { type?: string; delta?: string; text?: string; message?: string };
    try {
      event = JSON.parse(dataLine.slice(5).trim());
    } catch {
      continue;
    }
    if (event.type === "transcript.text.delta" && event.delta) deltas.push(event.delta);
    else if (event.type === "transcript.text.done" && event.text) doneTexts.push(event.text);
    else if (event.type === "error") throw new Error(`StepFun ASR error: ${event.message ?? "unknown error"}`);
  }
  const transcript = doneTexts.join("") || deltas.join("");
  if (!transcript.trim()) throw new Error("StepFun ASR returned no transcript.");
  return transcript;
}

export { transcribeAudioWithStepfun };

export async function analyzeTextWithProvider(prompt: string): Promise<string> {
  if (selectedProvider() === "stepfun") return analyzeTextWithStepfun(prompt);
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured for codex-video-mcp.");
  }
  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: process.env.GEMINI_VIDEO_MODEL ?? "gemini-2.5-flash",
    contents: prompt,
  });
  if (!response.text) {
    throw new Error("Gemini returned no text response.");
  }
  return response.text;
}

async function analyzeTextWithStepfun(prompt: string): Promise<string> {
  const completion = await stepfunRequest("/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.STEPFUN_VIDEO_MODEL ?? "step-3.7-flash",
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const result = await completion.json() as { choices?: Array<{ message?: { content?: string } }> };
  const text = result.choices?.[0]?.message?.content;
  if (!text) throw new Error("StepFun returned no text response.");
  return text;
}

export async function analyzeWithProvider(request: AnalysisRequest): Promise<string> {
  return analyzeMediaWithProvider(request.videoPath, buildVisualResearchPrompt(request), request.mediaDetail);
}

// Backward-compatible aliases for callers that imported the original names.
export const analyzeMediaWithGemini = analyzeMediaWithProvider;
export const analyzeTextWithGemini = analyzeTextWithProvider;
export const analyzeWithGemini = analyzeWithProvider;

export async function removeTemporaryWindow(directory: string): Promise<void> {
  await fs.rm(directory, { recursive: true, force: true });
}
