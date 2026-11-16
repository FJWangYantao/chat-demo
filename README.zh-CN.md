# chat-demo

[English](README.md) | 简体中文

支持 DeepSeek 原生接口与 pi 多服务商的聊天应用。DeepSeek 原生通道可作为静态页面运行；pi Provider、pi Agent、GitHub OAuth 和微信扫码连接使用随项目提供的 Node 服务。

点击 [在线体验](https://deepseek-ai.github.io/chat-demo/) 即可使用，也可以前往 [Releases](https://github.com/deepseek-ai/deepseek-chat-demo/releases) 下载压缩包，解压后双击 `index.html` 在本地使用，无需安装或构建。首次使用时，请在设置中填写 API Key。

## 运行

准备 Node.js 22.21+ 和 pnpm：

```sh
git clone https://github.com/deepseek-ai/chat-demo.git
cd chat-demo
pnpm install
pnpm dev
```

打开 http://localhost:8090 。

`pnpm dev` 和 `pnpm start` 会使用 `HTTP_PROXY`、`HTTPS_PROXY`、`NO_PROXY` 环境变量。需要代理访问 GitHub 时，请在启动前设置代理，并在 `NO_PROXY` 中排除 `localhost,127.0.0.1,::1`；只开启浏览器或系统代理不代表 Node 请求也会使用代理。

生成静态产物：

```sh
pnpm build
```

产物位于 `dist/`，可部署到静态服务器，也可直接打开 `dist/index.html`。直接打开时，浏览器和 API 服务需允许 `file://` 页面的存储与跨域请求。

## 功能

- 多会话、首条消息并行生成标题、重命名与删除；自动标题可在通用设置关闭，关闭后显示“新会话”；编辑提问、重新生成和切换消息分支。
- 流式回答、深度思考、DeepSeek/Tavily 独立搜索、网页抓取与统一来源引用；支持停止和符合条件的继续生成。
- 附件上传、粘贴与拖拽，语音输入和回复朗读；移动端录音时输入框首行显示实时频谱。
- Markdown、代码高亮、KaTeX 公式和 Mermaid 图表。
- 简体中文与英文、浅色与深色主题、移动端布局、位置设置、历史导入导出。
- 连接 GitHub，让 AI 查询仓库、Issue 和文件；创建 Issue 前在聊天中确认仓库、标题和正文。
- 通过腾讯 OpenClaw 微信 iLink 通道扫码绑定微信 ClawBot，在微信中与 AI 文字对话，支持 PIN 验证、独立上下文与本地恢复。
- 连接 Magpie 桌面端，自动读取本地模型与路由组。
- 使用 BlueFatFish 静态插画，在支持的环境中自动启动 3D 伙伴；减少动态、`file://` 和 WebGL2 失败时保留静态回退。

## 模型与服务商

点击输入框上方的模型名称，或打开设置 → 模型与服务商。选择服务商、模型 ID，填入其 API Key，再点击“保存并使用”。每个服务商的配置分别保存在本机浏览器中；切换影响新回复，已开始的回复和工具轮次继续使用原配置，续写沿用原回复的模型。

多服务商使用官方 `@earendil-works/pi-ai`，模型与能力目录随该依赖版本提供。当前目录包含 OpenAI、Anthropic、Google Gemini、OpenRouter、DeepSeek、Kimi、Moonshot、MiniMax、Z.AI 等 API Key 服务商。模型 ID 既可从列表中选择，也可直接输入；订阅 OAuth、AWS/Vertex 云身份等登录流程不在本界面中配置。

中转服务或本地 Ollama、LM Studio 可选择“自定义兼容接口”，填写模型 ID 和 Base URL，例如 `http://localhost:11434/v1`，再选择 OpenAI Chat Completions、OpenAI Responses、Anthropic Messages 或 Google Generative AI 协议。本地无鉴权接口可留空 API Key；远程地址使用 HTTPS。API Key 不会成为模型输入或写入聊天记录、历史 ZIP。

使用 [yetone/magpie](https://github.com/yetone/magpie) 桌面端时，打开设置 → 连接应用 → Magpie 后会自动检测，再次进入页面或窗口重新聚焦时也会刷新目录，仍可手动点击“刷新模型”或“重新连接”。需要 Magpie 正在运行并监听默认地址 `127.0.0.1:3425`，且本应用通过 `pnpm dev` 或 `pnpm start` 在本机运行。应用服务只请求 Magpie 的 `/v1/models`，不会读取其上游 API Key、订阅凭据或管理接口。远程应用服务和纯静态页面不提供此检测功能。

检测成功后，选择或直接输入 `provider/model`、`group/...`，再点击“保存并使用”。模型显示名、思考和图片能力来自 Magpie 目录；未列入目录的模型可在“模型与服务商”中手动调整能力。刷新失败会保留上次成功读取的目录并禁用保存；已保存模型从最新目录消失时仅显示警告，不会自动替换模型或改写配置。Magpie 使用独立服务商配置，不会覆盖“自定义兼容接口”；聊天、流式输出与 Agent 工具调用继续通过现有 pi 通道。

pi 通道使用 `@earendil-works/pi-agent-core` 管理模型与工具之间的自动循环。现有 GitHub 工具和聊天时间线继续工作：独立读取最多并行 50 个，创建 Issue 逐项确认、按顺序执行，停止会取消正在执行及排队的任务。每次回复最多 8 个工具轮次；GitHub 累计 400 次调用，搜索与抓取另计 12 次上限。每条回复保存服务商及模型快照，并保留 pi 原始消息以恢复后续工具上下文。

pi 支持模型允许的图片输入及文本、代码附件；单个文本附件上限为 1 MiB。PDF、Office 文档解析与语音仍由 DeepSeek 原生通道提供；语音使用设置 → 数据管理中的 DeepSeek API Key。图片、思考和工具调用能力以服务商实际权限为准；自定义模型可关闭工具调用，改用先检索后回答。

多服务商与 Agent 需要 `pnpm dev`，或构建后运行 `pnpm start`，由同一服务提供 `/api/ai/` 接口。纯静态部署和 `file://` 使用 DeepSeek 原生通道。生产反向代理请关闭 SSE 响应缓冲，并将 `APP_ORIGIN` 设置为浏览器访问的 HTTPS 站点源。

## 搜索服务

打开设置 → 搜索服务，可选择 DeepSeek Search / Fetch 或 Tavily Search / Extract。检测到数据管理中已有 DeepSeek API Key 时，选择 DeepSeek 即可直接复用，无需再次填写或额外保存，也可切换为独立搜索 Key；Tavily 需要单独填写 Key。Base URL 和每次搜索数量（默认 8、最多 10）按服务商分别保存。搜索引擎不会随聊天服务商切换而自动改变，pi 用户必须主动选择并配置后才会产生搜索请求。

开启智能搜索后，新回复保存不含 Token 的搜索引擎、数量和模式快照，重新生成与重试沿用该快照。支持工具调用的模型通过统一 `web_search` / `web_fetch` 工具自主搜索和阅读；关闭自定义模型的工具调用能力后，应用会先压缩超长问题、执行一次真实检索，再让模型回答。搜索失败作为工具状态展示，不伪装成成功来源。

搜索与抓取最多并行 4 个，每轮最多 4 次、每条回复合计最多 12 次；与 GitHub 的 400 次上限独立。来源在整条回复中按 `S1、S2…` 编号，同一 URL 去重，正文只将真实编号转换为引用角标。后续提问只回传被引用来源的标题、URL 和摘要，未引用结果与抓取全文仍保留在本机用于展示。历史 ZIP 不提升格式版本：独立搜索映射为 `TOOL_SEARCH`，网页抓取映射为 `TOOL_OPEN`，导入后作为只读历史展示。

独立搜索由应用服务提供 `/api/search/search` 与 `/api/search/fetch`，需要 `pnpm dev` 或构建后的 `pnpm start`。服务校验同源请求、输入和上游响应，限制大小与超时，408、429 和 5xx 最多退避重试一次，停止生成会中止上游请求。DeepSeek 和 Tavily 可能分别按请求或额度计费。

搜索 Key 仅保存在本机浏览器 localStorage，随请求发送给本应用服务；不会写入会话快照或历史 ZIP，服务端也不保存。`file://` 和纯静态部署不调用独立搜索接口，DeepSeek 原生聊天继续显示并使用原有的内置搜索兼容路径；其他聊天服务商和 Tavily 不能在静态模式下使用独立搜索。

## 连接 GitHub

点击侧栏左上角的 Connector，或打开设置 → 连接应用，再点击 GitHub 卡片管理连接。卡片显示“已安装”（未在对话中启用）、“未登录”或“已连接”。详情支持同时保存多个 GitHub 账号或令牌连接、修改连接名称、替换令牌、重新授权和单独断开，并选择一个默认连接供对话使用；新增连接不会替换已有连接。配置了 OAuth 服务后，“登录 GitHub 并授权”会另开标签页选择账号，原页面显示等待动画并查询授权进度。回调校验授权参数后立即返回可关闭的页面，服务端在后台交换令牌并读取账号信息，连接结果只在原页面显示。完成页通过 BroadcastChannel 立即通知原页面开始查询；通知不可用或未送达时仍以轮询兜底。授权标签页尝试自动关闭；可在原页面取消等待，最长等待 10 分钟。取消、拒绝、失败或超时均会结束等待，并保留已有连接。默认请求 `read:user public_repo` 权限；勾选访问私有仓库后请求 `read:user repo`，具体授权范围以 GitHub 授权页为准。

若使用纯静态部署，可展开“使用 Personal Access Token 连接”。建议创建细粒度令牌，仅授权需要的仓库，授予 Contents 只读权限，以及 Issues 只读或读写权限；创建 Issue 需要写权限，组织仓库可能还需要组织批准。

### 配置 GitHub 授权回调

1. 前往 [GitHub OAuth Apps](https://github.com/settings/applications/new) 注册应用。本地 Homepage URL 填 `http://localhost:8090`，Authorization callback URL 填 `http://localhost:8090/auth/github/callback`。
2. 将获得的 Client ID 和 Client Secret 设置在服务器进程的环境变量中。服务不会自动加载 `.env` 文件。Windows PowerShell 示例：

   ```powershell
   $env:GITHUB_CLIENT_ID="你的 Client ID"
   $env:GITHUB_CLIENT_SECRET="你的 Client Secret"
   $env:APP_ORIGIN="http://localhost:8090"
   pnpm dev
   ```

3. 浏览器打开与 `APP_ORIGIN` 完全一致的地址，再点击 GitHub 登录。配置变化后需重启服务。
4. 生产环境执行 `pnpm build` 后运行 `pnpm start`，由 Node 服务同时提供 `dist/`、授权回调和 GitHub API 代理。使用 HTTPS 域名作为 `APP_ORIGIN`，并在 GitHub 中登记对应的 `/auth/github/callback`；反向代理需保留原始 Host。`HOST`、`PORT` 默认分别为 `127.0.0.1`、`8090`。

OAuth 的 Client Secret 和访问令牌仅由服务器持有，不会写入前端构建或浏览器存储。登录使用一次性 `state`、PKCE 和 HttpOnly / SameSite=Lax 会话 Cookie；HTTPS 下同时启用 Secure。会话保存在单个 Node 进程内存中，最长 8 小时，重启或过期后重新登录；当前不实现刷新令牌或多实例共享会话。断开连接只移除选中的服务器连接，其他账号保持连接；如需撤销 GitHub 应用授权，可前往 GitHub 设置操作。OAuth 登录需要 HTTP 服务，GitHub Pages 或 `file://` 打开方式仍使用令牌连接。

连接后可发送“查看 deepseek-ai/chat-demo 仓库的信息和最近的 Issue”或“读取这个仓库的 README.md”。同一轮互不依赖的读取最多并行执行 50 个，超出部分自动排队，结果按模型调用顺序回传；依赖前一步结果的读取仍分轮进行。每次回复最多执行 8 轮、累计 400 次应用工具调用。创建 Issue 按调用顺序逐项确认和执行：执行前等待前面的读取完成，后续读取等待本次写入结束。应用会展示完整参数，点击“确认创建 Issue”后才会发送请求；拒绝或停止生成不会自动重试。若请求中断或超时，请先到 GitHub 检查是否已创建，避免重复发布。

手动输入的令牌仅保存在当前标签页的 sessionStorage 中，刷新后可复用；断开连接会清除选中连接的令牌并取消其请求，其他连接保留。切换默认连接或停用应用会中断当前工具调用和待确认写入；断开默认连接后不会自动切换到其他账号。浏览器恢复标签页时可能恢复会话存储，若不希望保留连接请主动断开。令牌只发给 GitHub，不作为模型输入；查询结果会提交给 AI 服务并保存在本地对话中，可能包含私有仓库内容。历史 ZIP 保留回答正文，但不保留应用工具调用及原始结果。

## 连接微信 ClawBot

打开设置 → 连接应用 → 微信，点击“扫码连接微信”，使用微信扫描页面中的二维码并在手机上确认。连接流程复用 [Tencent/openclaw-weixin](https://github.com/Tencent/openclaw-weixin) 2.4.10 的 iLink 协议层，不需要安装整套 OpenClaw，也不需要微信开放平台 AppID / AppSecret 或公网回调地址；应用服务需要能够访问 `https://ilinkai.weixin.qq.com`。支持扫码状态、二维码过期刷新、手机数字 PIN 验证、取消和重新连接。

绑定后，服务端通过长轮询接收新消息并自动回复。**支持文字和语音转文字；暂不支持图片、文件、视频、群聊或网页对话同步，也不会调用 GitHub、搜索或本地文件工具。** 每个微信联系人拥有独立上下文，最多保留最近 12 轮对话；发送 `/clear` 或 `/new` 可清空当前微信会话。长回复会分段发送，服务重启后恢复游标并跳过近期已处理消息；极端中断仍不能保证完全避免重复回复。

### 配置微信 AI

微信后台任务无法读取浏览器中的 API Key，需要在服务端环境变量中单独配置。Windows PowerShell 示例：

```powershell
$env:WECHAT_AI_API_KEY="你的 DeepSeek API Key"
$env:WECHAT_AI_PROVIDER="deepseek"
$env:WECHAT_AI_MODEL="deepseek-flash"
pnpm dev
```

`WECHAT_AI_PROVIDER` 和 `WECHAT_AI_MODEL` 的默认值分别是 `deepseek` 和 `deepseek-flash`。可选用 `WECHAT_AI_BASE_URL` 覆盖接口地址、`WECHAT_AI_REASONING=1` 开启思考、`WECHAT_AI_MAX_TOKENS` 调整回复上限（默认 2048）、`WECHAT_AI_SYSTEM_PROMPT` 自定义系统提示词。

自定义 OpenAI 兼容接口示例：

```powershell
$env:WECHAT_AI_PROVIDER="custom"
$env:WECHAT_AI_MODEL="你的模型 ID"
$env:WECHAT_AI_BASE_URL="https://你的服务地址/v1"
$env:WECHAT_AI_API="openai-completions"
$env:WECHAT_AI_API_KEY="你的 API Key"
pnpm dev
```

`WECHAT_AI_API` 可为 `openai-completions`、`openai-responses`、`anthropic-messages` 或 `google-generative-ai`。无鉴权的本地自定义服务可将 `WECHAT_AI_API_KEY` 设为 `local`。配置变更后需重启服务。微信消息会提交给所配置的模型服务商，计费与数据保留规则由该服务商决定。

默认只响应扫码绑定的微信用户。若允许其他联系人使用，将 `WECHAT_ALLOW_FROM` 设为逗号分隔的微信用户 ID；该名单会替代默认本人限制，如需保留本人权限请同时加入扫码人的 ID。设为 `*` 会允许所有私聊联系人触发模型并消耗额度，请谨慎使用。未配置白名单且登录响应没有用户 ID 时，不会响应任何消息。

### 运行与存储

此功能需要 `pnpm dev` 或构建后的 `pnpm start`，纯静态部署和 `file://` 不可用，且**服务必须保持运行才能接收和回复消息**。Bot Token 保存在 `data/wechat/connections.json`；微信上下文、处理游标和近期消息 ID 以明文保存在同目录的 `*.messages.json`，不会写入浏览器存储、网页对话或历史 ZIP。浏览器通过 HttpOnly / SameSite=Lax Cookie 关联自己的连接。`data/` 已加入 Git 忽略，可通过 `WECHAT_DATA_DIR` 修改存储目录。请勿分享或提交这些文件。

断开连接会停止监听，并删除当前浏览器对应的本机凭据和该连接的微信会话数据，不会解除微信侧绑定，也不会影响其他浏览器已有的连接。凭据失效时需要在卡片中重新扫码。

## 数据

聊天与搜索 API Key 和设置保存在浏览器 localStorage，会话及附件原件保存在 IndexedDB，本地数据按浏览器用户配置和站点源（origin）隔离。发送对话、上传附件、使用语音或独立搜索时，相应内容会提交给配置的 API 服务。

设置中的历史导入导出使用 ZIP 格式。导入会在确认并校验成功后替换全部本地会话和附件；导出包含会话与本地可用的图片原件，不包含 API Key、设置或非图片附件原件。格式与保留范围见[历史导入导出](src/services/chat/history/README.md)。

设置 → 数据管理 → 删除所有对话，会在确认后清空全部本地会话、附件原件和未发送的草稿，停止正在生成的回复并回到新对话。API Key 和其他设置保留，已上传到 API 服务的文件不受影响。

## 开发

| 命令          | 用途                               |
| ------------- | ---------------------------------- |
| `pnpm dev`    | 启动开发服务器                     |
| `pnpm start`  | 提供生产页面、pi 模型与 OAuth 服务 |
| `pnpm build`  | 构建到 `dist/`                     |
| `pnpm type`   | TypeScript 类型检查                |
| `pnpm lint`   | oxlint 检查                        |
| `pnpm format` | oxfmt 格式化                       |

[rspack.config.ts](rspack.config.ts) 默认连接 `https://api.deepseek.com`。`createConfig({ apiOrigin, devServer })` 支持自定义 API 地址和开发服务器代理。

聊天默认使用 `deepseek-flash`，通过 Anthropic 兼容的 Messages / Files API 通信；语音使用 ASR / TTS 接口。请求使用搜索、链接阅读和 `latest_reminder` 等扩展，接入服务需支持相应能力。附件实际支持的格式以服务端校验为准。

```text
src/
  app/                 应用布局、主题与全局样式
  components/          聊天、设置、Markdown 等界面组件
  i18n/                中英文文案
  services/
    api/               API 请求、SSE 与协议类型
    chat/              会话、消息分支、本地存储与历史导入导出
    search/            搜索配置、统一工具、来源编号与上下文压缩
    markdown/          Markdown 解析、代码高亮与图表
    speech/            录音与朗读
  utils/               通用工具
```

## 第三方素材与署名

BlueFatFish（蓝色小肥鱼Deepseek）的作者是 **木子恶魔**。模型与动作资源来自 [dsh-plugin-vrmpet3d](https://github.com/drliuhuan/dsh-plugin-vrmpet3d) 和 [原作发布页](https://www.aplaybox.com/details/model/ayXkRzVflmnd)，本项目已按作者授权使用。分发时请保留此署名及来源链接。

微信扫码连接复用 [Tencent/openclaw-weixin](https://github.com/Tencent/openclaw-weixin) 的 iLink 协议实现，基于 MIT 许可证改编；腾讯版权声明和许可证保留在 [server/wechat/LICENSE](server/wechat/LICENSE)。

## 许可证

[MIT](LICENSE)。构建会将许可证复制到 `dist/LICENSE`，分发时请一并保留；第三方依赖遵循各自的许可证。
