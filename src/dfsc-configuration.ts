import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";

async function boundedText(path: string, limit: number): Promise<string> {
  const info = await stat(path);
  if (!info.isFile() || info.size > limit) throw new Error();
  const data = await readFile(path);
  if (data.length > limit) throw new Error();
  return data.toString("utf8");
}

export async function assertDfscConfigurationCurrent(): Promise<void> {
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
