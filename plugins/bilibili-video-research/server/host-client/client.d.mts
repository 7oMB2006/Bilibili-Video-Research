import type { Capability, HostContext, Invocation, Results } from './protocol.mjs';
export { HostClientError, newRequestId } from './protocol.mjs';
export interface HostClient {
  readonly mode: 'follow' | 'independent';
  readonly dataDirectory: string;
  readonly configurationRevision: string | null;
  context(options?: { signal?: AbortSignal }): Promise<HostContext>;
  invoke<C extends Capability>(input: Invocation<C>, options?: { signal?: AbortSignal }): Promise<Results[C]>;
  cancel(requestId: string): Promise<boolean>;
  close(): void;
}
export function createHostClient(options: {
  pluginId: string; consumer: string; environment?: NodeJS.ProcessEnv; fetch?: typeof globalThis.fetch;
}): HostClient;
