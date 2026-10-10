/**
 * 复审 A10 / A11 的静态不变量（官网与文案是构建产物外的静态文件，
 * 用 fs 直接核对仓库内文件）。
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = resolve(__dirname, '../../../')
const website = (p: string) => resolve(repoRoot, 'website', p)

describe('官网字体的相对 URL（A11：url 相对 css 自身解析）', () => {
  it('fonts.css 引用的每个 woff2 都真实存在（相对路径，不带 assets/fonts/ 前缀）', () => {
    const css = readFileSync(website('assets/fonts/fonts.css'), 'utf8')
    const urls = [...css.matchAll(/url\('([^']+)'\)/g)].map(m => m[1])
    expect(urls.length).toBeGreaterThanOrEqual(10)
    for (const url of urls) {
      expect(url.startsWith('assets/'), `${url} 仍是相对站点根的旧写法`).toBe(false)
      expect(existsSync(website(`assets/fonts/${url}`)), `${url} 文件不存在`).toBe(true)
    }
  })
})

describe('默认皮肤口径（A10：默认是奶油·软陶，不是糖果·波普）', () => {
  it('官网 hero 用软陶截图，文案不再出现「工坊/Workshop」', () => {
    const html = readFileSync(website('index.html'), 'utf8')
    expect(html).toContain('src="assets/home.png"')
    expect(html).not.toContain('工坊')
    const js = readFileSync(website('script.js'), 'utf8')
    expect(js).not.toContain('Workshop')
    expect(js).not.toContain('工坊')
    // hero 图注两语都标软陶为默认
    expect(js).toContain('奶油·软陶（默认皮肤）')
    expect(js).toContain('Soft Clay (default skin)')
  })
})
