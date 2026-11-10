import { AsyncLocalStorage } from "node:async_hooks";
import { createHostClient, HostClientError, newRequestId, type HostClient } from "../plugins/bilibili-video-research/server/host-client/client.mjs";
import type { HostContext, Invocation } from "../plugins/bilibili-video-research/server/host-client/protocol.mjs";
import { assertDfscConfigurationCurrent } from "./dfsc-configuration.js";

interface Operation { context: HostContext; signal?: AbortSignal }
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

export async function withDfscOperation<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  await assertDfscConfigurationCurrent();
  if (signal?.aborted) throw new HostClientError("CANCELLED");
  if (!followsDfsc() || operations.getStore()) return task();
  const context = await host()!.context({ signal });
  return operations.run({ context, signal }, task);
}

export async function analyzeWithDfsc(kind: "text" | "video" | "asr", prompt: string,
  media?: { mimeType: string; data: string }): Promise<string> {
  return withDfscOperation(async () => {
    const operation = operations.getStore();
    if (!operation) throw new HostClientError("HOST_UNAVAILABLE");
    if (operation.signal?.aborted) throw new HostClientError("CANCELLED");
    const capability = `model.${kind}` as const;
    const available = operation.context.capabilities.find(item => item.id === capability);
    if (!available?.available) throw new HostClientError(available?.reason ?? "CAPABILITY_UNAVAILABLE");
    const base = { requestId: newRequestId(), revision: operation.context.revision };
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
