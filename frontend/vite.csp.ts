import type { Plugin } from 'vite'

/**
 * 纯网页 / PWA / Docker 构建的完整 CSP。
 *
 * 以 src-tauri/tauri.conf.json 的 csp 为蓝本，去掉 Tauri 专用的 ipc: / http://ipc.localhost。
 * 用户的音乐服务器可能是任意 http / https 地址，所以 connect / media / img 必须放开到 http: https:。
 */
export const WEB_CSP = [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  'frame-src blob:',
  "form-action 'none'",
  "script-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self' http: https: ws: wss: data: blob:",
  "media-src 'self' http: https: blob: data:",
  "img-src 'self' http: https: data: blob:",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
].join('; ')

/** index.html 里那条只管 frame-src 的 meta（兜底策略） */
const FALLBACK_META = /(<meta\s+http-equiv="Content-Security-Policy"\s+content=")frame-src blob:(")/

/**
 * 只有「vite build、非 capacitor、非 Tauri」才换成完整策略：
 * 开发态 Vite 会注入内联脚本；老安卓 WebView 上 Capacitor 会往页面注入内联桥接脚本；
 * Tauri 自己管 CSP。这三种都保持 frame-src blob: 不变。
 */
export function applyWebCsp(
  html: string,
  opts: { command: 'build' | 'serve'; mode: string; tauri: boolean },
): string {
  if (opts.command !== 'build' || opts.mode === 'capacitor' || opts.tauri) return html
  return html.replace(FALLBACK_META, `$1${WEB_CSP}$2`)
}

export function webCspPlugin(mode: string): Plugin {
  let command: 'build' | 'serve' = 'serve'
  return {
    name: 'n1ko-web-csp',
    configResolved(config) {
      command = config.command
    },
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        return applyWebCsp(html, { command, mode, tauri: !!process.env.TAURI_ENV_PLATFORM })
      },
    },
  }
}
