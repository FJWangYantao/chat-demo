# chat-demo

[English](README.md) | 简体中文

支持 DeepSeek 原生接口与 pi 多服务商的聊天应用。DeepSeek 原生通道可作为静态页面运行；pi Provider、pi Agent 和 GitHub OAuth 使用随项目提供的 Node 服务。

点击 [在线体验](https://deepseek-ai.github.io/chat-demo/) 即可使用，也可以前往 [Releases](https://github.com/deepseek-ai/deepseek-chat-demo/releases) 下载压缩包，解压后双击 `index.html` 在本地使用，无需安装或构建。首次使用时，请在设置中填写 API Key。

## 运行

准备 Node.js 22.19+ 和 pnpm：

```sh
git clone https://github.com/deepseek-ai/chat-demo.git
cd chat-demo
pnpm install
pnpm dev
```

打开 http://localhost:8090 。

生成静态产物：

```sh
pnpm build
```

产物位于 `dist/`，可部署到静态服务器，也可直接打开 `dist/index.html`。直接打开时，浏览器和 API 服务需允许 `file://` 页面的存储与跨域请求。

## 功能

- 多会话、自动标题、重命名与删除；编辑提问、重新生成和切换消息分支。
- 流式回答、深度思考、智能搜索、链接阅读与来源引用；支持停止和符合条件的继续生成。
- 附件上传、粘贴与拖拽，语音输入和回复朗读；移动端录音时输入框首行显示实时频谱。
- Markdown、代码高亮、KaTeX 公式和 Mermaid 图表。
- 简体中文与英文、浅色与深色主题、移动端布局、位置设置、历史导入导出。
- 连接 GitHub，让 AI 查询仓库、Issue 和文件；创建 Issue 前在聊天中确认仓库、标题和正文。

## 模型与服务商

点击输入框上方的模型名称，或打开设置 → 模型与服务商。选择服务商、模型 ID，填入其 API Key，再点击“保存并使用”。每个服务商的配置分别保存在本机浏览器中；切换影响新回复，已开始的回复和工具轮次继续使用原配置，续写沿用原回复的模型。

多服务商使用官方 `@earendil-works/pi-ai`，模型与能力目录随该依赖版本提供。当前目录包含 OpenAI、Anthropic、Google Gemini、OpenRouter、DeepSeek、Kimi、Moonshot、MiniMax、Z.AI 等 API Key 服务商。模型 ID 既可从列表中选择，也可直接输入；订阅 OAuth、AWS/Vertex 云身份等登录流程不在本界面中配置。

中转服务或本地 Ollama、LM Studio 可选择“自定义兼容接口”，填写模型 ID 和 Base URL，例如 `http://localhost:11434/v1`，再选择 OpenAI Chat Completions、OpenAI Responses、Anthropic Messages 或 Google Generative AI 协议。本地无鉴权接口可留空 API Key；远程地址使用 HTTPS。API Key 不会成为模型输入或写入聊天记录、历史 ZIP。

pi 通道使用 `@earendil-works/pi-agent-core` 管理模型与工具之间的自动循环。现有 GitHub 工具和聊天时间线继续工作：独立读取最多并行 50 个，创建 Issue 逐项确认、按顺序执行，停止会取消正在执行及排队的任务。每次回复最多 8 个工具轮次、累计 400 次调用。每条回复保存服务商及模型快照，并保留 pi 原始消息以恢复后续工具上下文。

pi 支持模型允许的图片输入及文本、代码附件；单个文本附件上限为 1 MiB。PDF、Office 文档解析、DeepSeek 联网搜索与语音仍由 DeepSeek 原生通道提供；语音使用设置 → 数据管理中的 DeepSeek API Key。图片能力、思考能力和可调用模型以服务商实际权限为准。

多服务商与 Agent 需要 `pnpm dev`，或构建后运行 `pnpm start`，由同一服务提供 `/api/ai/` 接口。纯静态部署和 `file://` 使用 DeepSeek 原生通道。生产反向代理请关闭 SSE 响应缓冲，并将 `APP_ORIGIN` 设置为浏览器访问的 HTTPS 站点源。

## 连接 GitHub

在输入框点击 GitHub，或打开设置 → 连接应用。配置了 OAuth 服务后，可点击“登录 GitHub 并授权”，授权完成后自动回到应用，恢复连接。默认请求 `read:user public_repo` 权限；勾选访问私有仓库后请求 `read:user repo`，具体授权范围以 GitHub 授权页为准。

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

OAuth 的 Client Secret 和访问令牌仅由服务器持有，不会写入前端构建或浏览器存储。登录使用一次性 `state`、PKCE 和 HttpOnly / SameSite=Lax 会话 Cookie；HTTPS 下同时启用 Secure。会话保存在单个 Node 进程内存中，最长 8 小时，重启或过期后重新登录；当前不实现刷新令牌或多实例共享会话。断开连接会结束本应用的服务器会话；如需撤销 GitHub 应用授权，可前往 GitHub 设置操作。OAuth 登录需要 HTTP 服务，GitHub Pages 或 `file://` 打开方式仍使用令牌连接。

连接后可发送“查看 deepseek-ai/chat-demo 仓库的信息和最近的 Issue”或“读取这个仓库的 README.md”。同一轮互不依赖的读取最多并行执行 50 个，超出部分自动排队，结果按模型调用顺序回传；依赖前一步结果的读取仍分轮进行。每次回复最多执行 8 轮、累计 400 次应用工具调用。创建 Issue 按调用顺序逐项确认和执行：执行前等待前面的读取完成，后续读取等待本次写入结束。应用会展示完整参数，点击“确认创建 Issue”后才会发送请求；拒绝或停止生成不会自动重试。若请求中断或超时，请先到 GitHub 检查是否已创建，避免重复发布。

手动输入的令牌仅保存在当前标签页的 sessionStorage 中，刷新后可复用；断开连接会清除令牌并取消正在执行的 GitHub 请求。浏览器恢复标签页时可能恢复会话存储，若不希望保留连接请主动断开。令牌只发给 GitHub，不作为模型输入；查询结果会提交给 AI 服务并保存在本地对话中，可能包含私有仓库内容。历史 ZIP 保留回答正文，但不保留应用工具调用及原始结果。

## 数据

API Key 和设置保存在浏览器 localStorage，会话及附件原件保存在 IndexedDB，本地数据按浏览器用户配置和站点源（origin）隔离。发送对话、上传附件和使用语音功能时，相应内容会提交给配置的 API 服务。

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

聊天默认使用 `deepseek-flash`，通过 Anthropic 兼容的 Messages / Files API 通信；语音使用 ASR / TTS 接口。请求使用搜索、链接阅读、标题和 `latest_reminder` 等扩展，接入服务需支持相应能力。附件实际支持的格式以服务端校验为准。

```text
src/
  app/                 应用布局、主题与全局样式
  components/          聊天、设置、Markdown 等界面组件
  i18n/                中英文文案
  services/
    api/               API 请求、SSE 与协议类型
    chat/              会话、消息分支、本地存储与历史导入导出
    markdown/          Markdown 解析、代码高亮与图表
    speech/            录音与朗读
  utils/               通用工具
```

## 许可证

[MIT](LICENSE)。构建会将许可证复制到 `dist/LICENSE`，分发时请一并保留；第三方依赖遵循各自的许可证。
