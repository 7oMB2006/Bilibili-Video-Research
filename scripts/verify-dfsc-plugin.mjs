import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { isolatedEnvironment, pluginRoot } from "../plugins/bilibili-video-research/server/config.mjs";

const execute = promisify(execFile);
const repository = dirname(dirname(fileURLToPath(import.meta.url)));
const arguments_ = process.argv.slice(2);
const options = {};
for (let index = 0; index < arguments_.length; index += 2) {
  const key = arguments_[index];
  const value = arguments_[index + 1];
  assert.ok(["--desktop", "--output", "--marketplace", "--marketplace-name", "--host-modules"].includes(key) && !options[key]
    && typeof value === "string" && value.length > 0
    && (key === "--marketplace-name" || isAbsolute(value)),
    "Usage: node scripts/verify-dfsc-plugin.mjs --desktop <staged Desktop directory> --output <new directory> [--host-modules <absolute host module directory>] [--marketplace <absolute market directory> --marketplace-name <name>]");
  options[key] = value;
}
assert.ok(options["--desktop"] && options["--output"], "--desktop and --output are required");
assert.equal(Boolean(options["--marketplace"]), Boolean(options["--marketplace-name"]),
  "--marketplace and --marketplace-name must be supplied together");
const output = resolve(options["--output"]);
await mkdir(output, { recursive: false });
const desktop = resolve(options["--desktop"]);
const hostModules = resolve(options["--host-modules"] ?? join(desktop, "runtime"));
const profile = join(output, "profile", "step-runtime");
const agentDir = join(profile, "agent");
const marketplace = options["--marketplace"] ?? join(output, "bvr-local-preview");
const marketplaceName = options["--marketplace-name"] ?? "bvr-local-preview";
await mkdir(agentDir, { recursive: true });
if (!options["--marketplace"]) {
  await mkdir(join(marketplace, ".step-plugin"), { recursive: true });
  await cp(pluginRoot, join(marketplace, "plugins", "bilibili-video-research"), { recursive: true });
  await writeFile(join(marketplace, ".step-plugin", "marketplace.json"), JSON.stringify({
    name: marketplaceName,
    plugins: [{ name: "bilibili-video-research", source: "./plugins/bilibili-video-research",
      description: "Local BVR companion preview. A separately configured runtime is required." }],
  }, null, 2));
}

// Set isolation before importing the real DFSC/upstream management bundle.
const isolated = isolatedEnvironment(process.env, {});
for (const key of Object.keys(process.env)) delete process.env[key];
Object.assign(process.env, isolated, {
  HOME: profile, USERPROFILE: profile, STEPCODE_STORAGE_ROOT_DIR: profile,
  STEP_CODING_AGENT_DIR: agentDir, STEP_CODING_AGENT_SESSION_DIR: join(agentDir, "sessions"),
  STEPCODE_AUTH_PATH: join(agentDir, "auth.json"),
});
const upstream = await import(pathToFileURL(join(desktop, "runtime", "step", "dist", "bundle", "index.js")).href);
const { createCapabilitySettings } = await import(pathToFileURL(join(hostModules, "capability-settings.mjs")).href);
const { PluginLibrary } = await import(pathToFileURL(join(hostModules, "plugin-library.mjs")).href);
const manager = createCapabilitySettings(upstream, { root: profile });
const library = new PluginLibrary(profile);
const expectedPresentation = JSON.parse(await readFile(join(pluginRoot, "dfsc.plugin.json"), "utf8"));
const report = {
  kind: "local-unpublished-preview",
  marketplace: marketplaceName,
  marketplaceSource: marketplace,
  desktopRuntime: JSON.parse(await readFile(join(desktop, "runtime", "manifest.json"), "utf8")).commit,
  hostModules,
  realProviderRequests: false,
  checks: [],
};
const check = name => report.checks.push(name);
async function verifyPresentation(entry) {
  assert.equal(entry.repository, "https://github.com/7oMB2006/Bilibili-Video-Research");
  assert.equal(entry.package.provenance, "recorded");
  assert.deepEqual(entry.package.warnings, []);
  assert.deepEqual(entry.package.categories, expectedPresentation.categories);
  assert.deepEqual(entry.package.keywords, expectedPresentation.keywords);
  assert.deepEqual(entry.package.requirements, expectedPresentation.requirements);
  assert.deepEqual(entry.package.locales, expectedPresentation.locales);
  assert.equal(entry.package.tutorials[0].url, expectedPresentation.tutorials[0].url);
  assert.deepEqual(entry.package.links, expectedPresentation.links);
  for (const language of ["zh", "en"]) {
    const path = entry.package.locales[language].documentation.readme;
    const document = await library.document({ ref: entry.package.ref, path });
    assert.equal(document.text, await readFile(join(pluginRoot, path), "utf8"));
    assert.equal(document.links["../README.md"], "README.md");
    const technicalGuide = await library.document({ ref: entry.package.ref, path: "README.md" });
    const root = options["--marketplace"] ? join(marketplace, "plugins", "bilibili-video-research") : pluginRoot;
    assert.equal(technicalGuide.text, await readFile(join(root, "README.md"), "utf8"));
  }
}
await manager.mutate({ action: "marketplace-add", source: marketplace }, AbortSignal.timeout(30_000));
let catalog = await library.project(await manager.catalog());
const available = catalog.available.find(item => item.name === "bilibili-video-research" && item.marketplace === marketplaceName);
assert.ok(available);
await verifyPresentation(available);
check("Native discovery projects categories, declared host/external requirements, bilingual docs and link cards");
await manager.mutate({ action: "plugin-install", name: "bilibili-video-research", marketplace: marketplaceName },
  AbortSignal.timeout(30_000));
catalog = await library.project(await manager.catalog());
const plugin = catalog.plugins.find(item => item.id === "bilibili-video-research");
assert.ok(plugin);
assert.equal(plugin.marketplace, marketplaceName);
assert.deepEqual(plugin.installationSource, { status: "recorded", marketplaces: [marketplaceName] });
await verifyPresentation(plugin);
assert.equal(plugin.icon?.kind, "png");
assert.ok(catalog.mcp.some(item => item.name === "bilibili-video-research__bvr" && item.source === "plugin"));
assert.ok(catalog.skills.some(item => item.name === "bilibili-video-research" && item.source === "plugin"));
check("Native install preserves marketplace provenance, declared requirements, PNG icon, skill and MCP declaration");
const resources = await upstream.discoverStepPluginResourcePaths({ userDir: join(profile, "plugins"), projectTrusted: false });
assert.deepEqual(resources.warnings, []);
const loader = new upstream.DefaultResourceLoader({
  cwd: output, agentDir, settingsManager: upstream.SettingsManager.inMemory(),
  noExtensions: true, noThemes: true, noContextFiles: true,
});
const resourcePaths = paths => paths.map(path => ({ path,
  metadata: { source: "plugin:bilibili-video-research", scope: "user", origin: "top-level", baseDir: profile } }));
loader.extendResources({ skillPaths: resourcePaths(resources.skillPaths), promptPaths: resourcePaths(resources.promptPaths) });
assert.ok(loader.getSkills().skills.some(item => item.name === "bilibili-video-research"));
assert.ok(loader.getPrompts().prompts.some(item => item.name === "bvr"));
check("Real DFSC resource loader resolves skill and /bvr prompt");
const installed = join(profile, "plugins", "bilibili-video-research");
await execute(process.execPath, [join(installed, "server", "configure.mjs"), "--profile", profile,
  "--runtime", repository], { env: process.env, timeout: 15_000 });
await assert.rejects(execute(process.execPath, [join(installed, "server", "start.mjs")], {
  env: { ...process.env, STEPFUN_API_KEY: "desktop-credential-must-not-be-used" }, timeout: 10000,
}), error => /HOST_UNAVAILABLE/.test(error.stderr) && error.stdout === "");
check("Native install and runtime setup do not grant generic host authorization");
const saved = await readFile(join(profile, "bvr", "config.json"), "utf8");
await manager.mutate({ action: "plugin-remove", id: "bilibili-video-research" }, AbortSignal.timeout(30_000));
assert.ok(!(await manager.catalog()).plugins.some(item => item.id === "bilibili-video-research"));
assert.equal(await readFile(join(profile, "bvr", "config.json"), "utf8"), saved);
check("Native uninstall preserves runtime setup without preserving authorization");
await manager.mutate({ action: "plugin-install", name: "bilibili-video-research", marketplace: marketplaceName },
  AbortSignal.timeout(30_000));
catalog = await library.project(await manager.catalog());
await verifyPresentation(catalog.plugins.find(item => item.id === "bilibili-video-research"));
const result = await execute(process.execPath, [join(installed, "server", "start.mjs"), "--check"], { env: process.env });
assert.match(result.stdout, /runtime configuration OK/);
check("Native reinstall keeps runtime path, not legacy mode or paid approval");
await writeFile(join(output, "verification.json"), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
