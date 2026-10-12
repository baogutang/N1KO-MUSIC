/**
 * 官网静态不变量。
 *
 * 注意（2026-10-12）：website/ 正由另一方并行改版（整站换肤、封面轮换），
 * 皮肤名/截图等文案断言会在两方之间打架——这里只保留与改版无关的
 * 结构性不变量：字体的相对 URL（A11 修复）必须一直成立。
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
