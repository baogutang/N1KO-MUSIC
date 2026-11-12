import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { WEB_CSP, applyWebCsp } from './vite.csp'

const html = fs.readFileSync(path.resolve(__dirname, 'index.html'), 'utf-8')
const web = { command: 'build' as const, mode: 'production', tauri: false }

describe('applyWebCsp', () => {
  it('源 index.html 里确有那条只管 frame-src 的 meta', () => {
    expect(html).toContain('content="frame-src blob:"')
  })

  it('纯网页构建：换成完整策略', () => {
    const out = applyWebCsp(html, web)
    expect(out).toContain(`content="${WEB_CSP}"`)
    expect(out).not.toContain('content="frame-src blob:"')
  })

  it('capacitor 模式不替换', () => {
    expect(applyWebCsp(html, { ...web, mode: 'capacitor' })).toBe(html)
  })

  it('Tauri 构建不替换', () => {
    expect(applyWebCsp(html, { ...web, tauri: true })).toBe(html)
  })

  it('开发态（serve）不替换', () => {
    expect(applyWebCsp(html, { ...web, command: 'serve' })).toBe(html)
  })

  it('策略保留沙箱的 frame-src blob:，并放开用户服务器所需的 http / https', () => {
    expect(WEB_CSP).toContain('frame-src blob:')
    for (const d of ['connect-src', 'media-src', 'img-src']) {
      expect(WEB_CSP).toMatch(new RegExp(`${d}[^;]*http: https:`))
    }
    expect(WEB_CSP).not.toContain('ipc')
  })
})
