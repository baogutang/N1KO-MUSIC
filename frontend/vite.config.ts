import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [
    react(),
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
               * 浏览器里没有自定义协议，但 PWA 可以登记为 web+n1ko 的处理器。
               * 装成 PWA 之后，系统上的 web+n1ko:// 链接就会落到 /open?url=…，
               * 由 OpenLink 页解析并跳转——和原生壳的 n1ko:// 走同一套解析。
               */
              protocol_handlers: [
                { protocol: 'web+n1ko', url: '/open?url=%s' },
              ],
              icons: [
                {
                  src: 'pwa-192x192.png',
                  sizes: '192x192',
                  type: 'image/png',
                },
                {
                  src: 'pwa-512x512.png',
                  sizes: '512x512',
                  type: 'image/png',
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
    port: 5173,
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
