import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import { VitePWA } from 'vite-plugin-pwa'
import { isHostAllowed } from './src/plugins/host/whitelist'

/**
 * 手动重定向请求：Node 原生 http/https 模块（默认就不跟随 3xx，
 * 状态码与 set-cookie / Location 头完整可读）。
 *
 * 为什么不用 fetch(url, { redirect: 'manual' })：undici 实现 Fetch 规范，
 * manual 返回的是 opaque-redirect（状态 0、头部全空）——QQ 登录的
 * check_sig（读 p_skey cookie）与 authorize（读 Location 里的 code）
 * 都拿不到东西，实测「没有 p_skey」就是这个坑。
 */
function nodeRequestNoRedirect(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: string | null,
): Promise<{ status: number; headers: Record<string, string>; buf: Buffer }> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https:') ? https : http
    // Node http 不写 Content-Length 会用 chunked 编码，部分腾讯端点不接受
    const finalHeaders = { ...headers }
    if (body != null && method !== 'GET' && method !== 'HEAD') {
      finalHeaders['Content-Length'] = String(Buffer.byteLength(body, 'utf8'))
    }
    const req = mod.request(url, { method, headers: finalHeaders }, upstream => {
      const chunks: Buffer[] = []
      upstream.on('data', (c: Buffer) => chunks.push(c))
      upstream.on('end', () => {
        const outHeaders: Record<string, string> = {}
        for (const [key, value] of Object.entries(upstream.headers)) {
          if (Array.isArray(value)) outHeaders[key.toLowerCase()] = value.join(', ')
          else if (value !== undefined) outHeaders[key.toLowerCase()] = String(value)
        }
        resolve({ status: upstream.statusCode ?? 0, headers: outHeaders, buf: Buffer.concat(chunks) })
      })
    })
    req.on('error', reject)
    if (body != null && method !== 'GET' && method !== 'HEAD') req.write(body)
    req.end()
  })
}

/**
 * 开发态插件代理中间件：/__n1ko_proxy（POST JSON）。
 *
 * 浏览器里插件请求被 CORS 拦住，开发态经 dev server 转发。白名单在服务端
 * 再校验一次（规则与宿主共用 src/plugins/host/whitelist.ts）——只转发
 * manifest hosts 允许的公网目标，私网一律拒绝。只存在于 dev server，
 * 不进任何构建产物，也不落盘任何请求内容。
 */
function n1koPluginProxyMiddleware(): Plugin {
  return {
    name: 'n1ko-plugin-proxy',
    configureServer(server) {
      server.middlewares.use('/__n1ko_proxy', async (req, res, next) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end('POST only')
          return
        }
        try {
          const chunks: Buffer[] = []
          for await (const chunk of req) chunks.push(chunk as Buffer)
          const { url, allow, method, headers, body, redirect } = JSON.parse(Buffer.concat(chunks).toString('utf-8')) as {
            url?: string; allow?: string; method?: string
            headers?: Record<string, string>; body?: string | null
            redirect?: 'follow' | 'manual'
          }
          const allowList = (allow ?? '').split(',').map(s => s.trim()).filter(Boolean)
          if (!url || !isHostAllowed(url, allowList)) {
            res.statusCode = 403
            res.end('host not allowed')
            return
          }
          let status: number
          let outHeaders: Record<string, string>
          let buf: Buffer
          if (redirect === 'manual') {
            // manual：Node 原生请求，不跟随 3xx（见 nodeRequestNoRedirect 注释）
            const manual = await nodeRequestNoRedirect(url, method ?? 'GET', headers ?? {}, body ?? null)
            status = manual.status
            outHeaders = manual.headers
            buf = manual.buf
          } else {
            const upstream = await fetch(url, {
              method: method ?? 'GET',
              headers,
              ...(body != null && method !== 'GET' && method !== 'HEAD' ? { body } : {}),
            })
            status = upstream.status
            buf = Buffer.from(await upstream.arrayBuffer())
            outHeaders = {}
            upstream.headers.forEach((v, k) => { outHeaders[k.toLowerCase()] = v })
          }
          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({
            status,
            headers: outHeaders,
            bodyBase64: buf.toString('base64'),
          }))
        } catch (err) {
          res.statusCode = 502
          res.end(`proxy error: ${err instanceof Error ? err.message : String(err)}`)
        }
      })
    },
  }
}

/**
 * 开发态插件目录中间件：/__n1ko_plugins/*。
 *
 * 直接读仓库根的 plugins/ 目录（catalog.json 与各插件的 manifest/代码），
 * 让「插件目录地址」在开发态默认指向本地，装插件不需要发版。
 * 只在 dev server 存在；路径做了穿越防护，只能读 plugins/ 内的文件。
 */
function n1koPluginCatalogMiddleware(): Plugin {
  const pluginsRoot = path.resolve(__dirname, '../plugins')
  const CONTENT_TYPES: Record<string, string> = {
    '.json': 'application/json; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
  }
  return {
    name: 'n1ko-plugin-catalog',
    configureServer(server) {
      server.middlewares.use('/__n1ko_plugins', (req, res, next) => {
        const relative = decodeURIComponent((req.url ?? '').replace(/^\/+/, ''))
        if (!relative) {
          res.statusCode = 404
          res.end('not found')
          return
        }
        const filePath = path.resolve(pluginsRoot, relative)
        // 穿越防护：解析后的路径必须仍在 plugins/ 内
        if (!filePath.startsWith(pluginsRoot + path.sep)) {
          res.statusCode = 403
          res.end('forbidden')
          return
        }
        fs.readFile(filePath, (err, data) => {
          if (err) {
            res.statusCode = 404
            res.end('not found')
            return
          }
          res.statusCode = 200
          res.setHeader('Content-Type', CONTENT_TYPES[path.extname(filePath)] ?? 'application/octet-stream')
          res.setHeader('Cache-Control', 'no-store')
          res.end(data)
        })
      })
    },
  }
}

export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [
    react(),
    n1koPluginProxyMiddleware(),
    n1koPluginCatalogMiddleware(),
    // Capacitor 原生壳内禁用 PWA/Service Worker（WebView 内 SW 缓存会导致资源陈旧）
    ...(mode === 'capacitor'
      ? []
      : [
          VitePWA({
            // 必须是 prompt：autoUpdate 分支根本不会调用 onNeedRefresh，
            // UpdatePrompt 永远不会出现，而新 SW 要等所有标签页关闭才接管——
            // 常驻标签页的用户会长期停在旧版本且毫不知情。
            registerType: 'prompt',
            includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'masked-icon.svg'],
            manifest: {
              name: 'N1KO MUSIC',
              short_name: 'N1KO',
              description: 'Modern music streaming client for Navidrome/Subsonic/Jellyfin/Emby',
              theme_color: '#f4efe3',
              background_color: '#f4efe3',
              display: 'standalone',
              /**
               * 浏览器里没有自定义协议，但 PWA 可以登记为 web+ 前缀的处理器。
               * 装成 PWA 之后，系统上的 web+niko:// 链接会落到 ./open?url=…，
               * 由 OpenLink 页解析并跳转——和原生壳的 n1ko:// 走同一套解析。
               *
               * 两个坑都踩过：
               * 1. scheme 是 `web+niko` 不是 `web+n1ko`。规范只允许 "web+" 后跟
               *    ASCII 小写字母，中间的数字 1 会让浏览器在解析 manifest 时
               *    直接丢掉整条 entry——没有报错，只是永远不生效。
               * 2. url 必须是相对的。构建的 base 是 './'，manifest 的 scope 因此
               *    也是 './'；写成绝对的 /open 会跑到 scope 之外（规范要求
               *    handler 的 url 落在 scope 内），部署到子路径时还会 404。
               */
              protocol_handlers: [
                { protocol: 'web+niko', url: './open?url=%s' },
              ],
              /**
               * 这两个 png 必须真实存在于 public/ 下。
               * 此前 manifest 指着两个从未构建出来的文件，Android Chrome 的
               * 可安装性检查要求至少一个 ≥192px 且可拉取的图标，于是
               * beforeinstallprompt 永远不触发——「安装」入口整个不出现。
               *
               * maskable 那一条是给 Android 自适应图标用的：缺了它，
               * 系统会把方形图标套进白色圆底，边缘一圈突兀的白。
               */
              icons: [
                {
                  src: 'pwa-192x192.png',
                  sizes: '192x192',
                  type: 'image/png',
                  purpose: 'any',
                },
                {
                  src: 'pwa-512x512.png',
                  sizes: '512x512',
                  type: 'image/png',
                  purpose: 'any',
                },
                {
                  src: 'pwa-512x512.png',
                  sizes: '512x512',
                  type: 'image/png',
                  purpose: 'maskable',
                },
              ],
            },
            workbox: {
              // 字体是自托管的，必须进预缓存——此前 glob 里没有 woff2，
              // 离线时整套衬线/等宽字体全部退回系统字体。
              globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
              runtimeCaching: [
                {
                  // 封面按 URL 缓存：音乐服务器的封面接口稳定且体积可观。
                  // 走 StaleWhileRevalidate，离线时仍有图，联网时后台更新。
                  urlPattern: ({ url }) =>
                    /\/rest\/getCoverArt/i.test(url.pathname) ||
                    /\/Items\/[^/]+\/Images\//i.test(url.pathname),
                  handler: 'StaleWhileRevalidate',
                  options: {
                    cacheName: 'cover-art-cache',
                    expiration: { maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 * 30 },
                    cacheableResponse: { statuses: [0, 200] },
                  },
                },
              ],
              // 音频流绝不能进预缓存或运行时缓存：单曲动辄几十 MB，
              // 而且 Range 请求与 SW 缓存配合很差。
              navigateFallbackDenylist: [/^\/rest\//, /^\/Audio\//],
            },
          }),
        ]),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // capacitor 模式不启用 VitePWA，虚拟模块不存在，Rollup 会在构建期解析失败。
      // 动态 import 的 catch 只兜得住运行时，兜不住构建，所以这里用别名顶一个空实现。
      ...(mode === 'capacitor'
        ? { 'virtual:pwa-register': path.resolve(__dirname, './src/lib/pwaRegisterStub.ts') }
        : {}),
    },
  },
  server: {
    // 默认仍是 5173（README、Tauri 的 devUrl、CI 都按这个端口写死）。
    // 端口被别的项目占住时用 PORT=5180 npm run dev 换一个，不必改配置文件。
    port: Number(process.env.PORT) || 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (/node_modules\/(react|react-dom|scheduler|use-sync-external-store|react-is)\//.test(id)) {
            return 'react-core'
          }
          // 必须匹配 react-router 而不是 react-router-dom：react-router-dom 只是
          // 一层再导出，绝大部分代码在 react-router 包里。此前这条规则匹配不到东西，
          // router 分块产物只有 1 字节，路由代码全落进了 vendor。
          if (/node_modules\/react-router(-dom)?\//.test(id)) return 'router'
          // 同理：@tanstack/react-query 的主体在 query-core 里
          if (id.includes('@tanstack/')) return 'react-query'
          if (id.includes('@radix-ui')) return 'radix-ui'
          return 'vendor'
        },
      },
    },
  },
}))
