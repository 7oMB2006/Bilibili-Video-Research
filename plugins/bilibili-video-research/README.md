# BVR for DFSC

资源版本 `0.2.0`，**通用宿主协议 v1 适配候选，尚未发布到市场**。
本版改的是 DFSC 启动、配置和账户调用链，不改变视频研究工具的用途。
StepAudio 不在本次迁移范围。

## 运行条件

- 需要支持 `dfsc.host.json`、通用模式设置和单次启动授权的 DFSC 构建。
  不能仅凭应用版本号判断兼容性，也不支持旧 BVR 专用桥。
- PATH 上须已有 Node.js 24+；宿主不自动安装 Node 或执行 npm/pip。
- BVR 本体仍在另一个项目目录运行，须显式更新到本候选，
  具有 `dfscHostApiVersion: 1` 标记并完成 `npm ci`。
  插件更新不会自动更新另一目录的 BVR 本体。
- 其他客户端直接启动 BVR 时仍沿用原有独立配置方式。

## 安装与本体路径

1. 在插件目录之外准备本候选的 BVR 本体，运行 `npm ci`、`npm run build`、
   `npm test`。build 是类型检查；启动使用已安装的 tsx，不现场安装依赖。
2. 将 `plugins/bilibili-video-research` 按 DFSC 市场规范安装。
   本候选需要隔离验收，不会因为源码存在就自动成为正式市场版本。
3. 运行下方命令，只登记本机运行环境：

```powershell
node "<PLUGIN>/server/configure.mjs" --profile "<DFSC数据目录>/step-runtime" --runtime "D:/Tools/Bilibili-Video-Research"
node "<PLUGIN>/server/start.mjs" --check
```

`<PLUGIN>` 是实际安装目录；所有路径须为本机绝对路径。
已有设置不覆盖，确实需要替换时先核对，再加 `--replace`。
检查只核对本体路径和依赖，不申请模型授权、不验证账户权益。

路径保存在 `step-runtime/bvr/config.json`：

```json
{
  "schemaVersion": 3,
  "runtimeDirectory": "D:/Tools/Bilibili-Video-Research"
}
```

新启动器仅复用旧 schema 1/2 文件中的 `runtimeDirectory`；
旧 `mode`、`hostAccess` 和 `envFile` 不会成为新模式、授权或独立 Key。
不要将秘密复制到上面的运行环境文件。

## 选择模式

进入「插件 → Bilibili Video Research → 配置」，显式选择模式并保存，
再重启需要使用 BVR 的会话。安装、启用 MCP、保存模式和 Full Access 都不是付费授权。
缺少新宿主上下文、旧本体或配置修订不匹配时拒绝启动，不自动切回旧桥。

### 跟随 DFSC 会话

- 使用实际调用会话已生效的官方 Step 账户、地区及 Plan/API 渠道。
  文本和视频跟随已应用模型，不使用尚未应用的预选值。
- 首次调用各项能力时由 DFSC 弹确认，提示插件、模型、地区、渠道、数据发送与额度消耗。
  拒绝后不反复弹窗，也不改用独立 Key 或其他计费渠道。
- 只持有绑定安装实例和单次启动的本地 bearer；不获得 Step Key、OAuth 或 Cookie。
  标准客户端消费启动环境后立即删除载荷，普通下载/FFmpeg 后代不继承该 bearer。
- 一次研究固定一个上下文 revision；ASR 与后续总结共用该修订。
  账户、模型、模式、配置或启动失效后，旧请求拒绝，须显式重启。
- 文本申请 `model.text`，视频申请 `model.video`，无字幕语音申请 `model.asr`。
  ASR 是专用能力，不冒充聊天模型；可用性由宿主逐项报告。
  本候选 Step adapter 的 ASR 路径为同地区/渠道的 `stepaudio-2.5-asr`。
- 媒体单次上限 23 MiB；通用视频输入仅支持 MP4/WebM，音频转换为 WAV。
  不支持的能力明确报错，不自动换模型、账户或渠道。
- MCP 取消传到宿主等待确认和进行中的请求；取消不能撤销已发生的提供商计费。

跟随模式**不读取独立设置快照或旧 provider.env**。
如需 Cookie 文件、下载目录、FFmpeg 或 HTTP 代理，可在上述本体路径文件中显式增加：

```json
{
  "schemaVersion": 3,
  "runtimeDirectory": "D:/Tools/Bilibili-Video-Research",
  "downloads": {
    "cookies_file": "D:/Private/BVR/cookies.txt",
    "download_directory": "D:/Temporary/BVR",
    "http_proxy": "http://127.0.0.1:7897",
    "prefer_captions": true
  }
}
```

仅配置实际需要的字段。可选 `ffmpeg_path` 必须是可执行文件绝对路径。
下载代理只用于下载链路，不承诺宿主模型请求也走它。
旧 envFile 中的下载选项不会自动迁移，需要用户明确核对并填写。

### 独立配置

配置页使用公开的 `dfsc.settings.json` / `json-file-v1` 协议，
与宿主模式 snapshot 绑定到同一已提交配置修订，不再由 BVR 专用表单或 CLI 写 Key。

- 主力模型：显式选择 StepFun/Gemini，填写自己的 Key 和模型名。
  StepFun 必须另填四种阶跃官方 API/Plan 根地址之一；Gemini 不使用 Step 地址。
- Step ASR：地址、Key、模型三项同时填写，绝不借用主力连接。
  三项全空时，Step 无字幕语音不可用；字幕或视频路径不受影响。
  Gemini 主力加独立 Step ASR 目前不支持，会明确报错。
- 下载设置属于此独立配置快照，不读取跟随模式的 downloads 或宿主账户。
- Key 使用受限秘密字段保存，不回显；保留、替换和删除由 DFSC 明确提交。
  旧私密文件保留在原处，不自动导入、覆盖或认领。
- DFSC 聊天切换账户不会让 BVR 变成跟随模式。
  独立配置改变后，旧进程会在下一次请求前拒绝继续使用旧 Key；
  ASR 与总结之间也重新检查。

模式失败、提供商失败或授权拒绝均不在两种模式之间自动回退。

## 使用、停用和更新

使用 `/bvr <公开视频链接> 研究问题`，或要求 Agent 调用 BVR。
MCP 标识仍为 `bilibili-video-research__bvr`，工具、技能和命令名称不变。
视频、音频、字幕及公开上下文可能发送给显式选择的提供商，消耗对应额度。
Cookie 仅使用用户授权的文件，不绕过付费、私密或登录权限。

MCP 开关只控制服务，不单独卸载技能或命令。卸载插件不会删除外部本体、
旧私密文件或运行环境设置。删除数据和重启日常应用须由用户单独确认。

本次包含协议/schema 变化，**不是可直接复用旧配置的一键升级承诺**。
宿主候选、BVR 本体、安装资源和旧安装迁移需组合验收后再固定 SHA 投稿市场。
正式上架后，检查市场和更新已安装副本仍是两件事。
旧宿主不得静默安装本候选后退回专用账户桥。

## 作者与验收

本资源直接维护在 BVR 原仓库，不要求另建 DFSC 专用仓库。
原生资源是 `step.plugin.json`，展示信息是 `dfsc.plugin.json`，
独立配置是 `dfsc.settings.json`，宿主能力是 `dfsc.host.json`。
`server/host-client/UPSTREAM.md` 记录标准客户端来源、固定提交及 MIT 许可。

运行候选互操作验收：

```powershell
npm run verify:dfsc-host -- --desktop-root "D:/Desktop For Step Code"
```

该命令需要通用 host v1 候选源码，运行真实 BVR MCP、FFmpeg、通用 broker 和
Step adapter，但提供商、账户和确认回调均为隔离 fixture。
它不证明生产原生 launcher、Electron 界面、真实账户权益或安装升级已验收。
不能把本地模拟结果写成正式上线或真实扣费验证。

插件同系统用户运行，不是恶意本地代码沙箱。
不要共享启动上下文、本地 bearer、Key、Cookie、用户日志或会话。
原插画图标保留，不表示 Bilibili、StepFun 或 DFSC 官方背书。
