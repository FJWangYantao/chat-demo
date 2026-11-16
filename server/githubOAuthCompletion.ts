import { randomBytes } from 'node:crypto'
import type { ServerResponse } from 'node:http'

export const sendGitHubOAuthCompletion = (response: ServerResponse, locale: 'zh-CN' | 'en-US') => {
  const chinese = locale === 'zh-CN'
  const title = chinese ? 'GitHub 授权已提交' : 'GitHub authorization submitted'
  const description = chinese
    ? '请返回原页面查看连接结果。此标签页将尝试自动关闭。'
    : 'Return to the original page for the connection result. This tab will attempt to close.'
  const close = chinese ? '关闭此标签页' : 'Close this tab'
  const nonce = randomBytes(18).toString('base64')
  response.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'`,
    'X-Frame-Options': 'DENY',
  })
  response.end(`<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style nonce="${nonce}">
:root{color-scheme:light dark;font-family:system-ui,sans-serif}
body{min-height:100dvh;display:grid;place-content:center;box-sizing:border-box;margin:0;padding:24px;background:Canvas;color:CanvasText}
main{max-width:420px}h1{font-size:22px}p{font-size:14px;line-height:1.7}
button{min-height:40px;padding:8px 14px;border:1px solid GrayText;border-radius:8px;background:Canvas;color:CanvasText;font:inherit;cursor:pointer}
button:focus-visible{outline:2px solid Highlight;outline-offset:3px}
</style>
</head>
<body><main><h1>${title}</h1><p>${description}</p><button type="button" id="close">${close}</button></main>
<script nonce="${nonce}">
document.getElementById('close').addEventListener('click',()=>window.close());
try {
  const attempt = new URLSearchParams(window.location.search).get('attempt');
  if (attempt && /^[a-zA-Z0-9_-]{32}$/.test(attempt)) {
    const channel = new BroadcastChannel('chat-demo:github-oauth:' + attempt);
    channel.postMessage('callback');
    channel.close();
  }
} catch {}
window.close();
</script>
</body>
</html>`)
}
