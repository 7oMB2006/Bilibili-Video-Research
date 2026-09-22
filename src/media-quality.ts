export type SourceResolution = "720p" | "1080p" | "1440p" | "2160p";
export type SourceQualityProfile = "standard" | "high" | "custom";
export type QualityUnavailablePolicy = "error" | "warn";

export interface SourceQualityRequest {
  profile?: SourceQualityProfile;
  resolution?: SourceResolution;
  fps?: 30 | 60;
  onUnavailable?: QualityUnavailablePolicy;
}

export interface ResolvedSourceQuality {
  profile: SourceQualityProfile;
  resolution: SourceResolution;
  height: number;
  fps: 30 | 60;
  onUnavailable: QualityUnavailablePolicy;
}

export interface YtDlpFormat {
  format_id?: string | number;
  vcodec?: string;
  acodec?: string;
  height?: number;
  width?: number;
  fps?: number;
  tbr?: number;
  abr?: number;
}

export interface YtDlpMetadata extends YtDlpFormat {
  formats?: YtDlpFormat[];
  requested_formats?: YtDlpFormat[];
}

export interface SelectedYtDlpFormat {
  selector: string;
  formatId: string;
  height?: number;
  fps?: number;
}

export interface SourceQualityReport {
  status: "matched" | "degraded";
  requestedResolution: SourceResolution;
  requestedFps: 30 | 60;
  onUnavailable: QualityUnavailablePolicy;
  actualHeight?: number;
  actualFps?: number;
  formatId: string;
  degradationReason?: string;
}

const HEIGHTS: Record<SourceResolution, number> = {
  "720p": 720,
  "1080p": 1080,
  "1440p": 1440,
  "2160p": 2160,
};

const PROFILE_DEFAULTS: Record<Exclude<SourceQualityProfile, "custom">, { resolution: SourceResolution; fps: 30 }> = {
  standard: { resolution: "1080p", fps: 30 },
  high: { resolution: "1440p", fps: 30 },
};

export function resolveSourceQuality(request: SourceQualityRequest = {}): ResolvedSourceQuality {
  const profile = request.profile ?? (request.resolution || request.fps ? "custom" : "standard");
  const preset = profile === "custom" ? undefined : PROFILE_DEFAULTS[profile];
  const resolution = request.resolution ?? preset?.resolution;
  const fps = request.fps ?? preset?.fps;

  if (!resolution || !fps) {
    throw new Error("Custom source quality requires both resolution and fps.");
  }

  return {
    profile,
    resolution,
    height: HEIGHTS[resolution],
    fps,
    onUnavailable: request.onUnavailable ?? "error",
  };
}

export function parseYtDlpMetadata(stdout: string): YtDlpMetadata {
  for (const line of stdout.split(/\r?\n/).reverse()) {
    const candidate = line.trim();
    if (!candidate.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(candidate) as YtDlpMetadata;
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      continue;
    }
  }
  throw new Error("yt-dlp did not return readable JSON media metadata.");
}

function formatId(format: YtDlpFormat): string | undefined {
  if (format.format_id === undefined || format.format_id === null) return undefined;
  return String(format.format_id);
}

function isVideoFormat(format: YtDlpFormat): boolean {
  return Boolean(formatId(format) && format.vcodec && format.vcodec !== "none" && Number.isFinite(format.height));
}

function isAudioFormat(format: YtDlpFormat): boolean {
  return Boolean(formatId(format) && format.acodec && format.acodec !== "none" && (!format.vcodec || format.vcodec === "none"));
}

function sortVideoFormats(formats: YtDlpFormat[], quality: ResolvedSourceQuality): YtDlpFormat[] {
  return [...formats].sort((left, right) => {
    const leftHeight = Number(left.height ?? 0);
    const rightHeight = Number(right.height ?? 0);
    const leftFps = Number(left.fps ?? 0);
    const rightFps = Number(right.fps ?? 0);
    const heightDifference = Math.abs(leftHeight - quality.height) - Math.abs(rightHeight - quality.height);
    if (heightDifference !== 0) return heightDifference;
    const fpsDifference = Math.abs(leftFps - quality.fps) - Math.abs(rightFps - quality.fps);
    if (fpsDifference !== 0) return fpsDifference;
    return Number(right.tbr ?? 0) - Number(left.tbr ?? 0);
  });
}

function availableQualitySummary(formats: YtDlpFormat[]): string {
  const values = [...new Set(formats
    .filter((format) => isVideoFormat(format))
    .map((format) => `${format.height}p${format.fps ? `@${format.fps}fps` : ""}`))]
    .slice(0, 12);
  return values.length ? values.join(", ") : "unknown";
}

export function selectYtDlpFormat(metadata: YtDlpMetadata, quality: ResolvedSourceQuality): SelectedYtDlpFormat {
  const formats = metadata.formats ?? [];
  const videoFormats = formats.filter(isVideoFormat);
  const exactFormats = videoFormats.filter((format) =>
    format.height === quality.height
    && Number.isFinite(format.fps)
    && Math.abs(Number(format.fps) - quality.fps) <= 1,
  );
  const sufficientFormats = videoFormats.filter((format) =>
    Number(format.height) >= quality.height
    && Number.isFinite(format.fps)
    && Number(format.fps) >= quality.fps - 1,
  );
  const boundedFormats = videoFormats.filter((format) =>
    Number(format.height) <= quality.height
    && (!Number.isFinite(format.fps) || Number(format.fps) <= quality.fps + 1),
  );
  const candidates = exactFormats.length
    ? exactFormats
    : sufficientFormats.length
      ? sufficientFormats
      : quality.onUnavailable === "warn"
        ? boundedFormats.length ? boundedFormats : videoFormats
        : [];
  const selectedVideo = sortVideoFormats(candidates, quality)[0];

  if (!selectedVideo) {
    throw new Error(
      `Requested source quality ${quality.resolution}@${quality.fps}fps is unavailable. `
      + `Available video formats: ${availableQualitySummary(videoFormats)}. `
      + "Set source_quality.on_unavailable to warn to allow an explicit lower-quality fallback.",
    );
  }

  const selectedVideoId = formatId(selectedVideo);
  if (!selectedVideoId) {
    throw new Error("yt-dlp returned a video format without a format ID.");
  }

  const selectedAudio = [...formats]
    .filter(isAudioFormat)
    .sort((left, right) => Number(right.abr ?? right.tbr ?? 0) - Number(left.abr ?? left.tbr ?? 0))[0];
  const selectedAudioId = selectedAudio ? formatId(selectedAudio) : undefined;
  const selector = selectedVideo.acodec && selectedVideo.acodec !== "none"
    ? selectedVideoId
    : selectedAudioId
      ? `${selectedVideoId}+${selectedAudioId}`
      : selectedVideoId;

  return {
    selector,
    formatId: selector,
    height: Number.isFinite(selectedVideo.height) ? selectedVideo.height : undefined,
    fps: Number.isFinite(selectedVideo.fps) ? selectedVideo.fps : undefined,
  };
}

export function assessDownloadedQuality(
  metadata: YtDlpMetadata,
  quality: ResolvedSourceQuality,
  selection: SelectedYtDlpFormat,
): SourceQualityReport {
  const selectedVideo = metadata.requested_formats?.find(isVideoFormat) ?? metadata;
  const actualHeight = Number.isFinite(selectedVideo.height) ? Number(selectedVideo.height) : selection.height;
  const actualFps = Number.isFinite(selectedVideo.fps) ? Number(selectedVideo.fps) : selection.fps;
  const reasons: string[] = [];

  if (actualHeight !== undefined && actualHeight < quality.height) {
    reasons.push(`resolution ${actualHeight}p is below requested ${quality.resolution}`);
  }
  if (actualFps !== undefined && actualFps < quality.fps - 1) {
    reasons.push(`frame rate ${actualFps}fps is below requested ${quality.fps}fps`);
  }

  return {
    status: reasons.length ? "degraded" : "matched",
    requestedResolution: quality.resolution,
    requestedFps: quality.fps,
    onUnavailable: quality.onUnavailable,
    actualHeight,
    actualFps,
    formatId: String(metadata.format_id ?? selection.formatId),
    ...(reasons.length ? { degradationReason: reasons.join("; ") } : {}),
  };
}
