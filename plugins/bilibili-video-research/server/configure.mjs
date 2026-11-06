import { mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { prepareLaunch, SetupError } from "./config.mjs";

try {
  const values = {};
  let replace = false;
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--replace" && !replace) { replace = true; continue; }
    const option = args[index];
    if (!["--profile", "--runtime", "--env-file", "--mode"].includes(option) || values[option] !== undefined
        || !args[index + 1] || args[index + 1].startsWith("--"))
      throw new SetupError("Usage: node server/configure.mjs --profile <DFSC step-runtime> --runtime <BVR checkout> [--mode dfsc|independent] [--env-file <private file>] [--replace]");
    values[option] = args[++index];
  }
  if (!["--profile", "--runtime"].every(key => values[key] && isAbsolute(values[key]))
      || values["--env-file"] && !isAbsolute(values["--env-file"]))
    throw new SetupError("--profile, --runtime and --env-file must all be absolute paths.");
  const mode = values["--mode"] ?? "dfsc";
  if (!["dfsc", "independent"].includes(mode)) throw new SetupError("--mode must be dfsc or independent.");
  const config = {
    schemaVersion: 2, mode, runtimeDirectory: values["--runtime"],
    ...(mode === "dfsc" ? { hostAccess: "confirm" } : {}),
    ...(values["--env-file"] ? { envFile: values["--env-file"] } : {}),
  };
  const launch = await prepareLaunch(config, process.env, { validateOnly: true });
  const directory = join(values["--profile"], "bvr");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    await writeFile(join(directory, "config.json"), `${JSON.stringify(config, null, 2)}\n`,
      { flag: replace ? "w" : "wx", mode: 0o600 });
  } catch (error) {
    if (error.code === "EEXIST") throw new SetupError("BVR config already exists. Review it before using --replace.");
    throw new SetupError("Could not save the private BVR configuration.");
  }
  process.stdout.write(`Saved BVR path configuration: ${launch.provider} / ${launch.channel}. No credentials were copied and no provider request was made.\n`);
} catch (error) {
  process.stderr.write(`BVR: ${error instanceof SetupError ? error.message : "Configuration failed."}\n`);
  process.exitCode = 1;
}
