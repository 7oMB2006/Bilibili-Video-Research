# Bilibili Video Research

Give your agent a Bilibili link and a research question. BVR uses subtitles,
audio or video frames to produce evidence traceable to the original video.

## Get Started

This page describes the unpublished `0.2.0` generic-host candidate.
Legacy hosts and the BVR-specific account bridge are not compatible.

### Before Installing

- **DFSC `0.6.0`** must also provide generic host v1, independent configuration
  snapshots and launch authorization. The verified Windows combination used
  main `dcab32806645502250ba1c8efd56e153e95d657b`. An older build with the same
  version, or an unverified platform, is not covered merely by matching versions.
- **Node.js 24+ and the BVR runtime** must be prepared separately in the same
  environment. Put Node.js on PATH, update to a runtime with
  `dfscHostApiVersion: 1`, install its dependencies and register its path.
  FFmpeg and yt-dlp are normally supplied by those npm dependencies, not separate
  manual installations.
- **Model access and quota** are required. Follow mode needs an available
  session account and explicit confirmation; independent mode uses your own
  main connection and, when needed, a separate ASR connection. Calls may incur costs.
- **Optional cookies** are only needed when anonymous access is insufficient.
  Use only a local file that you explicitly authorize.

Marketplace requirements are author declarations, not local detection,
runtime installation or account authorization. They come from
`dfsc.plugin.json`, not automatic extraction of this guide.

### Steps

1. Explicitly update the separate BVR runtime and its dependencies. Plugin installation
   does not install the runtime or Node.js.
2. Register and check the runtime path using the [technical guide](../README.md),
   then open the plugin's configuration gear.
3. Choose Follow DFSC, or configure independent main-model and ASR connections,
   then save.
4. Enable the MCP service and manually restart the idle session that needs it.
5. Check the active connection in Capabilities before submitting your question.

```text
/bvr Identify the projects and requirements in this video. Separate evidence from inference.
https://www.bilibili.com/video/BV1dPeP6REwM/
```

## Choose Evidence

| Mode | Reads | Suitable Questions |
| --- | --- | --- |
| Language | Subtitles, or ASR when necessary | Spoken claims and project recommendations |
| Vision | Video frames | Interfaces, charts and demonstrated steps |
| Multimodal | Language and frames | Cross-checking narration against screen evidence |

## Models and Cost

Follow mode uses the effective account, region, channel and compatible model of
the calling DFSC session. The first model request requires explicit in-session
confirmation. A failed Plan request never silently falls back to direct API
billing. Audio transcription uses a dedicated ASR capability; a chat model is
not automatically an audio-transcription model.

In independent mode, the main model and ASR have separate endpoint, key and
model fields. Switching the DFSC chat account does not change those independent
connections.
Step ASR requires all three separate fields; empty ASR settings never borrow
the main key. Existing keys and authorization are not automatically migrated.
Model requests may consume credits or balance. The local
environment check does not verify live account access or billing. Cancellation
cannot reverse costs of requests already accepted by a provider.

## Data and Permissions

Media, subtitles, public metadata and sampled comments may be sent to the
selected provider. Public videos do not always need cookies; use only local
cookie files that you explicitly authorize. Never share keys, cookies, private
configuration or per-launch contexts in chat or issue reports.
This is a local native-plugin integration, not a sandbox for malicious plugins.

See the [plugin technical guide](../README.md) for installation commands,
compatibility and independent provider configuration. Project documentation and
the community tutorial are available through the related links on this page.
