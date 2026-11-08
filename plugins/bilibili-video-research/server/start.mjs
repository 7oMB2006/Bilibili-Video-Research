import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { defaultConfigPath, pluginRoot, prepareLaunch, readConfiguration, SetupError } from "./config.mjs";
import { ConfigurationReader } from "./configuration.mjs";
import { identity, prepareHostLaunch } from "./host-config.mjs";
import { HostClientError, takeLaunchContext } from "./host-client/protocol.mjs";

async function setupBytes() {
  const info = await stat(defaultConfigPath);
  if (!info.isFile() || info.size > 65536) throw new SetupError("BVR runtime setup is unavailable or too large.");
  const bytes = await readFile(defaultConfigPath);
  if (bytes.length > 65536) throw new SetupError("BVR runtime setup is too large.");
  return bytes;
}

try {
  const arguments_ = process.argv.slice(2);
  if (arguments_.some(value => value !== "--check") || arguments_.length > 1)
    throw new SetupError("Usage: node server/start.mjs [--check]");
  if (arguments_[0] === "--check") {
    const setup = await readConfiguration();
    const launch = await prepareLaunch({ schemaVersion: 2, mode: "dfsc", hostAccess: "confirm",
      runtimeDirectory: setup.runtimeDirectory }, process.env, { validateOnly: true });
    const manifest = JSON.parse(await readFile(`${launch.runtimeDirectory}/package.json`, "utf8"));
    if (manifest.dfscHostApiVersion !== 1) throw new SetupError("Update the BVR runtime to the generic DFSC host v1 adapter.");
    process.stdout.write("BVR runtime configuration OK. Mode and authorization are selected in DFSC; no provider request was made.\n");
  } else {
    const context = takeLaunchContext(process.env, identity);
    const initialSetup = await setupBytes();
    const setup = JSON.parse(initialSetup.toString("utf8"));
    const reader = context.mode === "independent" ? new ConfigurationReader(pathToFileURL(`${pluginRoot}/`)) : undefined;
    const launch = await prepareHostLaunch(setup, context, process.env, await reader?.current());
    if (!(await setupBytes()).equals(initialSetup))
      throw new SetupError("BVR runtime setup changed during startup. Restart the session.");
    launch.environment.BVR_DFSC_SETUP_PATH = defaultConfigPath;
    launch.environment.BVR_DFSC_SETUP_REVISION = createHash("sha256").update(initialSetup).digest("hex");
    if (reader) {
      if ((await reader.current()).revision !== context.configurationRevision)
        throw new SetupError("BVR independent configuration changed during startup.");
      launch.environment.BVR_DFSC_PLUGIN_DIRECTORY = pluginRoot;
      launch.environment.BVR_DFSC_CONFIGURATION_REVISION = context.configurationRevision;
    }
    const child = spawn(process.execPath, launch.args, {
      cwd: launch.runtimeDirectory,
      env: launch.environment,
      stdio: "inherit",
      windowsHide: true,
    });
    const terminate = () => child.kill();
    for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, terminate);
    const code = await new Promise((done, fail) => {
      child.once("error", () => fail(new SetupError("The BVR runtime could not start.")));
      child.once("exit", (status) => done(status ?? 1));
    }).finally(() => {
      for (const signal of ["SIGINT", "SIGTERM"]) process.off(signal, terminate);
    });
    process.exitCode = code;
  }
} catch (error) {
  process.stderr.write(`BVR: ${error instanceof SetupError || error instanceof HostClientError ? error.message
    : "Startup failed. Configure the runtime path, select a mode in an updated DFSC host and restart; no legacy or provider fallback was used."}\n`);
  process.exitCode = 1;
}
