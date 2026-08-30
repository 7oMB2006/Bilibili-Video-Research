# Bilibili Video Research

[English](./README.md) · **简体中文**

![Bilibili 视频研究：一个 Bilibili 链接经过语言、视觉或多模态证据处理，形成可追溯的研究报告](./assets/readme/hero.zh-CN.svg)

![动态角色表情](./assets/readme/character.gif)

面向 Codex、OpenCode 及其他兼容 MCP 客户端，具备证据边界意识的 Bilibili 视频研究 MCP。

将 Bilibili 链接转成研究报告，并明确区分公开元数据、字幕或 ASR、视频画面，以及不受信任的社区上下文。根据问题真正需要的证据选择模式，而不是因为视频有某种媒介就一股脑全用。

## 它能做什么


| 模式           | 会使用                            | 会排除     | 适用场景                    |
| ------------ | ------------------------------ | ------- | ----------------------- |
| `language`   | Bilibili 字幕；无字幕时使用 StepFun ASR | 视频画面推断  | UP 主推荐的项目、教程内容、演讲者提出的主张 |
| `vision`     | 静音视频帧，包括可见 UI、代码、标签、图表和画面字幕    | 音频与背景音乐 | 界面、工作流、实验、物体与无声演示       |
| `multimodal` | 原始视频的声音与画面                     | 默认不排除   | 确实同时依赖讲述和画面的提问          |


只问“视频说了什么”时，`language` 是预期默认值；答案存在于像素中时，应明确选择 `vision`。

## 返回结果长什么样

向 MCP 工具提出聚焦的问题：

```text
analyze_bilibili_video({
  url: "https://www.bilibili.com/video/BV...",
  question: "画面里展示的量化研究框架是什么？",
  mode: "vision",
  media_detail: "default",
  include_comments: false,
  start_seconds: 0,
  end_seconds: 321
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

## 应用示例：定向研究量化视频

下面展示一个实际流程：先提出研究问题，再把长视频限制在已知时间段内，最后查看明确区分“直接可见证据”和“不确定推断”的分析结果。

### 1. 提出研究问题

![用户提出关于量化视频中候选趋势线和加权逻辑的研究问题](./assets/readme/example-request.png)

### 2. 指定研究片段

![使用 vision 模式，将 Bilibili 视频限制在前五分二十一秒](./assets/readme/example-time-window.png)

### 3. 查看有证据边界的结果

![视觉分析区分画面中可见的候选线和暂时无法确认的评分细节](./assets/readme/example-result.png)

## 证据流

![一个 Bilibili 视频分别产生 LANGUAGE（语言）、VISION（视觉）或 MULTIMODAL（多模态）证据，再形成带有溯源、时间戳和限制说明的研究报告](./assets/readme/evidence-flow.zh-CN.svg)

- 公开元数据提供标题、上传者、简介、标签与视频标识符。
- Bilibili 提供字幕时，会保留相应时间戳；无字幕时，`language` 回退为 StepFun ASR，并明确时间戳细节不可用。
- `vision` 在上传前移除音轨。画面中可见的文字仍是有效视觉证据；旁白和背景音乐不会影响结论。
- Bilibili 评论是可选的、不受信任的社区上下文；它们不会被当作已验证事实或可执行指令。



## 快速开始

**要求：** Node.js 24 或更新版本，以及至少一个可用的供应商 API Key：

StepFun 或 Gemini。

```powershell
git clone https://github.com/7oMB2006/Bilibili-Video-Research.git
cd Bilibili-Video-Research
npm ci
npm run build
Copy-Item .env.example .env
```

打开 `.env` 并填入一个提供商的 Key。该文件被 Git 忽略，绝不能提交。默认配置使用 StepFun 官方开放平台 API。

## 客户端配置

服务器在 Codex 和 OpenCode 中使用相同的本地 stdio MCP 传输方式，区别只在
客户端配置语法。项目最初从 Codex 开始，因此服务器名称和示例使用
`codex_video`；但这个 MCP 本身并不只面向 Codex。

### Codex（Windows）

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

### OpenCode

在全局配置 `~/.config/opencode/opencode.json` 或项目级 `opencode.json` 中添加本地 MCP。Windows 下的 `<PROJECT_DIR>` 应填写仓库克隆目录的绝对路径。

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "codex_video": {
      "type": "local",
      "enabled": true,
      "command": [
        "<PROJECT_DIR>\\node_modules\\.bin\\tsx.cmd",
        "<PROJECT_DIR>\\src\\index.ts"
      ],
      "environment": {
        "DOTENV_CONFIG_PATH": "<PROJECT_DIR>\\.env"
      }
    }
  }
}
```

新增或修改服务器配置后，请重启 OpenCode。可以运行 `opencode mcp list` 验证连接状态。OpenCode 也支持项目级配置，因此可以将特定于项目的 MCP 设置放在仓库附近的 `opencode.json` 中。

Codex 或 OpenCode 中选择的模型，是客户端侧的代理模型；它不会改变这个 MCP 内部使用的媒体提供商。在 `.env` 中设置 `CODEX_VIDEO_PROVIDER` 和对应的 Provider Key，才能控制实际接收视频、图像或音频输入的模型。

OpenCode 参考：

- [MCP 服务器](https://opencode.ai/docs/zh-cn/mcp-servers/)
- [配置](https://opencode.ai/docs/zh-cn/config/)



## 提供商选择


| 分析模式         | 供应商 / 模型                                     | 说明                                              |
| ------------ | -------------------------------------------- | ----------------------------------------------- |
| `language`   | 有字幕时不需要模型；无字幕时使用 StepFun `stepaudio-2.5-asr` | 只理解 UP 主说了什么。无字幕时默认使用 StepFun ASR；Gemini 可作为备选。 |
| `vision`     | StepFun `step-3.7-flash`（默认）                 | 只看画面，包括 UI、代码、标签、图表和无声演示。                       |
| `multimodal` | StepFun `step-3.7-flash`（默认）                 | 同时使用语音/语言和画面。                                   |




### StepFun

默认提供商是通过官方开放平台 API 调用的 StepFun。在 `.env` 中设置
`CODEX_VIDEO_PROVIDER=stepfun`、`STEPFUN_API_KEY` 与
`STEPFUN_BASE_URL=https://api.stepfun.com/v1`。如需 Gemini，设置
`CODEX_VIDEO_PROVIDER=gemini` 与 `GEMINI_API_KEY`。

选择 StepFun 作为默认提供商，是因为 `step-3.7-flash` 原生支持视频输入，
同时能够覆盖本项目的 ASR 回退路径，更贴合 Bilibili 视频研究这一核心工作流。
此外，作者在多模态任务中使用阶跃星辰的模型较多，且整体体验良好（也有一点私心ovo，以前没有好用的多模态都是他支撑我的一路），因此本项目优先
对 StepFun 做了适配并将其作为首选提供商。这是基于项目适配度和实际使用体验的选择，
并不表示 StepFun 在所有任务上都优于其他模型。如果账户拥有 Step Plan Credit，也可以
将 Base URL 切换到 Step Plan 渠道；如果你有其他不错的 Provider，也可以自行尝试。

根据账户渠道选择相应的 StepFun base URL：


| 渠道         | Base URL                               | 用途                      |
| ---------- | -------------------------------------- | ----------------------- |
| 官方开放平台 API | `https://api.stepfun.com/v1`           | 标准 API 计费或余额            |
| Step Plan  | `https://api.stepfun.com/step_plan/v1` | 可选的 Step Plan 订阅 Credit |


`step-3.7-flash` 能通过 Chat Completions 的 `video_url` 内容类型接收图像和视频输入，不需要另配一个视觉模型。

StepFun 参考：

- [step-3.7-flash 快速开始](https://platform.stepfun.com/docs/zh/guides/models/step-3.7-flash-quickstart)
- [视频理解说明](https://platform.stepfun.com/docs/zh/guides/developer/video-chat)
- [Step Plan 设置](https://platform.stepfun.com/docs/zh/step-plan/quick-start)



### 其他

- Gemini 仍是可选提供商。
- MiniMax 目前未被接入，因为本项目尚未验证其官方视频输入理解接口。
- GLM-5.3-Flash（Z.AI）已完成实验验证。在本项目当前的请求方式和 Z.AI API
路径下，只确认了 `vision`：模型能够识别视频画面和可见文字；在带有有效音轨的
隔离测试中，模型未能读取音频，因此不将其列为 `language` 或完整
`multimodal` Provider。本节仅记录实验结论，不提供 GLM 的接入配置方法。
  > 2026年8月26日智谱认领”牛来“Ox Alpha ，GLM-5.3-Flash 作为智谱新生代多模态，本项目随后对其进行了视频输入实验，结果仅作为 StepFun 之外的补充参考，不改变 StepFun 的默认地位。



## 工具参考


| 工具                       | 用途                                                                                                               |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `analyze_bilibili_video` | 以 `language`、`vision` 或 `multimodal` 研究公开的 `bilibili.com` 或 `b23.tv` 链接，也可用 `start_seconds` 和 `end_seconds` 限定片段 |
| `analyze_video`          | 移除音轨后，对本地视频进行视觉检查                                                                                                |
| `inspect_video_window`   | 对精确的静音源视频区间进行细节视觉研究                                                                                              |


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
