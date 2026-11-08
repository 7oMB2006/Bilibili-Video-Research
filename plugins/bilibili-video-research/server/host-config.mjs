import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { isolatedEnvironment, prepareLaunch, SetupError, validateProvider } from "./config.mjs";
import { parseLaunch } from "./host-client/protocol.mjs";

export const identity = Object.freeze({ pluginId: "bilibili-video-research", consumer: "bvr" });

export function downloadEnvironment(values = {}, strict = false) {
  const paths = { cookies_file: "BILIBILI_COOKIES_FILE", download_directory: "BILIBILI_DOWNLOAD_DIRECTORY", ffmpeg_path: "FFMPEG_PATH" };
  if (!values || typeof values !== "object" || Array.isArray(values)
    || strict && Object.keys(values).some(key => ![...Object.keys(paths), "http_proxy", "prefer_captions"].includes(key)))
    throw new SetupError("Invalid BVR download settings. Provider credentials do not belong in runtime setup.");
  const environment = {};
  for (const [field, name] of Object.entries(paths)) {
    if (values[field] === undefined || values[field] === "") continue;
    if (typeof values[field] !== "string" || values[field].length > 4096 || !isAbsolute(values[field]) || values[field].includes("\0"))
      throw new SetupError("BVR download paths must be absolute.");
    environment[name] = values[field];
  }
  if (values.http_proxy !== undefined && values.http_proxy !== "") {
    try {
      if (typeof values.http_proxy !== "string" || values.http_proxy.length > 512) throw new Error();
      const url = new URL(values.http_proxy);
      if (!["http:", "https:"].includes(url.protocol)) throw new Error();
    } catch { throw new SetupError("Set an explicit HTTP(S) download proxy."); }
    environment.HTTP_PROXY = values.http_proxy;
  }
  if (values.prefer_captions !== undefined && typeof values.prefer_captions !== "boolean")
    throw new SetupError("prefer_captions must be a boolean.");
  environment.BILIBILI_PREFER_CAPTIONS = values.prefer_captions === false ? "false" : "true";
  return environment;
}

export function independentEnvironment(configuration) {
  const { values, secrets } = configuration;
  const text = key => typeof values[key] === "string" ? values[key].trim() : "";
  const key = secrets.api_key?.trim();
  const model = text("model");
  if (!key || !model) throw new SetupError("Set the independent main API key and model in the plugin settings.");
  const provider = text("provider");
  const environment = provider === "stepfun" ? {
    CODEX_VIDEO_PROVIDER: "stepfun", STEPFUN_API_KEY: key,
    STEPFUN_BASE_URL: text("base_url"), STEPFUN_VIDEO_MODEL: model,
  } : provider === "gemini" ? {
    CODEX_VIDEO_PROVIDER: "gemini", GEMINI_API_KEY: key, GEMINI_VIDEO_MODEL: model,
  } : {};
  validateProvider(environment);
  const asr = [text("asr_base_url"), secrets.asr_api_key?.trim(), text("asr_model")];
  if (asr.some(Boolean) && !asr.every(Boolean))
    throw new SetupError("Set all three independent ASR fields, or clear all three. No main-connection fallback is used.");
  if (provider === "gemini" && asr.some(Boolean))
    throw new SetupError("Separate Step ASR with a Gemini main model is not supported by this BVR adapter.");
  if (asr.every(Boolean)) {
    environment.STEPFUN_ASR_BASE_URL = asr[0];
    environment.STEPFUN_ASR_API_KEY = asr[1];
    environment.STEPFUN_ASR_MODEL = asr[2];
    validateProvider(environment);
  } else if (provider === "stepfun") {
    // Present but empty deliberately prevents the standalone legacy main-key ASR fallback.
    environment.STEPFUN_ASR_BASE_URL = "";
    environment.STEPFUN_ASR_API_KEY = "";
  }
  Object.assign(environment, downloadEnvironment(values));
  return environment;
}

export async function prepareHostLaunch(setup, launch, parent = process.env, configuration) {
  const context = parseLaunch(launch, identity);
  // Only the existing runtime path is reused. Legacy mode, opt-in and envFile are not authorization/configuration.
  const prepared = await prepareLaunch({
    schemaVersion: 2, mode: "dfsc", hostAccess: "confirm", runtimeDirectory: setup?.runtimeDirectory,
  }, parent, { validateOnly: true });
  let manifest;
  try { manifest = JSON.parse(await readFile(join(prepared.runtimeDirectory, "package.json"), "utf8")); } catch {}
  if (manifest?.dfscHostApiVersion !== 1)
    throw new SetupError("Update the separate BVR runtime to the generic DFSC host v1 adapter before restarting.");
  let configured = {};
  if (context.mode === "independent") {
    if (!configuration || configuration.revision !== context.configurationRevision)
      throw new SetupError("The independent configuration revision changed. Save the selected mode and restart.");
    configured = independentEnvironment(configuration);
  } else {
    if (configuration !== undefined) throw new SetupError("Follow mode must not read independent configuration.");
    configured = downloadEnvironment(setup.downloads, true);
  }
  const environment = isolatedEnvironment(parent, configured);
  Object.assign(environment, {
    DOTENV_CONFIG_PATH: process.platform === "win32" ? "NUL" : "/dev/null",
    DOTENV_CONFIG_OVERRIDE: "", DOTENV_CONFIG_QUIET: "true", DOTENV_CONFIG_DEBUG: "",
    DFSC_LAUNCH_CONTEXT: JSON.stringify(context),
  });
  if (context.mode === "follow") environment.CODEX_VIDEO_PROVIDER = "stepfun";
  return { ...prepared, environment, channel: context.mode === "follow" ? "follow-dfsc" : "independent" };
}
