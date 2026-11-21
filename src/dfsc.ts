import { AsyncLocalStorage } from "node:async_hooks";
import { createHostClient, HostClientError, newRequestId, type HostClient } from "../plugins/bilibili-video-research/server/host-client/client.mjs";
import type { HostContext, Invocation } from "../plugins/bilibili-video-research/server/host-client/protocol.mjs";
import { assertDfscConfigurationCurrent } from "./dfsc-configuration.js";

type ModelKind = "text" | "video" | "asr";
interface Operation { context?: Promise<HostContext>; signal?: AbortSignal }
const operations = new AsyncLocalStorage<Operation>();
let client: HostClient | undefined, startupError: HostClientError | undefined;
let attempted = false;

function host() {
  if (!attempted && Object.keys(process.env).some(key => key.toUpperCase() === "DFSC_LAUNCH_CONTEXT")) {
    attempted = true;
    try {
      client = createHostClient({ pluginId: "bilibili-video-research", consumer: "bvr",
        fetch: (...args) => globalThis.fetch(...args) });
      process.once("exit", () => client?.close());
    } catch (error) {
      startupError = error instanceof HostClientError ? error : new HostClientError("HOST_UNAVAILABLE");
    }
  }
  if (startupError) throw startupError;
  if (!client && process.env.BVR_DFSC_MODE === "1")
    throw new Error("The legacy BVR host bridge is unsupported. Select a mode in an updated DFSC host and restart; no provider fallback is used.");
  return client;
}

export const followsDfsc = () => host()?.mode === "follow";
export const managedByDfsc = () => Boolean(host());
export const usesDfscAsrRoute = () => followsDfsc() || Boolean(host()?.independentCapabilities);

export function dfscModelRoute(kind: ModelKind): "independent" | "broker" | "standalone" {
  const client = host();
  if (!client) return "standalone";
  if (client.independentCapabilities?.includes(`model.${kind}`)) return "independent";
  if (client.mode === "follow") return "broker";
  if (!client.independentCapabilities) return "independent";
  throw new HostClientError("CAPABILITY_UNAVAILABLE");
}

export async function assertDirectModelRoute(kind: ModelKind) {
  const route = dfscModelRoute(kind);
  if (route === "broker") throw new HostClientError("CAPABILITY_UNAVAILABLE");
  const revision = route === "independent" ? host()!.configurationRevision : undefined;
  if (route === "independent" && !revision) throw new HostClientError("STALE_CONTEXT");
  if (operations.getStore()?.signal?.aborted) throw new HostClientError("CANCELLED");
  await assertDfscConfigurationCurrent(revision ?? undefined);
}

export async function withDfscOperation<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  await assertDfscConfigurationCurrent();
  if (signal?.aborted) throw new HostClientError("CANCELLED");
  if (!managedByDfsc() || operations.getStore()) return task();
  return operations.run({ signal }, task);
}

export async function analyzeWithDfsc(kind: ModelKind, prompt: string,
  media?: { mimeType: string; data: string }): Promise<string> {
  return withDfscOperation(async () => {
    const operation = operations.getStore();
    if (!operation || dfscModelRoute(kind) !== "broker") throw new HostClientError("CAPABILITY_UNAVAILABLE");
    if (operation.signal?.aborted) throw new HostClientError("CANCELLED");
    const capability = `model.${kind}` as const;
    const context = await (operation.context ??= host()!.context({ signal: operation.signal }));
    const available = context.capabilities.find(item => item.id === capability);
    if (!available?.available) throw new HostClientError(available?.reason ?? "CAPABILITY_UNAVAILABLE");
    const base = { requestId: newRequestId(), revision: context.revision };
    const messages = [{ role: "user" as const, content: prompt }];
    let invocation: Invocation<"model.text" | "model.video" | "model.asr">;
    if (kind === "text") invocation = { ...base, capability: "model.text", input: { messages } };
    else {
      if (!media) throw new HostClientError("INVALID_REQUEST");
      invocation = kind === "video" ? { ...base, capability: "model.video", input: { messages, video: media } }
        : { ...base, capability: "model.asr", input: { audio: media } };
    }
    const result = await host()!.invoke(invocation, { signal: operation.signal });
    if (result.type !== "text" || !result.text.trim()) throw new HostClientError("PROVIDER_FAILED");
    return result.text;
  });
}
