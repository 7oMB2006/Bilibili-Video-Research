# Bilibili Video Research

<p align="right">
  <a href="./README.md">English</a> · <strong>简体中文</strong>
</p>

<p align="center">
  <img src="./assets/readme/hero.png" width="100%" alt="Bilibili Video Research：一个 Bilibili 链接经过语言、视觉或多模态证据处理，形成可追溯的研究报告">
</p>

<p align="center">
  <img src="./assets/readme/character.gif" width="160" alt="动态角色表情">
</p>

<p align="center">
  面向 Codex、具备证据边界意识的 Bilibili 视频研究 MCP。
</p>

将 Bilibili 链接转成研究报告，并明确区分公开元数据、字幕或 ASR、视频画面，以及不受信任的社区上下文。根据问题真正需要的证据选择模式，而不是因为视频有某种媒介就一股脑全用。对于长视频，还可以指定源视频的起止时间，只研究选定片段而不是整段录音。

## 它能做什么

| 模式 | 会使用 | 会排除 | 适用场景 |
| --- | --- | --- | --- |
| `language` | Bilibili 字幕；无字幕时使用 StepFun ASR | 视频画面推断 | UP 主推荐的项目、教程内容、演讲者提出的主张 |
| `vision` | 静音视频帧，包括可见 UI、代码、标签、图表和画面字幕 | 音频与背景音乐 | 界面、工作流、实验、物体与无声演示 |
| `multimodal` | 原始视频的声音与画面 | 默认不排除 | 确实同时依赖讲述和画面的提问 |

只问“视频说了什么”时，`language` 是预期默认值；答案存在于像素中时，应明确选择 `vision`。

## 返回结果长什么样

向 MCP 工具提出聚焦的问题：

```text
analyze_bilibili_video({
  url: "https://www.bilibili.com/video/BV...",
  question: "画面里展示的量化研究框架是什么？",
  mode: "vision",
  media_detail: "default",
  include_comments: false
})
```

响应会先给出溯源信息，再给出自然语言分析：

```text
RESEARCH PROVENANCE
{
  "mode": "language",
  "metadata": "bilibili_api",
  "language": "stepfun_asr",
  "visual": "none",
  "community": "disabled",
  "timestamps": "none"
}

ANALYSIS
...直接结论、证据限制与不确定性说明...
```

这很重要：从语音中听到的仓库名、从界面中辨认出的框架、热门评论中的断言，不是同一类来源，不能被写成同等可信的事实。

## 证据流

<p align="center">
  <img src="./assets/readme/evidence-flow.svg" width="100%" alt="一个 Bilibili 视频分别产生语言、视觉或多模态证据，再形成带有溯源、时间戳和限制说明的研究报告">
</p>

- 公开元数据提供标题、上传者、简介、标签与视频标识符。
- Bilibili 提供字幕时，会保留相应时间戳；无字幕时，`language` 回退为 StepFun ASR，并明确时间戳细节不可用。
- `vision` 在上传前移除音轨。画面中可见的文字仍是有效视觉证据；旁白和背景音乐不会影响结论。
- Bilibili 评论是可选的、不受信任的社区上下文；它们不会被当作已验证事实或可执行指令。

## 快速开始

**要求：** Node.js 24 或更新版本、StepFun 或 Gemini API Key，以及支持本地 MCP 的 Codex desktop。

```powershell
git clone https://github.com/7oMB2006/Bilibili-Video-Research.git
cd Bilibili-Video-Research
npm ci
npm run build
Copy-Item .env.example .env
```

打开 `.env` 并填入一个提供商的 Key。该文件被 Git 忽略，绝不能提交。默认配置使用 StepFun Step Plan。

## Codex MCP 配置（Windows）

在 `%USERPROFILE%\.codex\config.toml` 中，将下方每个 `<PROJECT_DIR>` 替换为仓库克隆目录的绝对路径，例如 `C:\Users\you\projects\Bilibili-Video-Research`。

```toml
[mcp_servers.codex_video]
command = "<PROJECT_DIR>\\node_modules\\.bin\\tsx.cmd"
args = ["<PROJECT_DIR>\\src\\index.ts"]
startup_timeout_sec = 120

[mcp_servers.codex_video.env]
DOTENV_CONFIG_PATH = "<PROJECT_DIR>\\.env"
```

新增或修改服务器配置后，请重启 Codex。Key 请保存在 `.env` 或密钥管理器里，不要写入 `config.toml`。

## 提供商选择

默认提供商是 StepFun Step Plan。在 `.env` 中设置 `CODEX_VIDEO_PROVIDER=stepfun`、`STEPFUN_API_KEY` 与 `STEPFUN_BASE_URL`。如需 Gemini，设置 `CODEX_VIDEO_PROVIDER=gemini` 与 `GEMINI_API_KEY`。

根据账户渠道选择相应的 StepFun base URL：

| 渠道 | Base URL | 用途 |
| --- | --- | --- |
| 官方开放平台 API | `https://api.stepfun.com/v1` | 标准 API 计费或余额 |
| Step Plan | `https://api.stepfun.com/step_plan/v1` | Step Plan 订阅 Credit |

媒体理解的 completion 路径是 `{base_url}/chat/completions`；ASR 回退路径是 `{base_url}/audio/asr/sse`。不要混用不同渠道的 Key 和 Base URL；变更提供商配置后重启 MCP 进程。

`step-3.7-flash` 能通过 Chat Completions 的 `video_url` 内容类型接收图像和视频输入，不需要另配一个视觉模型。Gemini 仍是可选提供商。MiniMax 目前未被接入，因为本项目尚未验证其官方视频输入理解接口。

StepFun 参考：

- [step-3.7-flash 快速开始](https://platform.stepfun.com/docs/zh/guides/models/step-3.7-flash-quickstart)
- [视频理解说明](https://platform.stepfun.com/docs/zh/guides/developer/video-chat)
- [Step Plan 设置](https://platform.stepfun.com/docs/zh/step-plan/quick-start)

## 工具参考

| 工具 | 用途 |
| --- | --- |
| `analyze_bilibili_video` | 以 `language`、`vision` 或 `multimodal` 研究公开的 `bilibili.com` 或 `b23.tv` 链接，也可用 `start_seconds` 和 `end_seconds` 限定片段 |
| `analyze_video` | 移除音轨后，对本地视频进行视觉检查 |
| `inspect_video_window` | 对精确的静音源视频区间进行细节视觉研究 |

长视频先粗看时使用 `media_detail: "low"`；需要辨认小型 UI 文本、代码、动作或近距离细节时用 `"default"`。

如果已经知道要研究的时间段，可以同时传入 `start_seconds` 和 `end_seconds`。有字幕时会先筛选对应字幕区间；音频、视觉和多模态分析则会对下载后的视频先裁剪。显式指定片段后，会跳过长视频的自动粗扫流程。

## 数据与访问边界

- 提供商 API Key 只保留在本地进程环境中；服务器不会存储它们。
- 提供商的视频上传或 data URL 可能离开本机。对敏感视频，请先审阅对应提供商的条款。
- 先尝试公开 Bilibili 访问。受限、付费或登录门槛视频可能失败；本项目不绕过访问控制。
- 如需使用用户明确授权的已登录 Bilibili 账户，可将 `BILIBILI_COOKIES_FILE` 指向本地 Netscape 格式 cookie 文件。不要提交它，也不要将内容粘贴到聊天中：

```text
BILIBILI_COOKIES_FILE=/absolute/path/to/cookies.txt
```

`BILIBILI_COOKIES_FILE` 优先于可选的旧设置 `BILIBILI_COOKIES_FROM_BROWSER=edge`（也可以是 `chrome`、`firefox`、`brave`）。直接读取浏览器 cookie 可能因数据库被锁定而失败。

## 许可证

[MIT](./LICENSE)