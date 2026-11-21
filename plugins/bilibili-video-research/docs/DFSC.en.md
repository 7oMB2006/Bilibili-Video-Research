# Bilibili Video Research

Give your agent a Bilibili link and a research question. BVR uses subtitles,
audio or video frames to produce evidence traceable to the original video.

## Get Started

This page describes the unpublished `0.2.1` generic-host candidate.
Legacy hosts and the BVR-specific account bridge are not compatible.

### Before Installing

- **A compatible DFSC build** must provide generic host v1, launch authorization
  and per-capability routing. The candidate declares `0.6.0`, but previous Windows
  verification at `dcab32806645502250ba1c8efd56e153e95d657b` does not cover this routing.
- **Node.js 24+ and the BVR runtime** must be prepared separately in the same
  environment. Put Node.js on PATH, update to a runtime with
  `dfscHostApiVersion: 1` and `dfscCapabilityRoutingVersion: 1`, install its dependencies and register its path.
  FFmpeg and yt-dlp are normally supplied by those npm dependencies, not separate
  manual installations.
- **Model access and quota** are required. DFSC quota needs a connected Step
  account and per-capability confirmation. Independent calls use your own connection
  settings. Calls may incur costs.
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
3. Enable the sources you need, assign a source to text, video or ASR, then save.
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

DFSC quota uses the account, channel and model selected for the plugin, not
the chat model. The first use of each capability on that account requires
in-session confirmation. A failed request never switches sources.
Audio transcription uses a dedicated ASR capability.

For example, text and video can use Step Plan while ASR uses an independent
connection. In that case fill in the ASR endpoint, key and model; leave the
independent main-model fields blank. Unassigned capabilities are unavailable,
and ASR never borrows the main key. Existing keys and authorization are not
automatically migrated.
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
