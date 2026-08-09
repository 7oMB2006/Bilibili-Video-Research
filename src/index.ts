import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createSilentVideo, analyzeWithProvider, createSilentWindow, removeTemporaryWindow } from "./video-analysis.js";
import { researchBilibiliVideo } from "./bilibili.js";

const server = new McpServer({ name: "codex-video-mcp", version: "0.1.0" });

function result(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function failed(error: unknown) {
  return {
    content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }],
    isError: true,
  };
}

const commonSchema = {
  video_path: z.string().min(1).describe("Absolute path to a local video file."),
  question: z.string().min(3).describe("A visual-only research question about observable actions or interactions."),
  media_detail: z.enum(["low", "default"]).default("default").describe("Use low for a long coarse pass; use default for movement, small objects, and precise inspection."),
};

server.registerTool("analyze_video", {
  title: "Analyze a Video Visually",
  description: "Creates an audio-free copy of a local video and sends it to the configured video-analysis provider for visual research. Visible interfaces, code, charts, labels, and subtitles remain usable visual evidence.",
  inputSchema: commonSchema,
  annotations: { readOnlyHint: true },
}, async ({ video_path, question, media_detail }) => {
  let directory: string | undefined;
  try {
    const silent = await createSilentVideo(video_path);
    directory = silent.directory;
    return result(await analyzeWithProvider({
      videoPath: silent.videoPath,
      question,
      mediaDetail: media_detail,
    }));
  } catch (error) {
    return failed(error);
  } finally {
    if (directory) await removeTemporaryWindow(directory);
  }
});

server.registerTool("inspect_video_window", {
  title: "Inspect a Precise Video Window",
  description: "Extracts an audio-free temporary clip for the requested source-video time window, then sends that clip to the configured video-analysis provider for visual-only analysis. Temporary media and remote uploads are removed after the answer.",
  inputSchema: {
    ...commonSchema,
    start_seconds: z.number().min(0).describe("Start time in seconds in the source video."),
    end_seconds: z.number().positive().describe("End time in seconds in the source video; must be after start_seconds."),
  },
  annotations: { readOnlyHint: true },
}, async ({ video_path, question, media_detail, start_seconds, end_seconds }) => {
  let directory: string | undefined;
  try {
    const window = await createSilentWindow(video_path, start_seconds, end_seconds);
    directory = window.directory;
    return result(await analyzeWithProvider({
      videoPath: window.clipPath,
      question,
      mediaDetail: media_detail,
      sourceStartSeconds: start_seconds,
      sourceEndSeconds: end_seconds,
    }));
  } catch (error) {
    return failed(error);
  } finally {
    if (directory) {
      await removeTemporaryWindow(directory);
    }
  }
});

server.registerTool("analyze_bilibili_video", {
  title: "Research a Bilibili Video",
  description: "Resolves a public Bilibili URL, attaches public metadata, and optionally samples 20 most-liked root comments while displaying only 3 hot comments plus up to 2 distinct high-signal comments. Supports language-only, visual-only, and multimodal research.",
  inputSchema: {
    url: z.string().url().describe("Public Bilibili video URL, including b23.tv short URLs."),
    question: z.string().min(3).describe("The research question."),
    mode: z.enum(["language", "vision", "multimodal"]).describe("language: captions then audio only; vision: silent video only; multimodal: original video with both channels."),
    media_detail: z.enum(["low", "default"]).default("default").describe("Use low for a broad long-video pass and default for close inspection."),
    include_comments: z.boolean().default(true).describe("Attach untrusted community context. Fetches at most 20 most-liked root comments but presents only 3-5 representative comments."),
  },
  annotations: { readOnlyHint: true },
}, async ({ url, question, mode, media_detail, include_comments }) => {
  try {
    return result(await researchBilibiliVideo({
      url,
      question,
      mode,
      mediaDetail: media_detail,
      includeComments: include_comments,
    }));
  } catch (error) {
    return failed(error);
  }
});

await server.connect(new StdioServerTransport());
