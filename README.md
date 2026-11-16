# chat-demo

English | [简体中文](README.zh-CN.md)

A chat application supporting the native DeepSeek API and multiple providers through pi. The native DeepSeek channel can run as a static page; pi Provider, pi Agent, GitHub OAuth, and Weixin QR connections use the included Node server.

You can [try the app online](https://deepseek-ai.github.io/chat-demo/) or download the archive from [Releases](https://github.com/deepseek-ai/deepseek-chat-demo/releases), extract it, and double-click `index.html` to use it locally without installation or a build. Enter your API key in Settings before your first chat.

## Getting started

Install Node.js 22.21+ and pnpm, then run:

```sh
git clone https://github.com/deepseek-ai/chat-demo.git
cd chat-demo
pnpm install
pnpm dev
```

Open http://localhost:8090.

`pnpm dev` and `pnpm start` honor `HTTP_PROXY`, `HTTPS_PROXY`, and `NO_PROXY`. If GitHub requires a proxy, set it before starting and exclude `localhost,127.0.0.1,::1` using `NO_PROXY`. A browser or system proxy alone does not configure Node requests.

To build the static site:

```sh
pnpm build
```

The output is written to `dist/`. Deploy it to a static web server or open `dist/index.html` directly. Opening the file directly requires browser support for storage on `file://` pages and an API service that permits their cross-origin requests.

## Features

- Multiple conversations with titles generated alongside first replies, renaming, and deletion; automatic titles can be disabled in General settings to keep “New chat”; edit prompts, regenerate replies, and switch between message branches.
- Streaming replies, deep thinking, independent DeepSeek/Tavily search, webpage extraction, and unified source citations; stop generation or continue eligible replies.
- Upload, paste, or drag and drop attachments; use voice input and read replies aloud. A live audio spectrum appears in the first row of the input area while recording on mobile.
- Markdown, syntax highlighting, KaTeX math, and Mermaid diagrams.
- Simplified Chinese and English, light and dark themes, mobile layouts, location settings, and chat history import and export.
- Connect GitHub to read repositories, issues and files, and approve issue creation in chat.
- Bind Weixin ClawBot with a QR code through Tencent's OpenClaw Weixin iLink channel and chat with AI using independent contexts, PIN verification, and local recovery.
- Detect a Magpie desktop gateway and browse its local models and routing groups.
- Use BlueFatFish static illustrations, start the 3D companion automatically where supported, and retain static fallbacks for reduced motion, `file://`, and WebGL2 failures.

## Models and providers

Click the model name above the input, or open Settings → Models & providers. Choose a provider and model ID, enter its API key, and select “Save and use.” Each provider has its own browser-local configuration. Switching affects new replies; active replies and tool rounds keep their original configuration, and continuation uses the original reply's model.

Multiple providers use the official `@earendil-works/pi-ai` package and its versioned model/capability catalog. The current catalog includes API-key providers such as OpenAI, Anthropic, Google Gemini, OpenRouter, DeepSeek, Kimi, Moonshot, MiniMax, and Z.AI. Select a catalog model or type a model ID. Subscription OAuth and AWS/Vertex cloud identity login flows are not configured in this interface.

For gateways, Ollama, or LM Studio, choose “Custom compatible endpoint,” enter the model ID and base URL (for example `http://localhost:11434/v1`), and select OpenAI Chat Completions, OpenAI Responses, Anthropic Messages, or Google Generative AI. Local servers without authentication can leave the API key empty; remote endpoints use HTTPS. Keys are excluded from model input, chat records, and history ZIP files.

To use the [yetone/magpie](https://github.com/yetone/magpie) desktop app, open Settings → Connected apps → Magpie. Detection starts automatically, and the catalog refreshes when you revisit the page or refocus the window; manual refresh and reconnect controls remain available. Magpie must be running at its default `127.0.0.1:3425` address, and this app must be running locally through `pnpm dev` or `pnpm start`. The application server requests only Magpie's `/v1/models`; it does not read upstream API keys, subscription credentials or management APIs. Detection is unavailable from a remote application server or a static deployment.

After detection, select or enter a `provider/model` or `group/...` and choose “Save and use.” Display names, reasoning support and image input come from Magpie's catalog; capabilities for unlisted models can be adjusted manually under Models & providers. A failed refresh retains the last successful catalog and disables saving. If a saved model disappears from the latest catalog, the app warns without replacing the model or rewriting its configuration. Magpie has an independent provider profile and does not replace the custom compatible endpoint. Chat, streaming and Agent tool calls continue through the existing pi channel.

The pi channel uses `@earendil-works/pi-agent-core` for the model/tool loop. Existing GitHub tools and the chat timeline are retained: independent reads run with up to 50 concurrent calls, issue creation is approved and executed in order, and stopping cancels active and queued work. Each reply allows up to eight tool rounds, 400 GitHub calls, and a separate limit of 12 search/fetch calls. Replies retain provider/model snapshots and original pi messages for subsequent tool context.

The pi channel supports images when the selected model allows them and text/code attachments up to 1 MiB per text file. PDF/Office parsing and speech remain on the native DeepSeek channel; speech uses the DeepSeek key in Settings → Data. Actual image, reasoning, and tool-calling capabilities depend on the provider account. Custom models can disable tool calling and use retrieve-before-answer instead.

Multiple providers and Agent require `pnpm dev`, or `pnpm start` after building, with `/api/ai/` served on the same origin. Static hosting and `file://` use the native DeepSeek channel. For production, disable reverse-proxy buffering for SSE and set `APP_ORIGIN` to the browser-facing HTTPS origin.

## Search service

Open Settings → Search service to choose DeepSeek Search / Fetch or Tavily Search / Extract. When a DeepSeek API key is already saved under Data, selecting DeepSeek reuses it immediately without re-entering the key or saving another profile; a separate search key remains optional. Tavily requires its own key. Base URL and results per search (8 by default, up to 10) are saved separately for each provider. The search engine does not change automatically with the chat provider, and pi users must explicitly configure it before any search request can incur charges.

With smart search enabled, each new reply stores a token-free snapshot of the provider, result count, and mode; retries and regeneration reuse it. Tool-capable models use the unified `web_search` and `web_fetch` tools. When tool calling is disabled for a custom model, the app shortens long questions, performs one real retrieval, and then lets the model answer. Search failures appear as tool errors rather than fabricated sources.

Search and extraction run with up to four concurrent requests, at most four per round and 12 per reply, separately from GitHub's 400-call limit. Sources use reply-wide `S1`, `S2`, … IDs with URL deduplication, and only valid IDs become citation links. Later questions receive only cited source titles, URLs, and snippets; uncited results and full fetched pages remain local for display. The history ZIP format is unchanged: independent searches map to `TOOL_SEARCH`, fetches to `TOOL_OPEN`, and imports are read-only search history.

The application server exposes `/api/search/search` and `/api/search/fetch`, requiring `pnpm dev` or `pnpm start` after building. It enforces same-origin requests, validates input and upstream responses, limits sizes and timeouts, retries 408, 429, and 5xx responses at most once, and aborts upstream work when generation stops. DeepSeek and Tavily may bill separately per request or credit.

Search keys remain in this browser's localStorage and are sent only to the application server for requests. They are excluded from reply snapshots and history ZIP files, and the server does not persist them. Static hosting and `file://` never call the independent search API: native DeepSeek chat explicitly retains its legacy built-in search compatibility path, while other chat providers and Tavily require the application server.

## Connecting GitHub

Click Connector at the top of the sidebar, or open Settings → Connected apps, then select the GitHub card. Cards show Installed (disabled in chats), Not signed in, or Connected. The details view supports multiple accounts and token connections, connection names, token replacement, reauthorization, and disconnecting individual connections. Choose one default connection for chats; adding another keeps the existing connections. When OAuth is configured, Sign in with GitHub opens a new tab. The original page shows a waiting indicator and checks the authorization attempt. After validating the authorization callback, the server immediately returns a page that attempts to close, then exchanges the token and reads the account in the background. The connection result appears only in the original page. The completion page immediately notifies the original page through BroadcastChannel to start checking; polling remains as a fallback if the notification is unavailable or missed. You can cancel waiting; attempts time out after 10 minutes. Cancellation, denial, failure, and timeout end the wait while preserving existing connections. The default scopes are `read:user public_repo`; selecting private repositories requests `read:user repo`. Review the actual permissions on GitHub’s authorization page.

For static hosting, expand “Connect with a Personal Access Token.” Prefer a fine-grained token scoped to selected repositories with read-only Contents and read-only or read/write Issues. Creating issues requires write permission; organization repositories may also require organization approval.

### Configuring the OAuth callback

1. Register an app in [GitHub OAuth Apps](https://github.com/settings/applications/new). For local development, set Homepage URL to `http://localhost:8090` and Authorization callback URL to `http://localhost:8090/auth/github/callback`.
2. Set `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, and `APP_ORIGIN` in the server process environment. The server does not automatically load `.env` files. In Windows PowerShell:

   ```powershell
   $env:GITHUB_CLIENT_ID="your Client ID"
   $env:GITHUB_CLIENT_SECRET="your Client Secret"
   $env:APP_ORIGIN="http://localhost:8090"
   pnpm dev
   ```

3. Open the exact `APP_ORIGIN` URL and sign in. Restart the server after changing configuration.
4. For production, run `pnpm build`, then `pnpm start`. The Node server serves `dist/`, the OAuth callback, and the GitHub API proxy. Set `APP_ORIGIN` to your HTTPS origin and register its `/auth/github/callback` URL with GitHub. A reverse proxy must preserve the original Host. `HOST` and `PORT` default to `127.0.0.1` and `8090`.

The Client Secret and OAuth access token stay on the server and are excluded from frontend bundles and browser storage. Login uses one-time state, PKCE and HttpOnly / SameSite=Lax cookies, with Secure on HTTPS. Sessions live in one Node process for up to eight hours; restart or expiry requires signing in again. Token refresh and shared multi-instance sessions are not implemented. Disconnecting removes only the selected server connection and leaves other accounts connected; revoke the application grant separately in GitHub settings if needed. OAuth requires the HTTP server; GitHub Pages and `file://` deployments can still use manual tokens.

Try “Show me the deepseek-ai/chat-demo repository and its recent issues” or “Read this repository’s README.md.” Independent reads in the same round run with up to 50 concurrent calls; additional reads are queued and results are returned in the model’s original call order. Reads that depend on earlier results still require another round. Each reply allows up to eight tool rounds and 400 app tool calls in total. Issue creation is approved and executed one call at a time in the original order. Each write waits for preceding reads to finish, and later reads wait for the write. The app shows the repository, title and complete body for approval before making the request. Rejected or interrupted operations are not automatically retried. If a creation request is interrupted or times out, check GitHub before retrying to avoid duplicate issues.

Manually entered tokens are kept in this tab’s sessionStorage and survive refresh. Disconnecting removes the selected token and cancels its requests while keeping other connections. Switching the default connection or disabling the app interrupts current tool calls and pending write approvals. Disconnecting the default does not automatically switch to another account. Browser tab restoration may restore session storage; disconnect explicitly when you no longer want access. The token is sent only to GitHub, not as model input. Query results are sent to the AI service and saved in the local chat, and may contain private repository content. History ZIP exports keep answer text but omit app tool calls and their raw results.

## Connect Weixin ClawBot

Open Settings → Connected apps → Weixin, choose “Connect Weixin with QR code,” then scan the code and confirm on your phone. The connection reuses the iLink protocol layer from [Tencent/openclaw-weixin](https://github.com/Tencent/openclaw-weixin) 2.4.10. It does not require the full OpenClaw runtime, Weixin Open Platform AppID/AppSecret, or a public callback URL; the application server must be able to reach `https://ilinkai.weixin.qq.com`. Scan status, QR refresh, numeric phone PIN verification, cancellation, and reconnection are supported.

After binding, the server receives new messages through long polling and replies automatically. **Text and voice transcription are supported; images, files, video, group chats, web chat synchronization, and GitHub/search/local-file tools are not.** Each Weixin contact has an independent context capped at the last 12 turns. Send `/clear` or `/new` to reset it. Long replies are split into chunks. Cursors and recently processed IDs survive restarts, although an extreme interruption cannot guarantee zero duplicate replies.

### Configure Weixin AI

Background Weixin tasks cannot read API keys from browser storage. Configure them separately in the server environment. Windows PowerShell example:

```powershell
$env:WECHAT_AI_API_KEY="your DeepSeek API key"
$env:WECHAT_AI_PROVIDER="deepseek"
$env:WECHAT_AI_MODEL="deepseek-flash"
pnpm dev
```

Provider and model default to `deepseek` and `deepseek-flash`. Optional settings include `WECHAT_AI_BASE_URL`, `WECHAT_AI_REASONING=1`, `WECHAT_AI_MAX_TOKENS` (default 2048), and `WECHAT_AI_SYSTEM_PROMPT`.

For a custom OpenAI-compatible endpoint:

```powershell
$env:WECHAT_AI_PROVIDER="custom"
$env:WECHAT_AI_MODEL="your model ID"
$env:WECHAT_AI_BASE_URL="https://your-endpoint/v1"
$env:WECHAT_AI_API="openai-completions"
$env:WECHAT_AI_API_KEY="your API key"
pnpm dev
```

`WECHAT_AI_API` supports `openai-completions`, `openai-responses`, `anthropic-messages`, and `google-generative-ai`. For an unauthenticated local custom endpoint, set `WECHAT_AI_API_KEY` to `local`. Restart after configuration changes. Weixin messages are sent to the configured model provider, whose billing and data-retention rules apply.

Only the person who scanned the QR code can trigger AI by default. Set `WECHAT_ALLOW_FROM` to a comma-separated list of Weixin user IDs to allow other contacts. This list replaces the default owner-only rule, so include the scanner's ID as well if they should retain access. Setting it to `*` allows every direct-message contact to consume model quota, so use it carefully. If no allowlist is configured and login returned no user ID, no messages are answered.

### Runtime and storage

Run through `pnpm dev`, or build and run `pnpm start`; static deployments and `file://` are unsupported. **The server must remain running to receive and reply to messages.** Bot tokens are stored in `data/wechat/connections.json`. Weixin context, sync cursors, and recent message IDs are stored as plaintext in `*.messages.json` in the same directory. None are written to browser storage, web chats, or history ZIP files. An HttpOnly / SameSite=Lax cookie associates the browser with its connection. The `data/` directory is ignored by Git; set `WECHAT_DATA_DIR` to change its location. Do not share or commit these files.

Disconnecting stops the listener and removes the current browser's local credentials and this connection's Weixin message data. It does not unbind Weixin or affect other browsers. Reconnect with a new QR code if credentials expire.

## Data and storage

Chat and search API keys and settings are stored in the browser's localStorage. Conversations and original attachments are stored in IndexedDB. Local data is isolated by browser profile and site origin. Sending messages, uploading attachments, using speech, or performing independent searches sends the relevant content to the configured API service.

History import and export in Settings use ZIP archives. After confirmation and successful validation, importing replaces all local conversations and attachments. Exports include conversations and locally available original images, but exclude API keys, settings, and original non-image attachments. See the [history import/export documentation (Chinese)](src/services/chat/history/README.md) for the archive format and preservation details.

Settings → Data → Delete all chats clears all local conversations, original attachments, and unsent drafts after confirmation. It stops ongoing replies and returns to a new chat. Your API key and settings are preserved; files already uploaded to the API service are not deleted.

## Development

| Command       | Description                                 |
| ------------- | ------------------------------------------- |
| `pnpm dev`    | Start the development server                |
| `pnpm start`  | Serve production pages, pi models and OAuth |
| `pnpm build`  | Build into `dist/`                          |
| `pnpm type`   | Run TypeScript type checks                  |
| `pnpm lint`   | Lint with oxlint                            |
| `pnpm format` | Format with oxfmt                           |

[rspack.config.ts](rspack.config.ts) uses `https://api.deepseek.com` by default. Use `createConfig({ apiOrigin, devServer })` to customize the API origin and development server proxy.

Chat uses `deepseek-flash` by default through Anthropic-compatible Messages / Files APIs. Speech features use ASR / TTS endpoints. Requests include extensions for search, link reading, and `latest_reminder`, so the configured service must support the corresponding capabilities. Supported attachment formats are determined by server-side validation.

```text
src/
  app/                 Application layout, themes, and global styles
  components/          Chat, settings, Markdown, and other UI components
  i18n/                English and Chinese translations
  services/
    api/               API requests, SSE, and protocol types
    chat/              Conversations, message branches, storage, and history import/export
    search/            Search settings, unified tools, source IDs, and context compaction
    markdown/          Markdown parsing, syntax highlighting, and diagrams
    speech/            Audio recording and read-aloud playback
  utils/               Shared utilities
```

## Third-party artwork

BlueFatFish / 蓝色小肥鱼Deepseek is created by **木子恶魔**. The model and motion assets come from [dsh-plugin-vrmpet3d](https://github.com/drliuhuan/dsh-plugin-vrmpet3d) and the [original Aplaybox release](https://www.aplaybox.com/details/model/ayXkRzVflmnd). They are used in this project with the author's permission. Keep this attribution and the source links with redistributed copies.

The Weixin QR connection adapts the iLink protocol implementation from [Tencent/openclaw-weixin](https://github.com/Tencent/openclaw-weixin) under the MIT License. Tencent's copyright notice and license are retained in [server/wechat/LICENSE](server/wechat/LICENSE).

## License

[MIT](LICENSE). The build copies the license to `dist/LICENSE`; include it when distributing the app. Third-party dependencies are subject to their own licenses.
