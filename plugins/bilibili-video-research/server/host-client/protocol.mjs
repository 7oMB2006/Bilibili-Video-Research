import { randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';

export const HOST_ENV = 'DFSC_LAUNCH_CONTEXT';
export const CAPABILITIES = Object.freeze(['model.text', 'model.video', 'model.asr', 'model.tts']);
export const LIMITS = Object.freeze({
  manifest: 65536, launch: 16384, request: 32 * 1024 * 1024,
  text: 2 * 1024 * 1024, response: 24 * 1024 * 1024, audio: 16 * 1024 * 1024,
  lease: 30 * 60 * 1000, provider: 180000, confirmation: 60000, queue: 30000,
  perPluginConcurrency: 2, globalConcurrency: 8,
});
export const ERROR_CODES = Object.freeze([
  'HOST_UNAVAILABLE', 'UNSUPPORTED_VERSION', 'INVALID_REQUEST', 'CAPABILITY_UNAVAILABLE',
  'AUTHORIZATION_REQUIRED', 'DENIED', 'STALE_CONTEXT', 'CANCELLED', 'TIMEOUT',
  'TOO_LARGE', 'PROVIDER_FAILED', 'BUSY', 'CLOSED',
]);
export class HostClientError extends Error {
  constructor(code) {
    const safe = ERROR_CODES.includes(code) ? code : 'HOST_UNAVAILABLE';
    super(`dfsc-host:${safe}`);
    this.name = 'HostClientError';
    this.code = safe;
  }
}
export const fail = (code = 'INVALID_REQUEST') => { throw new HostClientError(code); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const id = value => typeof value === 'string' && /^[a-z][a-z0-9_-]{0,47}$/u.test(value)
  && !['constructor', 'prototype', '__proto__'].includes(value);
export const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u.test(value);
const text = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\0]/u.test(value);
export function keys(value, allowed, required = allowed) {
  if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))
    || required.some(key => !Object.hasOwn(value, key))) fail();
}
export function boundedJson(value, limit) {
  let result;
  try { result = JSON.stringify(value); } catch { fail(); }
  if (typeof result !== 'string') fail();
  if (Buffer.byteLength(result) > limit) fail('TOO_LARGE');
  return result;
}
export function parseModelSelection(value, declared) {
  keys(value, ['model.asr', 'model.tts'], []);
  for (const [capability, model] of Object.entries(value))
    if (!declared.includes(capability) || !text(model, 160) || /[\u0000-\u001f]/u.test(model)) fail();
  return { ...value };
}
function capabilities(value) {
  if (!Array.isArray(value) || !value.length || value.length > CAPABILITIES.length
    || value.some(item => !CAPABILITIES.includes(item)) || new Set(value).size !== value.length) fail();
}
export function parseHostDeclaration(value, manifest) {
  boundedJson(value, LIMITS.manifest);
  keys(value, ['$schema', 'schemaVersion', 'hostApiVersion', 'consumer', 'capabilities'],
    ['schemaVersion', 'hostApiVersion', 'consumer', 'capabilities']);
  if (value.schemaVersion !== 1 || value.hostApiVersion !== 1) fail('UNSUPPORTED_VERSION');
  if (value.$schema !== undefined && !text(value.$schema, 512)) fail();
  keys(value.consumer, ['kind', 'server']);
  if (value.consumer.kind !== 'mcp-stdio' || !id(value.consumer.server)) fail();
  capabilities(value.capabilities);
  const server = manifest?.mcpServers?.[value.consumer.server];
  if (!object(manifest?.mcpServers) || !object(server) || !text(server.command, 2048) || !server.command.trim()
    || server.url !== undefined || server.transport !== undefined && server.transport !== 'stdio'
    || ['oauth', 'bearer_token_env_var', 'http_headers', 'env_http_headers'].some(key => server[key] !== undefined)
    || server.cwd !== undefined && (typeof server.cwd !== 'string' || server.cwd.length > 256
      || /[:\\\0]/u.test(server.cwd) || isAbsolute(server.cwd) || server.cwd.split('/').includes('..'))
    || server.args !== undefined && (!Array.isArray(server.args) || server.args.length > 64
      || server.args.some(arg => typeof arg !== 'string' || arg.length > 8192 || arg.includes('\0')))
    || server.env !== undefined && (!object(server.env) || Object.entries(server.env).some(([key, item]) =>
      /^DFSC_(?:HOST|LAUNCH)_/iu.test(key) || typeof item !== 'string' || item.includes('\0')))) fail();
  return Object.freeze({ schemaVersion: 1, hostApiVersion: 1,
    consumer: Object.freeze({ ...value.consumer }), capabilities: Object.freeze([...value.capabilities]) });
}
export function parseLaunch(value, expected, now = Date.now()) {
  boundedJson(value, LIMITS.launch);
  keys(value, ['version', 'mode', 'pluginId', 'consumer', 'instance', 'fingerprint', 'declarationHash',
    'revision', 'configurationRevision', 'launchId', 'runtimeId', 'sessionId', 'accountRevision',
    'capabilities', 'models', 'dataDirectory', 'broker'],
  ['version', 'mode', 'pluginId', 'consumer', 'instance', 'fingerprint', 'declarationHash',
    'revision', 'configurationRevision', 'launchId', 'runtimeId', 'sessionId', 'accountRevision',
    'capabilities', 'models', 'dataDirectory']);
  if (value.version !== 'dfsc-launch-v1') fail('UNSUPPORTED_VERSION');
  if (!text(value.pluginId, 128) || !id(value.consumer) || !uuid(value.instance) || !uuid(value.launchId)
    || !uuid(value.runtimeId) || !text(value.sessionId, 128) || !hash(value.fingerprint)
    || !hash(value.declarationHash) || !hash(value.revision) || !hash(value.accountRevision)
    || !text(value.dataDirectory, 4096) || !isAbsolute(value.dataDirectory)
    || value.pluginId !== expected.pluginId || value.consumer !== expected.consumer) fail();
  capabilities(value.capabilities);
  parseModelSelection(value.models, value.capabilities);
  if (value.mode === 'independent') {
    if (!hash(value.configurationRevision) || value.broker !== undefined || Object.keys(value.models).length) fail();
  } else if (value.mode === 'follow') {
    if (value.configurationRevision !== null) fail();
    keys(value.broker, ['origin', 'token', 'expiresAt']);
    const { origin, token, expiresAt } = value.broker;
    let url;
    try { url = new URL(origin); } catch { fail(); }
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port
      || Number(url.port) < 1 || Number(url.port) > 65535 || url.origin !== origin
      || url.username || url.password || url.pathname !== '/' || url.search || url.hash
      || typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/u.test(token)
      || !Number.isSafeInteger(expiresAt) || expiresAt <= now || expiresAt - now > LIMITS.lease) fail();
  } else fail();
  return JSON.parse(boundedJson(value, LIMITS.launch));
}
export function takeLaunchContext(environment, expected, now) {
  const names = Object.keys(environment).filter(key => key.toUpperCase() === HOST_ENV);
  const raw = names.length === 1 ? environment[names[0]] : undefined;
  for (const key of names) delete environment[key];
  if (!names.length) fail('HOST_UNAVAILABLE');
  if (names.length !== 1 || typeof raw !== 'string') fail();
  if (Buffer.byteLength(raw) > LIMITS.launch) fail('TOO_LARGE');
  let value;
  try { value = JSON.parse(raw); } catch { fail(); }
  return parseLaunch(value, expected, now);
}
function media(value, types) {
  keys(value, ['mimeType', 'data']);
  if (!types.includes(value.mimeType) || typeof value.data !== 'string'
    || value.data.length % 4 !== 0 || !value.data.length) fail();
  // Canonical re-encoding checks the alphabet, padding and pad bits without a stack-growing regex.
  const bytes = Buffer.from(value.data, 'base64');
  if (bytes.toString('base64') !== value.data) fail();
  return bytes;
}
export const newRequestId = () => randomUUID();
export function parseInvoke(value) {
  boundedJson(value, LIMITS.request);
  keys(value, ['requestId', 'revision', 'capability', 'input']);
  if (!uuid(value.requestId) || !hash(value.revision) || !CAPABILITIES.includes(value.capability)) fail();
  const input = value.input;
  if (value.capability === 'model.text' || value.capability === 'model.video') {
    keys(input, ['messages', 'video', 'temperature', 'maxTokens'], ['messages']);
    if (!Array.isArray(input.messages) || !input.messages.length || input.messages.length > 64) fail();
    for (const message of input.messages) {
      keys(message, ['role', 'content']);
      if (!['system', 'user', 'assistant'].includes(message.role) || !text(message.content, 256 * 1024)) fail();
    }
    if (input.temperature !== undefined && (!Number.isFinite(input.temperature) || input.temperature < 0 || input.temperature > 2)
      || input.maxTokens !== undefined && (!Number.isSafeInteger(input.maxTokens) || input.maxTokens < 1 || input.maxTokens > 32768)) fail();
    if (value.capability === 'model.video') media(input.video, ['video/mp4', 'video/webm']);
    else if (input.video !== undefined) fail();
  } else if (value.capability === 'model.asr') {
    keys(input, ['audio']);
    media(input.audio, ['audio/wav', 'audio/mpeg', 'audio/mp4', 'audio/webm']);
  } else {
    keys(input, ['text', 'voice', 'format']);
    if (!text(input.text, 4096) || !text(input.voice, 128) || !['mp3', 'wav', 'pcm'].includes(input.format)) fail();
  }
  return JSON.parse(boundedJson(value, LIMITS.request));
}
export function parseContext(value, declared) {
  boundedJson(value, LIMITS.launch);
  keys(value, ['version', 'revision', 'capabilities']);
  if (value.version !== 1) fail('UNSUPPORTED_VERSION');
  if (!hash(value.revision) || !Array.isArray(value.capabilities) || value.capabilities.length !== declared.length) fail();
  const seen = new Set();
  for (const item of value.capabilities) {
    keys(item, ['id', 'available', 'reason', 'model', 'channel', 'region'], ['id', 'available']);
    if (!declared.includes(item.id) || seen.has(item.id) || typeof item.available !== 'boolean') fail();
    seen.add(item.id);
    if (item.reason !== undefined && !ERROR_CODES.includes(item.reason)
      || !item.available && item.reason === undefined
      || item.available && (!text(item.model, 160) || !['plan', 'api'].includes(item.channel)
        || !['cn', 'oversea'].includes(item.region))) fail();
    if (!item.available && (item.model !== undefined || item.channel !== undefined || item.region !== undefined)) fail();
  }
  return JSON.parse(boundedJson(value, LIMITS.launch));
}
export function parseResult(value, request) {
  keys(value, ['version', 'requestId', 'result']);
  if (value.version !== 1 || value.requestId !== request.requestId) fail();
  if (request.capability === 'model.tts') {
    keys(value.result, ['type', 'mimeType', 'data']);
    if (value.result.type !== 'audio') fail();
    const { mimeType, data } = value.result;
    if (mimeType !== { mp3: 'audio/mpeg', wav: 'audio/wav', pcm: 'audio/pcm' }[request.input.format]) fail();
    const bytes = media({ mimeType, data }, ['audio/mpeg', 'audio/wav', 'audio/pcm']);
    if (bytes.length > LIMITS.audio) fail('TOO_LARGE');
  } else {
    keys(value.result, ['type', 'text']);
    if (value.result.type !== 'text' || typeof value.result.text !== 'string') fail();
    if (Buffer.byteLength(value.result.text) > LIMITS.text) fail('TOO_LARGE');
  }
  return value.result;
}
