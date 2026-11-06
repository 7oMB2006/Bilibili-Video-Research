import { spawn } from "node:child_process";
import { configurationRevision, defaultConfigPath, prepareLaunch, readConfiguration, SetupError } from "./config.mjs";

try {
  const arguments_ = process.argv.slice(2);
  if (arguments_.some(value => value !== "--check") || arguments_.length > 1)
    throw new SetupError("Usage: node server/start.mjs [--check]");
  const config = await readConfiguration(defaultConfigPath);
  const revision = await configurationRevision(defaultConfigPath, config);
  const launch = await prepareLaunch(config, process.env, { validateOnly: arguments_[0] === "--check" });
  if (await configurationRevision(defaultConfigPath, config) !== revision)
    throw new SetupError("BVR configuration changed during startup. Restart the session; no provider fallback is used.");
  if (arguments_[0] === "--check") {
    process.stdout.write(`BVR configuration OK: ${launch.provider} / ${launch.channel}. No provider request was made.\n`);
  } else {
    launch.environment.BVR_DFSC_CONFIG_PATH = defaultConfigPath;
    launch.environment.BVR_DFSC_CONFIG_REVISION = revision;
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
  process.stderr.write(`BVR: ${error instanceof SetupError ? error.message : "Startup failed. Check the private BVR configuration."}\n`);
  process.exitCode = 1;
}
