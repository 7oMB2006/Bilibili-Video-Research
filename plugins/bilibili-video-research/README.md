# BVR for DFSC

这是 Bilibili Video Research 的 DFSC 配套插件，资源版本 `0.1.1`。
提供 BVR MCP 启动声明、视频研究技能、`/bvr` 提示命令和图标。

本插件不是 BVR 服务端的一键安装器。它不自动下载 Node.js、安装 npm 依赖、
读取 DFSC 登录凭据；MCP 本体仍在自己的项目目录运行。
需要支持插件相对工作目录的 DFSC 宿主、PATH 上的 Node.js 24+、
已完成 `npm ci` 的 BVR checkout（包括 tsx 开发依赖）。
默认跟随 DFSC 的账户、渠道和会话模型，需要包含 BVR 宿主桥的新构建；
不支持宿主桥的旧版本仅能使用显式的独立模式。插件发现/安装的验证基线为
DFSC main `fb4828b`，不表示该基线已经具有宿主桥。
早期已发布安装包尚未验证，不能仅凭 `0.6.0` 版本号判断兼容性。
其他客户端继续使用原有 MCP 配置，不受此插件影响。

## 安装和配置

1. 在插件目录之外准备 BVR 本体，按项目根 README 运行 `npm ci`、
   `npm run build` 和 `npm test`。当前 build 是类型检查，不生成 dist。
   运行时使用已安装的 tsx 加载源码，不在启动时执行 npm install。
2. 从 DFSC 市场安装本插件。也可以先将本项目 `plugins/bilibili-video-research`
   作为一个本地市场条目进行隔离验收；仅将 GitHub 项目 URL 填入插件列表
   不会自动生成可安装资源。本插件尚未因存在于 BVR 仓库而自动收录。
3. 在 DFSC 中完成账户登录，选择此会话要使用的 Step 模型。
   跟随模式不需要另外填写 Key。第一次请求模型时，DFSC 会确认账户渠道、
   地区和模型，并说明会消耗该账户额度；拒绝后不会改走其他渠道。
4. 找到 DFSC 数据目录里的 `step-runtime`，运行下方配置命令。
   `<PLUGIN>` 是已经安装的插件目录，通常是
   `<DFSC数据目录>/step-runtime/plugins/bilibili-video-research`。

```powershell
node "<PLUGIN>/server/configure.mjs" --profile "<DFSC数据目录>/step-runtime" --runtime "D:/Tools/Bilibili-Video-Research"
node "<PLUGIN>/server/start.mjs" --check
```

所有参数都要替换为本机绝对路径。`--profile` 指向 `step-runtime`，不是其
上一级数据目录，也不是插件目录。已有配置不会被覆盖；核对后可用 `--replace`。
检查命令只验证本地配置和依赖，不调用提供商，不验证 Key 的有效性或额度。

配置保存在 `<DFSC数据目录>/step-runtime/bvr/config.json`，记录 BVR 本体路径、
模式和宿主请求需确认的选择。它不在插件目录内，卸载重装不会删除该配置或私密文件。
新建会话或按 DFSC 提示重启会话，让 MCP、技能和 `/bvr` 重新加载。

### DFSC 插件中心配置

包含插件中心的新构建可以直接在「插件 → Bilibili Video Research → 配置」
选择本体目录、跟随模式或独立模式，无需手写配置文件。本体需要
`dfscConfigurationVersion: 1` 标记和完整依赖；检查环境不验证账户或请求模型。

独立模式下，主力模型与 ASR 各自填写接口地址、API Key 和模型名；
两组连接互不借用。已保存的 Key 不回显，留空保留，输入新值替换。
当前表单仅支持阶跃官方地址及 Step ASR 协议；Gemini 等已有独立配置保留，
不会被表单自动改写，继续通过配置命令维护。

保存后手动重启需要使用新配置的会话。配置或私密环境文件变化后，
旧插件进程会在下一次模型请求前拒绝继续运行，ASR 与总结之间也会重新检查；
不会因为未重启而继续使用旧的直调 Key。在途请求已经发生的计费不能撤销。
通过其他客户端直接启动的 BVR 不受此 DFSC 启动检查影响。

高级设置支持 Cookie 文件、临时下载目录、下载 HTTP 代理和优先字幕。
每次研究在指定下载根目录下分配独立临时目录并沿用现有清理逻辑。
下载代理显式传给 yt-dlp 的探测与下载，不承诺模型请求也经过该代理。

## 跟随模式

- DFSC 在主进程代发请求，不向 BVR 导出账户 Key、登录 Cookie 或凭据文件。
  仅有当前应用实例的本地受限连接凭证；它不是 Step API Key。
- MCP 声明中的 `STEPFUN_API_KEY=bvr-managed-provider-context` 是非密钥占位值，
  用于阻止上游给启动器自动补入宿主 Key；启动器不会将它用于模型请求。
- 使用已生效的账户与会话模型，不使用尚未登录成功的选择、其他会话模型
  或旧 `.env` 内的 Key/地址。国内/海外的 API、Plan 地址分别配对，不回退。
- 一次研究固定一个上下文版本；账户、渠道、模型、会话或进程变化后，
  旧请求失效。在途请求取消，已发送的请求可能已经消耗额度，无法撤销计费。
- 文本使用当前模型；视频接受 BVR 稳定模型 `step-3.7-flash`、已有兼容记录的
  `step-5-preview`，或宿主明确声明支持 video 的模型。不支持则要求用户选择，
  不自动改模型。兼容记录不等于所有地区、套餐的质量保证。
- 无字幕音频转写与聊天模型不是同一能力：Plan 和 API 渠道均使用
  `stepaudio-2.5-asr` 专用模型，沿用当前账户、地区及渠道的 ASR 端点；
  转写后的总结使用当前会话模型。失败会明确报错，不自动切换为直调 API。
  本次本地验证不代表已复测真实账户的可用性或计费。
- 单次媒体上限 23 MiB；较大视频请指定较短区间。
- 可选 `--env-file` 在跟随模式下只读取 Bilibili Cookie 路径、FFmpeg 和代理
  等本地下载设置，忽略提供商密钥、地址和模型，且不加载 BVR 目录的 `.env`。
- 原生确认按当前会话/账户/模型授权，不根据插件名称自动授信。
  这是同一系统用户下的本地集成，不是恶意本地可执行插件的文件系统沙箱；
  不要安装不可信插件或共享 `bvr/host.json`。

## 独立模式

其他提供商、媒体专用模型或旧版 DFSC 可选择独立配置，不自动降级进入此模式。
将 `provider.example` 放到插件外的私密位置并填写自己的提供商、Key 和渠道地址：

```powershell
node "<PLUGIN>/server/configure.mjs" --profile "<DFSC数据目录>/step-runtime" --runtime "D:/Tools/Bilibili-Video-Research" --mode independent --env-file "D:/Private/BVR/provider.env" --replace
```

原有 schemaVersion 1 配置继续保持独立模式，不会升级后自动改用 DFSC 账户。

- 必须在私密文件中明确设置 `CODEX_VIDEO_PROVIDER`。
- StepFun 必须同时显式设置 `STEPFUN_API_KEY` 和 `STEPFUN_BASE_URL`：
  官方 API 用 `https://api.stepfun.com/v1`，Plan 用
  `https://api.stepfun.com/step_plan/v1`；海外使用对应的 `api.stepfun.ai` 地址。
  本适配器暂不接受其他地址。
- Gemini 必须显式选择并提供自己的 Key。缺失配置时拒绝启动，不静默回退。
- ASR 可单独设置 `STEPFUN_ASR_BASE_URL`、`STEPFUN_ASR_API_KEY` 和
  `STEPFUN_ASR_MODEL`。前两者只设置一项会报错，不回退到主力连接；
  都不设置时，保留旧版共用主力地址与 Key 的行为。插件中心始终写入两组独立连接。
- 启动器只继承基础系统环境；DFSC 传入的 Step Key、其他客户端密钥、
  Node 注入选项等不会透传给 BVR。BVR 重新加载 dotenv 时也只读取指定的私密文件。
- **独立模式下，DFSC 当前聊天切换 API/Plan 不会修改 BVR 的独立配置。**
  需要使用与目标渠道匹配的凭据；本地检查不能证明实际按哪种额度扣费。
- 工具会联网访问 Bilibili，下载临时媒体，并可能把媒体、字幕、公开元数据
  和采样评论发送给所选提供商，消耗该提供商的余额或额度。
- Cookie 可选，仅使用用户明确授权的本地文件。不能绕过付费、私密或登录权限。
  可选路径建议使用绝对路径；临时文件由 BVR 现有逻辑处理。

## 使用、停用和更新

示例：`/bvr <公开视频链接> 总结讲述内容，并区分证据与推断`。
也可以直接要求 Agent 使用 BVR 分析链接；技能不保证在每个任务中自动触发。
本插件的 MCP 标识为 `bilibili-video-research__bvr`。

停用 MCP 可在插件列表直接使用服务开关，也可在 MCP 管理页操作。
服务开关不单独卸载技能或命令。卸载插件会移除技能、命令和 MCP 声明；
按提示重新加载会话。它不会卸载外部 BVR、删除私密配置或停止其他客户端的 BVR。
若需彻底清理，由用户单独删除自己创建的 `bvr/config.json` 和私密文件。

更新市场不等于升级已安装的插件。本版本遵循 DFSC 当前的卸载后重装流程。
BVR 本体在自己的目录中更新；更新后重新执行本地检查并验证兼容性。

## 投稿

在 BVR 仓库中审核并提交本资源目录后，向 `dfsc-community-plugins` 提收录 PR：
来源路径为 `plugins/bilibili-video-research`，锁定完整的上游提交 SHA。
市场维护者同步资源副本、记录哈希并运行市场校验和安装验收。
不要把 `node_modules`、私密环境文件、Cookie、日志或用户会话一起收录。
收录来源应包含本目录许可证；`0.1.1` 的插件图标采用维护者提供的插画，
替换旧版 Bilibili 标识，并将画面外侧白边处理为透明；不改变 MCP 或配置协议，
不表示 Bilibili、StepFun 或 DFSC 官方背书。
