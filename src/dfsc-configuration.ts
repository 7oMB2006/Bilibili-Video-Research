import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { ConfigurationReader } from "../plugins/bilibili-video-research/server/configuration.mjs";

let reader: ConfigurationReader | undefined;

async function boundedText(path: string, limit: number): Promise<string> {
  const info = await stat(path);
  if (!info.isFile() || info.size > limit) throw new Error();
  const data = await readFile(path);
  if (data.length > limit) throw new Error();
  return data.toString("utf8");
}

export async function assertDfscConfigurationCurrent(): Promise<void> {
  const setupPath = process.env.BVR_DFSC_SETUP_PATH;
  const setupRevision = process.env.BVR_DFSC_SETUP_REVISION;
  const packageDirectory = process.env.BVR_DFSC_PLUGIN_DIRECTORY;
  const configurationRevision = process.env.BVR_DFSC_CONFIGURATION_REVISION;
  if (setupPath !== undefined || setupRevision !== undefined || packageDirectory !== undefined || configurationRevision !== undefined) {
    try {
      if (!setupPath || !isAbsolute(setupPath) || !/^[a-f0-9]{64}$/.test(setupRevision ?? "")
        || createHash("sha256").update(await boundedText(setupPath, 64 * 1024)).digest("hex") !== setupRevision) throw new Error();
      if (packageDirectory !== undefined || configurationRevision !== undefined) {
        if (!packageDirectory || !isAbsolute(packageDirectory) || !/^[a-f0-9]{64}$/.test(configurationRevision ?? "")) throw new Error();
        reader ??= new ConfigurationReader(pathToFileURL(`${packageDirectory}/`));
        if ((await reader.current()).revision !== configurationRevision) throw new Error();
      }
    } catch {
      throw new Error("BVR configuration changed or is unavailable. Restart the session before another model request; no provider fallback is used.");
    }
  }
  const path = process.env.BVR_DFSC_CONFIG_PATH;
  const expected = process.env.BVR_DFSC_CONFIG_REVISION;
  if (path === undefined && expected === undefined) return;
  try {
    if (!path || !isAbsolute(path) || !/^[a-f0-9]{64}$/.test(expected ?? "")) throw new Error();
    const raw = await boundedText(path, 64 * 1024);
    const config = JSON.parse(raw);
    if (config.envFile !== undefined && (typeof config.envFile !== "string" || !isAbsolute(config.envFile))) throw new Error();
    const environment = config.envFile ? await boundedText(config.envFile, 128 * 1024) : "";
    const actual = createHash("sha256").update(raw).update("\0").update(environment).digest("hex");
    if (actual !== expected) throw new Error();
  } catch {
    throw new Error("BVR configuration changed or is unavailable. Restart the session before another model request; no provider fallback is used.");
  }
}
