import { AsyncLocalStorage } from "node:async_hooks";
import { assertDfscConfigurationCurrent } from "./dfsc-configuration.js";

interface HostContext {
  version: 1;
  revision: string;
  channel: "plan" | "api";
  region: "cn" | "global";
  model: string;
  capabilities: { text: boolean; video: boolean; asr: boolean };
}
interface Operation { context: HostContext; signal?: AbortSignal }
const operations = new AsyncLocalStorage<Operation>();
export const followsDfsc = () => process.env.BVR_DFSC_MODE === "1";

async function hostRequest(path: string, data: unknown, signal?: AbortSignal): Promise<Record<string, any>> {
  let url: URL;
  const token = process.env.BVR_DFSC_TOKEN;
  const runtimePid = Number(process.env.BVR_DFSC_RUNTIME_PID);
  try {
    url = new URL(process.env.BVR_DFSC_URL ?? "");
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port || url.username || url.password
      || url.pathname !== "/" || url.search || url.hash || !/^[a-f0-9]{64}$/.test(token ?? "")
      || !Number.isSafeInteger(runtimePid) || runtimePid <= 0) throw new Error();
  } catch { throw new Error("DFSC host connection is missing or invalid. No provider fallback is used."); }
  let response: Response;
  await assertDfscConfigurationCurrent();
  try {
    response = await fetch(new URL(path, url), {
      method: "POST", redirect: "error", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(300000)]) : AbortSignal.timeout(300000),
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ...(data as object), runtimePid }),
    });
  } catch { throw new Error("DFSC host connection was interrupted. No provider fallback is used."); }
  const result = await response.json() as Record<string, any>;
  if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "DFSC host request failed; no fallback was used.");
  return result;
}

export async function withDfscOperation<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  await assertDfscConfigurationCurrent();
  if (!followsDfsc() || operations.getStore()) return task();
  const context = await hostRequest("/context", {}, signal) as HostContext;
  if (context.version !== 1 || !/^[a-f0-9]{48}$/.test(context.revision) || !context.capabilities
    || !["plan", "api"].includes(context.channel) || !["cn", "global"].includes(context.region) || typeof context.model !== "string")
    throw new Error("DFSC returned an invalid account/model context.");
  return operations.run({ context, signal }, task);
}

export async function analyzeWithDfsc(kind: "text" | "video" | "asr", prompt: string,
  media?: { mimeType: string; data: string }): Promise<string> {
  return withDfscOperation(async () => {
    const operation = operations.getStore();
    if (!operation) throw new Error("A DFSC research context is required.");
    if (!operation.context.capabilities[kind])
      throw new Error(kind === "asr"
        ? "The DFSC host did not enable ASR for this context. Use captions, vision mode or explicit independent mode; no API fallback is used."
        : `DFSC model ${operation.context.model} has no verified ${kind} support. Select a supported model or use explicit independent mode.`);
    const result = await hostRequest("/complete", { revision: operation.context.revision, kind, prompt, media }, operation.signal);
    if (typeof result.text !== "string" || !result.text.trim()) throw new Error("DFSC returned no research text.");
    return result.text;
  });
}
