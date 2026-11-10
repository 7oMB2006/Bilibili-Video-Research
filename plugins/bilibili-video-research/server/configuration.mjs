import { createHash } from 'node:crypto';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const fail = () => { throw new Error('Plugin configuration unavailable or changed; save and restart the service.'); };
const hash = value => createHash('sha256').update(value).digest('hex');
export function clearInheritedCredentials() {
  for (const key of Object.keys(process.env)) if (/key|token|secret|password|authorization|cookie|^STEP|^OPENAI|^ANTHROPIC|^AZURE/iu.test(key))
    delete process.env[key];
}
async function read(root, path, limit = 256 * 1024) {
  if (!path || /[:\\\0]/u.test(path) || path.split('/').some(part => !part || part === '..' || part === '.')) fail();
  let target = resolve(root);
  const canonicalRoot = await realpath(target);
  if (canonicalRoot !== target || (await lstat(target)).isSymbolicLink()) fail();
  for (const part of path.split('/')) {
    target = join(target, part);
    if ((await lstat(target)).isSymbolicLink()) fail();
  }
  const before = await lstat(target);
  const canonicalTarget = await realpath(target);
  if (canonicalTarget !== target || !before.isFile() || before.size > limit) fail();
  const handle = await open(target, 'r');
  try {
    const stat = await handle.stat();
    if (before.ino !== stat.ino || before.dev !== stat.dev) fail();
    const bytes = Buffer.alloc(before.size + 1);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    const after = await lstat(target), held = await handle.stat();
    if (bytesRead !== before.size || before.ino !== after.ino || before.dev !== after.dev
      || before.mtimeMs !== after.mtimeMs || before.size !== held.size || before.mtimeMs !== held.mtimeMs
      || await realpath(target) !== canonicalTarget || await realpath(root) !== canonicalRoot) fail();
    let cursor = resolve(root);
    if ((await lstat(cursor)).isSymbolicLink()) fail();
    for (const part of path.split('/')) {
      cursor = join(cursor, part);
      if ((await lstat(cursor)).isSymbolicLink()) fail();
    }
    return bytes.subarray(0, bytesRead);
  } finally { await handle.close(); }
}
async function fingerprint(root) {
  const digest = createHash('sha256');
  let count = 0, size = 0;
  async function visit(path = '') {
    if ((await lstat(path ? join(root, path) : root)).isSymbolicLink()) fail();
    for (const item of (await readdir(join(root, path), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (++count > 10000 || item.isSymbolicLink()) fail();
      const child = path ? `${path}/${item.name}` : item.name;
      if (item.isDirectory()) await visit(child);
      else {
        const bytes = await read(root, child, 128 * 1024 * 1024);
        size += bytes.length;
        if (size > 128 * 1024 * 1024) fail();
        digest.update(JSON.stringify([child, bytes.length])).update(bytes);
      }
    }
  }
  await visit();
  return digest.digest('hex');
}
export class ConfigurationReader {
  constructor(packageUrl) {
    this.directory = resolve(fileURLToPath(packageUrl));
    if (basename(dirname(this.directory)) !== 'plugins') fail();
    this.root = dirname(dirname(this.directory));
    this.folder = basename(this.directory);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/u.test(this.folder)) fail();
  }
  async current() {
    try {
      const bindingPath = `desktop-plugins/bindings/${this.folder}.json`;
      const bindingBytes = await read(this.root, bindingPath);
      const binding = JSON.parse(bindingBytes.toString('utf8'));
      if (binding.version !== 1 || binding.revoked || !/^[a-f0-9-]{36}$/u.test(binding.instance)
        || !/^[a-f0-9]{64}$/u.test(binding.revision)) fail();
      const receipts = JSON.parse((await read(this.root, 'desktop-plugins/installations.json', 1024 * 1024)).toString('utf8'));
      const matches = item => item.instance === binding.instance && item.folder === this.folder
        && item.id === binding.id && item.state === 'installed' && item.fingerprint === binding.fingerprint;
      if (receipts.version !== 1 || receipts.installations.filter(matches).length !== 1) fail();
      const configPath = `desktop-plugins/settings/${binding.instance}/${binding.revision}.json`;
      const configBytes = await read(this.root, configPath);
      const config = JSON.parse(configBytes.toString('utf8'));
      const manifest = JSON.parse((await read(this.directory, 'step.plugin.json', 512 * 1024)).toString('utf8'));
      if (manifest.id !== binding.id || config.version !== 1 || config.instance !== binding.instance
        || config.id !== binding.id || config.revision !== binding.revision || config.schemaHash !== binding.schemaHash
        || hash(JSON.stringify(config)) !== binding.contentHash
        || hash(await read(this.directory, 'dfsc.settings.json', 65536)) !== binding.schemaHash
        || await fingerprint(this.directory) !== binding.fingerprint) fail();
      const rechecked = JSON.parse((await read(this.root, 'desktop-plugins/installations.json', 1024 * 1024)).toString('utf8'));
      if (rechecked.version !== 1 || rechecked.installations.filter(matches).length !== 1
        || !(await read(this.root, bindingPath)).equals(bindingBytes) || !(await read(this.root, configPath)).equals(configBytes)) fail();
      const stamp = hash(JSON.stringify(binding));
      if (this.stamp && this.stamp !== stamp) fail();
      this.stamp = stamp;
      return { values: config.values, secrets: config.secrets, revision: config.revision };
    } catch { fail(); }
  }
}
