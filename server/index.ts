import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createGitHubOAuthMiddleware } from './githubOAuth.ts'
import { createPiProviderMiddleware } from './piProvider.ts'

const root = fileURLToPath(new URL('../dist/', import.meta.url))
const port = Number(process.env.PORT ?? 8090)
const hostname = process.env.HOST ?? '127.0.0.1'
const oauth = createGitHubOAuthMiddleware()
const providers = createPiProviderMiddleware()
const contentTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
}

createServer((request, response) => {
  providers(request, response, () =>
    oauth(request, response, () => {
      const serve = async () => {
        if (!['GET', 'HEAD'].includes(request.method ?? '')) {
          response.writeHead(405)
          response.end()
          return
        }
        const url = new URL(request.url ?? '/', 'http://localhost')
        const target = path.resolve(
          root,
          `.${decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)}`
        )
        const relative = path.relative(root, target)
        if (relative.startsWith('..') || path.isAbsolute(relative)) {
          response.writeHead(403)
          response.end()
          return
        }
        const data = await readFile(target)
        response.writeHead(200, {
          'Content-Type': contentTypes[path.extname(target)] ?? 'application/octet-stream',
          'X-Content-Type-Options': 'nosniff',
          'Referrer-Policy': 'strict-origin-when-cross-origin',
          'Content-Security-Policy': "frame-ancestors 'self'; object-src 'none'; base-uri 'none'",
          'X-Frame-Options': 'SAMEORIGIN',
          'Cross-Origin-Resource-Policy': 'same-origin',
          'Cache-Control': 'no-cache',
        })
        response.end(request.method === 'HEAD' ? undefined : data)
      }
      void serve().catch(() => {
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
        response.end('Not found. Run pnpm build before pnpm start.')
      })
    })
  )
}).listen(port, hostname, () => {
  process.stdout.write(`App server: ${process.env.APP_ORIGIN ?? `http://localhost:${port}`}\n`)
})
