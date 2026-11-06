# Bilibili Video Research

Give your agent a Bilibili link and a research question. BVR uses subtitles,
audio or video frames to produce evidence traceable to the original video.

## Get Started

1. Install the BVR runtime and its dependencies separately. Plugin installation
   does not install the runtime or Node.js.
2. Open the plugin's configuration gear, select the runtime directory and check
   the local environment.
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
connections. Model requests may consume credits or balance. The local
environment check does not verify live account access or billing. Cancellation
cannot reverse costs of requests already accepted by a provider.

## Data and Permissions

Media, subtitles, public metadata and sampled comments may be sent to the
selected provider. Public videos do not always need cookies; use only local
cookie files that you explicitly authorize. Never share keys, cookies, private
configuration or host connection descriptors in chat or issue reports.
This is a local native-plugin integration, not a sandbox for malicious plugins.

See the [plugin technical guide](../README.md) for installation commands,
compatibility and independent provider configuration. Project documentation and
the community tutorial are available through the related links on this page.
