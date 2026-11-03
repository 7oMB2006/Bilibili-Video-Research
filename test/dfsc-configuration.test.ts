import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertDfscConfigurationCurrent } from "../src/dfsc-configuration.js";
import { analyzeMediaWithProvider, analyzeTextWithProvider } from "../src/video-analysis.js";
import { withDfscOperation } from "../src/dfsc.js";

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "bvr-config-revision-"));
  const path = join(root, "config.json"), envFile = join(root, "private.env");
  const raw = JSON.stringify({ schemaVersion: 2, mode: "independent", envFile });
  const environment = "STEPFUN_API_KEY=old-private-key\n";
  await writeFile(path, raw); await writeFile(envFile, environment);
  const values = {
    BVR_DFSC_CONFIG_PATH: path,
    BVR_DFSC_CONFIG_REVISION: createHash("sha256").update(raw).update("\0").update(environment).digest("hex"),
    BVR_DFSC_MODE: "", CODEX_VIDEO_PROVIDER: "stepfun",
    STEPFUN_API_KEY: "old-private-key", STEPFUN_BASE_URL: "https://api.stepfun.com/v1",
    STEPFUN_ASR_API_KEY: "separate-asr-key", STEPFUN_ASR_BASE_URL: "https://api.stepfun.ai/step_plan/v1",
    GEMINI_API_KEY: "old-gemini-key",
  };
  const saved = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  const fetch = globalThis.fetch;
  t.after(async () => {
    globalThis.fetch = fetch;
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await rm(root, { recursive: true, force: true });
  });
  return { root, path, envFile, raw, environment };
}

test("DFSC-launch snapshot blocks stale Step, Gemini and hosted requests without network fallback", async t => {
  const { path } = await fixture(t);
  await assertDfscConfigurationCurrent();
  await writeFile(path, JSON.stringify({ schemaVersion: 2, mode: "dfsc", hostAccess: "confirm" }));
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("network must not be used"); };
  await assert.rejects(analyzeTextWithProvider("step"), /Restart the session/);
  process.env.CODEX_VIDEO_PROVIDER = "gemini";
  await assert.rejects(analyzeTextWithProvider("gemini"), /Restart the session/);
  process.env.BVR_DFSC_MODE = "1";
  await assert.rejects(withDfscOperation(async () => { calls++; }), /Restart the session/);
  assert.equal(calls, 0);
});

test("configuration change between ASR and synthesis blocks the second paid request", async t => {
  const { root, envFile } = await fixture(t);
  const audio = join(root, "audio.wav");
  await writeFile(audio, "fixture");
  const calls: string[] = [];
  globalThis.fetch = async url => {
    calls.push(String(url));
    await writeFile(envFile, "STEPFUN_API_KEY=replaced-key\n");
    return new Response('data: {"type":"transcript.text.done","text":"speech"}\n\n');
  };
  await assert.rejects(analyzeMediaWithProvider(audio, "summarize"), /Restart the session/);
  assert.deepEqual(calls, ["https://api.stepfun.ai/step_plan/v1/audio/asr/sse"]);
});

test("missing files and partial launch guards fail closed; standalone launch is unchanged", async t => {
  const { envFile } = await fixture(t);
  await rm(envFile);
  await assert.rejects(assertDfscConfigurationCurrent(), /Restart the session/);
  delete process.env.BVR_DFSC_CONFIG_PATH;
  await assert.rejects(assertDfscConfigurationCurrent(), /Restart the session/);
  delete process.env.BVR_DFSC_CONFIG_REVISION;
  await assertDfscConfigurationCurrent();
});
