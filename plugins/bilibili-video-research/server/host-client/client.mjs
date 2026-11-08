import { HOST_ENV, HostClientError, LIMITS, fail, keys, parseContext, parseInvoke, parseResult, takeLaunchContext } from './protocol.mjs';

export { HostClientError, newRequestId } from './protocol.mjs';
export function createHostClient({ pluginId, consumer, environment = process.env, fetch: request = globalThis.fetch }) {
  // Consume before validation, so even a rejected launch cannot leak to ordinary descendants.
  const launch = takeLaunchContext(environment, { pluginId, consumer });
  const pending = new Set();
  let closed = false;
  const active = () => {
    if (closed) fail('CLOSED');
    if (launch.mode !== 'follow') fail('CAPABILITY_UNAVAILABLE');
    if (Date.now() >= launch.broker.expiresAt) fail('STALE_CONTEXT');
  };
  async function call(route, payload, timeout, signal, limit = LIMITS.launch) {
    active();
    const controller = new AbortController();
    pending.add(controller);
    const onAbort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), timeout);
    timer.unref?.();
    try {
      const response = await request(`${launch.broker.origin}/v1/${route}`, {
        method: 'POST', redirect: 'error',
        headers: { authorization: `Bearer ${launch.broker.token}`, 'content-type': 'application/json' },
        body: JSON.stringify(payload), signal: controller.signal,
      });
      if (response.redirected || response.url && response.url !== `${launch.broker.origin}/v1/${route}`
        || response.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') fail();
      const length = response.headers.get('content-length');
      if (length !== null && (!/^\d+$/u.test(length) || Number(length) > limit)) {
        await response.body?.cancel().catch(() => {});
        fail('TOO_LARGE');
      }
      if (!response.body) fail();
      const reader = response.body.getReader();
      const chunks = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > limit) fail('TOO_LARGE');
          chunks.push(value);
        }
      } finally { await reader.cancel().catch(() => {}); }
      let value;
      try { value = JSON.parse(Buffer.concat(chunks, size).toString('utf8')); } catch { fail(); }
      if (!response.ok) {
        keys(value, ['version', 'error']);
        keys(value.error, ['code']);
        if (value.version !== 1) fail('UNSUPPORTED_VERSION');
        throw new HostClientError(value.error.code);
      }
      active();
      return value;
    } catch (error) {
      if (closed) fail('CLOSED');
      if (signal?.aborted) fail('CANCELLED');
      if (controller.signal.aborted) fail('TIMEOUT');
      if (error instanceof HostClientError) throw error;
      fail('HOST_UNAVAILABLE');
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      pending.delete(controller);
    }
  }
  async function cancelRequest(requestId) {
    parseInvoke({ requestId, revision: '0'.repeat(64), capability: 'model.text',
      input: { messages: [{ role: 'user', content: 'cancel' }] } });
    const result = await call('cancel', { requestId }, 10000);
    keys(result, ['version', 'requestId', 'cancelled']);
    if (result.version !== 1 || result.requestId !== requestId || typeof result.cancelled !== 'boolean') fail();
    return result.cancelled;
  }
  return Object.freeze({
    mode: launch.mode, dataDirectory: launch.dataDirectory,
    configurationRevision: launch.configurationRevision,
    async context(options = {}) {
      return parseContext(await call('context', {}, 10000, options.signal), launch.capabilities);
    },
    async invoke(input, options = {}) {
      const value = parseInvoke(input);
      if (!launch.capabilities.includes(value.capability)) fail('CAPABILITY_UNAVAILABLE');
      const cancel = () => { cancelRequest(value.requestId).catch(() => {}); };
      options.signal?.addEventListener('abort', cancel, { once: true });
      try {
        return parseResult(await call('invoke', value, LIMITS.provider + LIMITS.confirmation + LIMITS.queue,
          options.signal, LIMITS.response), value);
      } finally { options.signal?.removeEventListener('abort', cancel); }
    },
    cancel: cancelRequest,
    close() {
      closed = true;
      for (const controller of pending) controller.abort();
      if (launch.broker) launch.broker.token = '';
      delete environment[HOST_ENV];
    },
  });
}
