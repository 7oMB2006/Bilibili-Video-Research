export type Capability = 'model.text' | 'model.video' | 'model.asr' | 'model.tts';
export type ErrorCode = 'HOST_UNAVAILABLE' | 'UNSUPPORTED_VERSION' | 'INVALID_REQUEST' | 'CAPABILITY_UNAVAILABLE'
  | 'AUTHORIZATION_REQUIRED' | 'DENIED' | 'STALE_CONTEXT' | 'CANCELLED' | 'TIMEOUT' | 'TOO_LARGE'
  | 'PROVIDER_FAILED' | 'BUSY' | 'CLOSED';
export const HOST_ENV: 'DFSC_LAUNCH_CONTEXT';
export const CAPABILITIES: readonly Capability[];
export const ERROR_CODES: readonly ErrorCode[];
export const LIMITS: Readonly<Record<'manifest' | 'launch' | 'request' | 'text' | 'response' | 'audio'
  | 'lease' | 'provider' | 'confirmation' | 'queue' | 'perPluginConcurrency' | 'globalConcurrency', number>>;
export class HostClientError extends Error { constructor(code: string); code: ErrorCode; }
export interface HostDeclaration {
  readonly schemaVersion: 1; readonly hostApiVersion: 1;
  readonly consumer: { readonly kind: 'mcp-stdio'; readonly server: string };
  readonly capabilities: readonly Capability[];
}
export interface LaunchBase {
  version: 'dfsc-launch-v1'; pluginId: string; consumer: string; instance: string; fingerprint: string;
  declarationHash: string; revision: string; launchId: string; runtimeId: string; sessionId: string;
  accountRevision: string; capabilities: Capability[]; models: ModelSelection; dataDirectory: string;
}
export type ModelSelection = Partial<Record<'model.asr' | 'model.tts', string>>;
export interface FollowLaunch extends LaunchBase {
  mode: 'follow'; configurationRevision: null;
  broker: { origin: string; token: string; expiresAt: number };
}
export interface IndependentLaunch extends LaunchBase {
  mode: 'independent'; configurationRevision: string; broker?: never;
}
export type LaunchContext = FollowLaunch | IndependentLaunch;
export interface HostContext {
  version: 1; revision: string;
  capabilities: Array<{ id: Capability; available: boolean; reason?: ErrorCode;
    model?: string; channel?: 'plan' | 'api'; region?: 'cn' | 'oversea' }>;
}
export interface Media { mimeType: string; data: string; }
export interface Inputs {
  'model.text': { messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>; temperature?: number; maxTokens?: number };
  'model.video': Inputs['model.text'] & { video: Media };
  'model.asr': { audio: Media };
  'model.tts': { text: string; voice: string; format: 'mp3' | 'wav' | 'pcm' };
}
export interface Results {
  'model.text': { type: 'text'; text: string };
  'model.video': Results['model.text']; 'model.asr': Results['model.text'];
  'model.tts': { type: 'audio'; mimeType: string; data: string };
}
export type Invocation<C extends Capability = Capability> = {
  [K in C]: { requestId: string; revision: string; capability: K; input: Inputs[K] }
}[C];
export function fail(code?: ErrorCode): never;
export function id(value: unknown): boolean;
export function hash(value: unknown): boolean;
export function keys(value: unknown, allowed: string[], required?: string[]): void;
export function boundedJson(value: unknown, limit: number): string;
export function parseModelSelection(value: unknown, declared: readonly Capability[]): ModelSelection;
export function parseHostDeclaration(value: unknown, manifest: unknown): HostDeclaration;
export function parseLaunch(value: unknown, expected: { pluginId: string; consumer: string }, now?: number): LaunchContext;
export function takeLaunchContext(environment: NodeJS.ProcessEnv, expected: { pluginId: string; consumer: string }, now?: number): LaunchContext;
export function newRequestId(): string;
export function parseInvoke(value: unknown): Invocation;
export function parseContext(value: unknown, declared: readonly Capability[]): HostContext;
export function parseResult<C extends Capability>(value: unknown, request: Invocation<C>): Results[C];
