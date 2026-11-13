# chat-demo

English | [简体中文](README.zh-CN.md)

A chat application supporting the native DeepSeek API and multiple providers through pi. The native DeepSeek channel can run as a static page; pi Provider, pi Agent, and GitHub OAuth use the included Node server.

You can [try the app online](https://deepseek-ai.github.io/chat-demo/) or download the archive from [Releases](https://github.com/deepseek-ai/deepseek-chat-demo/releases), extract it, and double-click `index.html` to use it locally without installation or a build. Enter your API key in Settings before your first chat.

## Getting started

Install Node.js 22.19+ and pnpm, then run:

```sh
git clone https://github.com/deepseek-ai/chat-demo.git
cd chat-demo
pnpm install
pnpm dev
```

Open http://localhost:8090.

To build the static site:

```sh
pnpm build
```

The output is written to `dist/`. Deploy it to a static web server or open `dist/index.html` directly. Opening the file directly requires browser support for storage on `file://` pages and an API service that permits their cross-origin requests.

## Features

- Multiple conversations with automatic titles, renaming, and deletion; edit prompts, regenerate replies, and switch between message branches.
- Streaming replies, deep thinking, smart search, link reading, and source citations; stop generation or continue eligible replies.
- Upload, paste, or drag and drop attachments; use voice input and read replies aloud. A live audio spectrum appears in the first row of the input area while recording on mobile.
- Markdown, syntax highlighting, KaTeX math, and Mermaid diagrams.
- Simplified Chinese and English, light and dark themes, mobile layouts, location settings, and chat history import and export.
- Connect GitHub to read repositories, issues and files, and approve issue creation in chat.

## Models and providers

Click the model name above the input, or open Settings → Models & providers. Choose a provider and model ID, enter its API key, and select “Save and use.” Each provider has its own browser-local configuration. Switching affects new replies; active replies and tool rounds keep their original configuration, and continuation uses the original reply's model.

Multiple providers use the official `@earendil-works/pi-ai` package and its versioned model/capability catalog. The current catalog includes API-key providers such as OpenAI, Anthropic, Google Gemini, OpenRouter, DeepSeek, Kimi, Moonshot, MiniMax, and Z.AI. Select a catalog model or type a model ID. Subscription OAuth and AWS/Vertex cloud identity login flows are not configured in this interface.

For gateways, Ollama, or LM Studio, choose “Custom compatible endpoint,” enter the model ID and base URL (for example `http://localhost:11434/v1`), and select OpenAI Chat Completions, OpenAI Responses, Anthropic Messages, or Google Generative AI. Local servers without authentication can leave the API key empty; remote endpoints use HTTPS. Keys are excluded from model input, chat records, and history ZIP files.

The pi channel uses `@earendil-works/pi-agent-core` for the model/tool loop. Existing GitHub tools and the chat timeline are retained: independent reads run with up to 50 concurrent calls, issue creation is approved and executed in order, and stopping cancels active and queued work. Each reply allows up to eight tool rounds and 400 calls. Replies retain provider/model snapshots and original pi messages for subsequent tool context.

The pi channel supports images when the selected model allows them and text/code attachments up to 1 MiB per text file. PDF/Office parsing, DeepSeek web search, and speech remain on the native DeepSeek channel; speech uses the DeepSeek key in Settings → Data. Actual image, reasoning, and model availability depend on the provider account.

Multiple providers and Agent require `pnpm dev`, or `pnpm start` after building, with `/api/ai/` served on the same origin. Static hosting and `file://` use the native DeepSeek channel. For production, disable reverse-proxy buffering for SSE and set `APP_ORIGIN` to the browser-facing HTTPS origin.

## Connecting GitHub

Click GitHub in the chat input, or open Settings → Connected apps. When OAuth is configured, choose “Sign in with GitHub” to authorize access and return to the app automatically. The default scopes are `read:user public_repo`; selecting private repositories requests `read:user repo`. Review the actual permissions on GitHub’s authorization page.

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

The Client Secret and OAuth access token stay on the server and are excluded from frontend bundles and browser storage. Login uses one-time state, PKCE and HttpOnly / SameSite=Lax cookies, with Secure on HTTPS. Sessions live in one Node process for up to eight hours; restart or expiry requires signing in again. Token refresh and shared multi-instance sessions are not implemented. Disconnecting ends this app’s server session; revoke the application grant separately in GitHub settings if needed. OAuth requires the HTTP server; GitHub Pages and `file://` deployments can still use manual tokens.

Try “Show me the deepseek-ai/chat-demo repository and its recent issues” or “Read this repository’s README.md.” Independent reads in the same round run with up to 50 concurrent calls; additional reads are queued and results are returned in the model’s original call order. Reads that depend on earlier results still require another round. Each reply allows up to eight tool rounds and 400 app tool calls in total. Issue creation is approved and executed one call at a time in the original order. Each write waits for preceding reads to finish, and later reads wait for the write. The app shows the repository, title and complete body for approval before making the request. Rejected or interrupted operations are not automatically retried. If a creation request is interrupted or times out, check GitHub before retrying to avoid duplicate issues.

Manually entered tokens are kept in this tab’s sessionStorage and survive refresh. Disconnecting removes it and cancels active GitHub requests. Browser tab restoration may restore session storage; disconnect explicitly when you no longer want access. The token is sent only to GitHub, not as model input. Query results are sent to the AI service and saved in the local chat, and may contain private repository content. History ZIP exports keep answer text but omit app tool calls and their raw results.

## Data and storage

Your API key and settings are stored in the browser's localStorage. Conversations and original attachments are stored in IndexedDB. Local data is isolated by browser profile and site origin. Sending messages, uploading attachments, and using speech features sends the relevant content to the configured API service.

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

Chat uses `deepseek-flash` by default through Anthropic-compatible Messages / Files APIs. Speech features use ASR / TTS endpoints. Requests include extensions for search, link reading, titles, and `latest_reminder`, so the configured service must support the corresponding capabilities. Supported attachment formats are determined by server-side validation.

```text
src/
  app/                 Application layout, themes, and global styles
  components/          Chat, settings, Markdown, and other UI components
  i18n/                English and Chinese translations
  services/
    api/               API requests, SSE, and protocol types
    chat/              Conversations, message branches, storage, and history import/export
    markdown/          Markdown parsing, syntax highlighting, and diagrams
    speech/            Audio recording and read-aloud playback
  utils/               Shared utilities
```

## License

[MIT](LICENSE). The build copies the license to `dist/LICENSE`; include it when distributing the app. Third-party dependencies are subject to their own licenses.
