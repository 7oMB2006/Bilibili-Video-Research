# Codex Video MCP

Video research tools for Codex. The current default backend is StepFun Step Plan with
`step-3.7-flash`; Gemini remains an optional provider. This server is not connected to
Xiaoxiu, chat history, or any recommendation workflow.

## Safety and data boundary

- Provider API keys must be supplied by the process environment; they are never stored
  by the server.
- Visual mode removes audio before upload but retains visible interfaces, code, charts,
  labels, and subtitles as frame evidence.
- `inspect_video_window` removes the audio track before upload and deletes its local
  temporary clip after Gemini has processed it.
- Provider media uploads or data URLs may leave the local machine. Do not use a free
  tier for sensitive research videos without accepting the provider's applicable data
  terms.

## Install

```powershell
cd D:\Codex_cul\codex-video-mcp
npm install
npm run build
```

Set the key only for the Codex MCP process, not globally in a checked-in file:

Copy `.env.example` to an untracked `.env`, then fill in one provider key. The current
default is StepFun Step Plan.

```toml
[mcp_servers.codex_video]
command = "D:\\Codex_cul\\codex-video-mcp\\node_modules\\.bin\\tsx.cmd"
args = ["D:\\Codex_cul\\codex-video-mcp\\src\\index.ts"]
startup_timeout_sec = 120

[mcp_servers.codex_video.env]
DOTENV_CONFIG_PATH = "D:\\Codex_cul\\codex-video-mcp\\.env"
```

Restart Codex after adding the server. Prefer a named environment variable in the
launcher or a secret manager over placing a real key in `config.toml`.

## Provider selection

StepFun is the current default provider. Set one provider key and restart Codex:

```powershell
# Gemini (optional)
setx GEMINI_API_KEY "your-key"

# StepFun video understanding
setx STEPFUN_API_KEY "your-key"
setx CODEX_VIDEO_PROVIDER "stepfun"
```

Set `CODEX_VIDEO_PROVIDER=gemini` to switch providers. For StepFun, choose the base
URL according to the account channel:

| Channel | Base URL | Use |
| --- | --- | --- |
| Official Open Platform API | `https://api.stepfun.com/v1` | Standard API billing/balance |
| Step Plan | `https://api.stepfun.com/step_plan/v1` | Step Plan subscription Credit |

官方参考：

- [step-3.7-flash 快速上手](https://platform.stepfun.com/docs/zh/guides/models/step-3.7-flash-quickstart)
- [视频理解最佳实践](https://platform.stepfun.com/docs/zh/guides/developer/video-chat)
- [Step Plan 接入参数](https://platform.stepfun.com/docs/zh/step-plan/quick-start)

The current project configuration uses Step Plan. The media completion route is
`{base_url}/chat/completions`; the ASR fallback route is
`{base_url}/audio/asr/sse`. Under Step Plan, this project sends video as a data URL.
Do not mix a key from one channel with the other channel's base URL; if you change the
channel, update `STEPFUN_BASE_URL` and restart the MCP process.

`step-3.7-flash` natively understands both images and videos through the Chat
Completions `video_url` content type; no separate vision model is required. MiniMax is
intentionally not selectable here because this project has not validated an official
video-input understanding route.

## Tools

- `analyze_video`: inspect a local video visually through an audio-free native video
  input. It is suitable for a full clip under the model's context limit.
- `inspect_video_window`: makes an audio-free temporary clip for a precise time range,
  then inspects only that window. This is the recommended path for long footage and
  behavioral research.
- `analyze_bilibili_video`: accepts a public `bilibili.com` or `b23.tv` URL and offers
  three modes: `language` (captions, then audio fallback), `vision` (silent video), and
  `multimodal` (original video). It includes public title and description and returns a
  `RESEARCH PROVENANCE` block identifying the actual language, visual, metadata,
  community, and timestamp sources. Caption cues retain their source timestamps when
  Bilibili provides them. Comments are sampled from the returned first page (at most 20
  root comments) and displayed as untrusted community context.

By default, the Bilibili downloader uses public access only and does not inspect
browser cookies. Restricted, paid, or login-only videos can fail rather than
bypassing access controls.

For a user-authorized logged-in Bilibili session, export that account's Bilibili
cookies as a local Netscape-format `cookies.txt` file and set its absolute path in
the untracked `.env` file:

```text
BILIBILI_COOKIES_FILE=D:\\AgentCredentials\\bilibili-cookies.txt
```

This is preferred over direct browser-cookie reading because Chrome and Edge can
lock their cookie database. The cookie file is read only for the download request;
do not paste its contents into chat, commit it, or put cookie values in `.env`.
`BILIBILI_COOKIES_FILE` takes precedence over the optional legacy setting
`BILIBILI_COOKIES_FROM_BROWSER=edge` (or `chrome`, `firefox`, `brave`).
