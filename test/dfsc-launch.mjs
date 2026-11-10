import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function hostLaunch(overrides = {}) {
  return {
    version: "dfsc-launch-v1", mode: "follow", pluginId: "bilibili-video-research", consumer: "bvr",
    instance: randomUUID(), fingerprint: "a".repeat(64), declarationHash: "b".repeat(64),
    revision: "c".repeat(64), configurationRevision: null, launchId: randomUUID(),
    runtimeId: randomUUID(), sessionId: "isolated-bvr-session", accountRevision: "d".repeat(64),
    capabilities: ["model.text", "model.video", "model.asr"], models: {},
    dataDirectory: join(tmpdir(), "bvr-fixture-data"),
    broker: { origin: "http://127.0.0.1:12345", token: "e".repeat(43), expiresAt: Date.now() + 60_000 },
    ...overrides,
  };
}
