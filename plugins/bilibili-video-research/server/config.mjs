import { readFile, realpath, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseEnv } from "node:util";

export const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const defaultConfigPath = resolve(pluginRoot, "..", "..", "bvr", "config.json");
const operatingSystemKeys = new Set([
  "APPDATA", "COMSPEC", "HOME", "HOMEDRIVE", "HOMEPATH", "LANG", "LOCALAPPDATA",
  "LOGNAME", "PATH", "PATHEXT", "SHELL", "SYSTEMDRIVE", "SYSTEMROOT",
  "TEMP", "TMP", "TMPDIR", "USER", "USERNAME", "USERPROFILE", "WINDIR",
]);
const providerKeys = /^(?:CODEX_VIDEO_PROVIDER|STEPFUN_[A-Z0-9_]+|GEMINI_[A-Z0-9_]+|BILIBILI_[A-Z0-9_]+|FFMPEG_PATH|HTTPS?_PROXY|ALL_PROXY|NO_PROXY)$/i;

export class SetupError extends Error {}

function inside(root, target) {
  const name = relative(root, target);
  return name === "" || (!isAbsolute(name) && name !== ".." && !name.startsWith(`..${sep}`));
}

async function boundedText(path, limit, label) {
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size > limit) throw new Error();
    const data = await readFile(path);
    if (data.length > limit) throw new Error();
    return data.toString("utf8");
  } catch {
    throw new SetupError(`${label} is missing, unreadable or too large.`);
  }
}

export function isolatedEnvironment(parent, configured) {
  const environment = Object.fromEntries(
    Object.entries(parent).filter(([key, value]) => operatingSystemKeys.has(key.toUpperCase()) && typeof value === "string"),
  );
  for (const [key, value] of Object.entries(configured)) {
    if (providerKeys.test(key)) environment[key] = value;
  }
  return environment;
}

export function validateProvider(configured) {
  const provider = configured.CODEX_VIDEO_PROVIDER?.trim().toLowerCase();
  if (provider === "stepfun") {
    if (!configured.STEPFUN_API_KEY?.trim())
      throw new SetupError("Set STEPFUN_API_KEY in the private BVR environment file.");
    const endpoint = configured.STEPFUN_BASE_URL?.trim().replace(/\/+$/, "");
    if (!["https://api.stepfun.com/v1", "https://api.stepfun.com/step_plan/v1",
      "https://api.stepfun.ai/v1", "https://api.stepfun.ai/step_plan/v1"].includes(endpoint))
      throw new SetupError("Set an explicit official STEPFUN_BASE_URL: API /v1 or Plan /step_plan/v1. No default or fallback is used.");
    if (configured.STEPFUN_ASR_BASE_URL !== undefined || configured.STEPFUN_ASR_API_KEY !== undefined) {
      if (!configured.STEPFUN_ASR_API_KEY?.trim()
        || !["https://api.stepfun.com/v1", "https://api.stepfun.com/step_plan/v1",
          "https://api.stepfun.ai/v1", "https://api.stepfun.ai/step_plan/v1"]
          .includes(configured.STEPFUN_ASR_BASE_URL?.trim().replace(/\/+$/, "")))
        throw new SetupError("Separate ASR requires an explicit official STEPFUN_ASR_BASE_URL and STEPFUN_ASR_API_KEY. No fallback is used.");
    }
    return { provider, channel: endpoint.endsWith("/step_plan/v1") ? "plan" : "api" };
  }
  if (provider === "gemini") {
    if (!configured.GEMINI_API_KEY?.trim())
      throw new SetupError("Set GEMINI_API_KEY in the private BVR environment file.");
    return { provider, channel: "gemini-api" };
  }
  throw new SetupError("Set CODEX_VIDEO_PROVIDER explicitly to stepfun or gemini in the private BVR environment file.");
}

export async function prepareLaunch(config, parent = process.env, options = {}) {
  if (Number(process.versions.node.split(".")[0]) < 24)
    throw new SetupError("BVR requires Node.js 24 or newer on PATH.");
  const hosted = config?.schemaVersion === 2 && config.mode === "dfsc" && config.hostAccess === "confirm";
  const independent = config?.schemaVersion === 1 || config?.schemaVersion === 2 && config.mode === "independent";
  const allowed = config?.schemaVersion === 1 ? ["schemaVersion", "runtimeDirectory", "envFile"]
    : hosted ? ["schemaVersion", "mode", "hostAccess", "runtimeDirectory", "envFile"]
      : ["schemaVersion", "mode", "runtimeDirectory", "envFile"];
  if (!config || !hosted && !independent || Object.keys(config).some(key => !allowed.includes(key))
      || typeof config.runtimeDirectory !== "string" || !isAbsolute(config.runtimeDirectory)
      || (config.envFile !== undefined && (typeof config.envFile !== "string" || !isAbsolute(config.envFile)))
      || !hosted && !config.envFile)
    throw new SetupError("BVR config must declare a valid mode and absolute runtimeDirectory and environment file paths.");
  let runtimeDirectory, envFile;
  try {
    runtimeDirectory = await realpath(config.runtimeDirectory);
    if (config.envFile) envFile = await realpath(config.envFile);
  } catch {
    throw new SetupError("The configured BVR runtime or private environment file does not exist.");
  }
  if (envFile && inside(await realpath(pluginRoot), envFile))
    throw new SetupError("Keep the private BVR environment file outside the installed plugin directory.");
  let configured = {};
  try {
    if (envFile) configured = parseEnv(await boundedText(envFile, 128 * 1024, "Private BVR environment file"));
  } catch {
    throw new SetupError("The private BVR environment file cannot be read or parsed.");
  }
  const selection = hosted ? { provider: "stepfun", channel: "follow-dfsc" } : validateProvider(configured);
  let loader;
  try {
    const manifest = JSON.parse(await boundedText(join(runtimeDirectory, "package.json"), 64 * 1024, "BVR package"));
    if (manifest.name !== "bilibili-video-research-mcp") throw new Error();
    if (!(await stat(join(runtimeDirectory, "src", "index.ts"))).isFile()) throw new Error();
    const require = createRequire(join(runtimeDirectory, "package.json"));
    loader = pathToFileURL(require.resolve("tsx")).href;
    for (const dependency of ["dotenv", "@modelcontextprotocol/sdk/server/index.js", "ffmpeg-static", "yt-dlp-exec"])
      require.resolve(dependency);
  } catch {
    throw new SetupError("Use a BVR checkout with npm ci completed, including development dependencies (tsx).");
  }
  const environment = isolatedEnvironment(parent, hosted
    ? Object.fromEntries(Object.entries(configured).filter(([key]) => /^(?:BILIBILI_[A-Z0-9_]+|FFMPEG_PATH|HTTPS?_PROXY|ALL_PROXY|NO_PROXY)$/i.test(key)))
    : configured);
  // BVR imports dotenv itself; pin that second load to the same private file.
  environment.DOTENV_CONFIG_PATH = hosted ? (process.platform === "win32" ? "NUL" : "/dev/null") : envFile;
  // dotenv treats any non-empty override string, including "false", as true.
  environment.DOTENV_CONFIG_OVERRIDE = "";
  environment.DOTENV_CONFIG_QUIET = "true";
  environment.DOTENV_CONFIG_DEBUG = "";
  if (hosted) {
    environment.CODEX_VIDEO_PROVIDER = "stepfun";
    environment.BVR_DFSC_MODE = "1";
    if (!options.validateOnly) {
      let host;
      try {
        host = JSON.parse(await boundedText(options.hostPath ?? join(dirname(defaultConfigPath), "host.json"), 4096, "DFSC host connection"));
        const url = new URL(host.url);
        if (host.version !== 1 || url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port
          || url.username || url.password || url.search || url.hash || url.pathname !== "/"
          || !/^[a-f0-9]{64}$/.test(host.token)) throw new Error();
      } catch {
        throw new SetupError("Follow DFSC requires a running DFSC build with BVR host support. No independent-provider fallback is used.");
      }
      environment.BVR_DFSC_URL = host.url;
      environment.BVR_DFSC_TOKEN = host.token;
      environment.BVR_DFSC_RUNTIME_PID = String(options.runtimePid ?? process.ppid);
    }
  }
  return {
    ...selection,
    runtimeDirectory,
    args: ["--import", loader, join(runtimeDirectory, "src", "index.ts")],
    environment,
  };
}

export async function readConfiguration(configPath = defaultConfigPath) {
  let config;
  try {
    config = JSON.parse(await boundedText(configPath, 64 * 1024, "BVR config"));
  } catch {
    throw new SetupError("BVR is not configured. Run server/configure.mjs with --profile and --runtime; see the plugin README.");
  }
  return config;
}

export async function configurationRevision(configPath = defaultConfigPath, expectedConfig) {
  const raw = await boundedText(configPath, 64 * 1024, "BVR config");
  const config = JSON.parse(raw);
  if (expectedConfig && JSON.stringify(expectedConfig) !== JSON.stringify(config))
    throw new SetupError("BVR configuration changed during startup. Restart the session.");
  if (config.envFile !== undefined && (typeof config.envFile !== "string" || !isAbsolute(config.envFile)))
    throw new SetupError("The private BVR environment file path must be absolute.");
  const environment = config.envFile ? await boundedText(config.envFile, 128 * 1024, "Private BVR environment file") : "";
  return createHash("sha256").update(raw).update("\0").update(environment).digest("hex");
}
