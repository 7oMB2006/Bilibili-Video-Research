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
      throw new SetupError("Usage: node server/configure.mjs --profile <DFSC step-runtime> --runtime <BVR checkout> [--replace]; select model mode and keys in DFSC.");
    values[option] = args[++index];
  }
  if (!["--profile", "--runtime"].every(key => values[key] && isAbsolute(values[key]))
      || values["--env-file"] && !isAbsolute(values["--env-file"]))
    throw new SetupError("--profile, --runtime and --env-file must all be absolute paths.");
  if (values["--mode"] !== undefined || values["--env-file"] !== undefined)
    throw new SetupError("Model mode and private environment files are no longer configured by this command. Use the DFSC plugin settings; no legacy authorization or key is migrated.");
  const config = {
    schemaVersion: 3, runtimeDirectory: values["--runtime"],
  };
  await prepareLaunch({ schemaVersion: 2, mode: "dfsc", hostAccess: "confirm",
    runtimeDirectory: config.runtimeDirectory }, process.env, { validateOnly: true });
  const directory = join(values["--profile"], "bvr");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    await writeFile(join(directory, "config.json"), `${JSON.stringify(config, null, 2)}\n`,
      { flag: replace ? "w" : "wx", mode: 0o600 });
  } catch (error) {
    if (error.code === "EEXIST") throw new SetupError("BVR config already exists. Review it before using --replace.");
    throw new SetupError("Could not save the private BVR configuration.");
  }
  process.stdout.write("Saved the BVR runtime path only. Select the mode and independent keys in DFSC. No credentials were copied and no provider request was made.\n");
} catch (error) {
  process.stderr.write(`BVR: ${error instanceof SetupError ? error.message : "Configuration failed."}\n`);
  process.exitCode = 1;
}
