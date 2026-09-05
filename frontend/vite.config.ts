import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import fs from 'node:fs'
import dns from 'node:dns'
import http from 'node:http'
import https from 'node:https'
import { VitePWA } from 'vite-plugin-pwa'
import { isHostAllowed, isPrivateHost } from './src/plugins/host/whitelist'

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

/** manifest 的插件 id 形状（PROTOCOL §2）；同时兼作路径穿越防护 */
const PLUGIN_ID_RE = /^[a-z][a-z0-9-]{1,31}$/

/** 服务端最多跟随几跳（与宿主侧 hostFetch 的 MAX_REDIRECT_HOPS 一致） */
export const PROXY_MAX_HOPS = 5

/**
 * 请求本身够不够格进代理（与转发目标无关的那一半校验）。
 * 通过返回 null，否则返回拒绝原因。中间件与单测共用同一份判断。
 *
 * 三条一起看才成立：自定义头强制跨源走预检（这个端点不回 CORS 头，预检必败）；
 * Origin 必须是本 dev server 自己；Content-Type 限 JSON 顺带排除表单式简单请求。
 */
export function proxyRequestGuard(headers: {
  'x-n1ko-proxy'?: string | string[]
  origin?: string
  host?: string
  'sec-fetch-site'?: string | string[]
  'content-type'?: string | string[]
}): string | null {
  if (headers['x-n1ko-proxy'] !== '1') return 'missing X-N1KO-Proxy header'
  const origin = headers.origin
  const selfHost = headers.host
  if (!origin || !selfHost) return 'missing Origin'
  try {
    if (new URL(origin).host !== selfHost) return 'cross-origin request refused'
  } catch {
    return 'bad Origin'
  }
  const fetchSite = headers['sec-fetch-site']
  if (typeof fetchSite === 'string' && fetchSite !== 'same-origin') return 'cross-site request refused'
  if (!String(headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
    return 'expected application/json'
  }
  return null
}

/**
 * 该插件放行的域名：只认 plugins/<id>/manifest.json 里的 hosts。
 *
 * 此前白名单是从请求体里读的——拿调用方给的名单校验调用方给的地址，
 * 等于没有校验。名单必须来自服务端自己能读到的事实。
 */
export function pluginHostsFromDisk(pluginsRoot: string, pluginId: string): string[] {
  if (!PLUGIN_ID_RE.test(pluginId)) return []
  const file = path.resolve(pluginsRoot, pluginId, 'manifest.json')
  // 双保险：id 正则已排除 ../，解析后的路径仍必须落在 plugins/ 内
  if (!file.startsWith(pluginsRoot + path.sep)) return []
  try {
    const manifest = JSON.parse(fs.readFileSync(file, 'utf-8')) as { hosts?: unknown }
    if (!Array.isArray(manifest.hosts)) return []
    return manifest.hosts.filter((h): h is string => typeof h === 'string')
  } catch {
    return []
  }
}

/**
 * DNS 解析后再判一次私网：hostname 字面判定挡不住「公网域名 A 记录指向
 * 192.168.x.x」这种写法。dev 代理是本机上唯一能真正打到内网的一环，
 * 这道必须有。（解析与连接之间的 rebinding 窗口这里不处理——dev-only。）
 */
export async function resolvesToPrivateAddress(targetUrl: string): Promise<boolean> {
  let hostname: string
  try {
    hostname = new URL(targetUrl).hostname
  } catch {
    return true
  }
  const bare = hostname.replace(/^\[/, '').replace(/\]$/, '')
  try {
    const addresses = await dns.promises.lookup(bare, { all: true })
    return addresses.some(a => isPrivateHost(a.address))
  } catch {
    // 解析不了就别发：拿不准的目标一律不转
    return true
  }
}

/** 跨主机跳转时必须剥掉的请求头 */
const CREDENTIAL_HEADERS = ['cookie', 'authorization']

function stripCredentialHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).filter(([k]) => !CREDENTIAL_HEADERS.includes(k.toLowerCase()))
  )
}

export type ProxyHopResult =
  | { blocked: string }
  | { status: number; headers: Record<string, string>; buf: Buffer }

/**
 * 逐跳转发：一律用 nodeRequestNoRedirect（不跟随 3xx），每一跳先过白名单
 * 与 DNS 私网判定。fetch 的自动跟随会把校验丢在第一跳——白名单主机上的
 * 开放重定向由此能把请求带进内网。
 */
export async function proxyWithHops(
  startUrl: string,
  method: string,
  headers: Record<string, string>,
  body: string | null,
  allowList: readonly string[],
  follow: boolean,
  /** 单测替身：默认走 nodeRequestNoRedirect（真的发一跳） */
  send: typeof nodeRequestNoRedirect = nodeRequestNoRedirect,
): Promise<ProxyHopResult> {
  let url = startUrl
  let currentMethod = method
  let currentHeaders = headers
  let currentBody = body

  for (let hop = 0; ; hop++) {
    if (!isHostAllowed(url, allowList)) return { blocked: 'host not allowed' }
    if (await resolvesToPrivateAddress(url)) return { blocked: 'target resolves to a private address' }

    const res = await send(url, currentMethod, currentHeaders, currentBody)
    if (!follow) return res
    const location = res.headers['location']
    if (!location || res.status < 300 || res.status >= 400) return res
    if (hop >= PROXY_MAX_HOPS) return { blocked: 'too many redirects' }

    let next: string
    try {
      next = new URL(location, url).toString()
    } catch {
      return { blocked: 'bad redirect location' }
    }
    if (new URL(next).host !== new URL(url).host) currentHeaders = stripCredentialHeaders(currentHeaders)
    if (res.status === 303 || ((res.status === 301 || res.status === 302) && currentMethod.toUpperCase() === 'POST')) {
      currentMethod = 'GET'
      currentBody = null
      currentHeaders = Object.fromEntries(
        Object.entries(currentHeaders).filter(([k]) => !['content-type', 'content-length'].includes(k.toLowerCase()))
      )
    }
    url = next
  }
}

/**
 * 开发态插件代理中间件：/__n1ko_proxy（POST JSON）。
 *
 * 浏览器里插件请求被 CORS 拦住，开发态经 dev server 转发。这是本机上唯一
 * 一个「替调用方出网」的端点，所以调用方给的任何东西都不能当凭据用：
 *  - 白名单按 body 里的 pluginId 从 plugins/<id>/manifest.json 读（不是 body 给的名单）；
 *  - 必须带自定义头 X-N1KO-Proxy: 1（跨源带它就得先过预检，别的页面发不出来）；
 *  - Origin 必须是本 dev server 自己（Sec-Fetch-Site 也顺带查一眼）；
 *  - Content-Type 必须是 application/json（挡掉表单式的简单请求）；
 *  - 目标 DNS 解析到私网一律拒绝，3xx 逐跳复检（见 proxyWithHops）。
 *
 * 只存在于 dev server，不进任何构建产物，也不落盘任何请求内容。
 */
function n1koPluginProxyMiddleware(): Plugin {
  const pluginsRoot = path.resolve(__dirname, '../plugins')
  return {
    name: 'n1ko-plugin-proxy',
    configureServer(server) {
      server.middlewares.use('/__n1ko_proxy', async (req, res, next) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end('POST only')
          return
        }
        const deny = (message: string) => {
          res.statusCode = 403
          res.end(message)
        }
        const refusal = proxyRequestGuard(req.headers as Parameters<typeof proxyRequestGuard>[0])
        if (refusal) return deny(refusal)
        try {
          const chunks: Buffer[] = []
          for await (const chunk of req) chunks.push(chunk as Buffer)
          const { url, pluginId, method, headers, body, redirect } = JSON.parse(Buffer.concat(chunks).toString('utf-8')) as {
            url?: string; pluginId?: string; method?: string
            headers?: Record<string, string>; body?: string | null
            redirect?: 'follow' | 'manual'
          }
          // 白名单来自磁盘上的 manifest，不是调用方给的名单
          const allowList = pluginHostsFromDisk(pluginsRoot, pluginId ?? '')
          if (!allowList.length) return deny('unknown pluginId')
          if (!url) return deny('missing url')

          const outcome = await proxyWithHops(
            url,
            method ?? 'GET',
            headers ?? {},
            body ?? null,
            allowList,
            // manual：不跟随，3xx 原样回给宿主（QQ 登录读 Location，见 nodeRequestNoRedirect）
            redirect !== 'manual',
          )
          if ('blocked' in outcome) return deny(outcome.blocked)

          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({
            status: outcome.status,
            headers: outcome.headers,
            bodyBase64: outcome.buf.toString('base64'),
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

/**
 * 正式构建把 plugins/ 随包打进 dist/plugins/，出厂目录就是同源的 /plugins/catalog.json。
 *
 * 为什么不指向 GitHub raw：国内网络对 raw.githubusercontent.com 时通时不通，
 * 离线首启更是一定失败——首启种子只跑一次，失败就意味着装好的 App 里一个
 * 音源都没有。随包打进去的插件和 App 版本严格一致、离线可用、也不引入
 * 一个能远程换代码的地址。插件升级随 App 发版，与 `plugins/catalog.json`
 * 的版本字段一起走内置自动更新（pluginStore.autoUpdateBuiltins）。
 *
 * 只打目录里列出的条目（Mock 等开发夹具不在目录里，自然不进包）；
 * 目录或某个插件文件缺失时直接让构建失败——静默少打一个音源比构建红更糟。
 */
function n1koBundlePlugins(): Plugin {
  const pluginsRoot = path.resolve(__dirname, '../plugins')
  return {
    name: 'n1ko-bundle-plugins',
    apply: 'build',
    generateBundle() {
      const catalogPath = path.join(pluginsRoot, 'catalog.json')
      const catalogText = fs.readFileSync(catalogPath, 'utf-8')
      const catalog = JSON.parse(catalogText) as Array<{ id: string; manifest: string }>
      this.emitFile({ type: 'asset', fileName: 'plugins/catalog.json', source: catalogText })
      for (const entry of catalog) {
        const manifestRel = entry.manifest.replace(/^\/+/, '')
        const manifestPath = path.resolve(pluginsRoot, manifestRel)
        if (!manifestPath.startsWith(pluginsRoot + path.sep)) {
          throw new Error(`plugins/catalog.json 条目 ${entry.id} 的 manifest 路径越出 plugins/：${entry.manifest}`)
        }
        const manifestText = fs.readFileSync(manifestPath, 'utf-8')
        const manifest = JSON.parse(manifestText) as { entry: string }
        const codePath = path.resolve(path.dirname(manifestPath), manifest.entry)
        if (!codePath.startsWith(pluginsRoot + path.sep)) {
          throw new Error(`插件 ${entry.id} 的 entry 越出 plugins/：${manifest.entry}`)
        }
        const toBundlePath = (abs: string) => 'plugins/' + path.relative(pluginsRoot, abs).split(path.sep).join('/')
        this.emitFile({ type: 'asset', fileName: toBundlePath(manifestPath), source: manifestText })
        this.emitFile({ type: 'asset', fileName: toBundlePath(codePath), source: fs.readFileSync(codePath, 'utf-8') })
      }
    },
  }
}

export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [
    react(),
    n1koPluginProxyMiddleware(),
    n1koPluginCatalogMiddleware(),
    n1koBundlePlugins(),
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
