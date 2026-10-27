/**
 * 官网静态不变量（复审 A10 / A11 / B13；v5 起 A10 改为「只有一套暖纸」）。
 *
 * website/ 正由另一方并行改版（未提交的工作区改动不归本分支管）——
 * 这些断言核对的是**仓库里已提交的** website 文件；门禁在干净 worktree
 * 里跑（复核 F19：此前为迁就对方未提交的改动删掉了 A10/B13 两组断言，
 * 正确做法是把门禁挪进干净 worktree，而不是撤哨）。
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
    expect(urls.length).toBeGreaterThanOrEqual(4)
    for (const url of urls) {
      expect(url.startsWith('assets/'), `${url} 仍是相对站点根的旧写法`).toBe(false)
      expect(existsSync(website(`assets/fonts/${url}`)), `${url} 文件不存在`).toBe(true)
    }
  })
})

describe('v5 只有一套暖纸（A10 的后继：不再有皮肤，也不再有吉祥物）', () => {
  it('官网 hero 用 v5 截图，页面与脚本里没有换肤入口和旧皮肤名', () => {
    const html = readFileSync(website('index.html'), 'utf8')
    expect(html).toContain('src="assets/home.webp"')
    expect(existsSync(website('assets/home.webp'))).toBe(true)
    expect(html).not.toContain('data-skin')
    expect(html).not.toContain('工坊')
    const js = readFileSync(website('script.js'), 'utf8')
    expect(js).not.toContain('Workshop')
    expect(js).not.toContain('工坊')
    for (const legacy of ['软陶', '波普', 'Soft Clay', 'Candy Pop', 'SKIN_KEY']) {
      expect(html, legacy).not.toContain(legacy)
      expect(js, legacy).not.toContain(legacy)
    }
  })

  it('页面引用的每张截图都真实存在', () => {
    const html = readFileSync(website('index.html'), 'utf8')
    const js = readFileSync(website('script.js'), 'utf8')
    const refs = [...`${html}\n${js}`.matchAll(/assets\/[\w.-]+\.(?:webp|png|jpg)/g)].map(m => m[0])
    expect(refs.length).toBeGreaterThanOrEqual(8)
    for (const ref of new Set(refs)) {
      expect(existsSync(website(ref)), `${ref} 文件不存在`).toBe(true)
    }
  })
})

describe('官网词条完整性（复审 B13）', () => {
  it('sources.note 两种语言都是整句（不再被截成半句），HTML 默认文案与词条同形', () => {
    const js = readFileSync(website('script.js'), 'utf8')
    const zhEntry = /'sources\.note': '([^']+)'/.exec(js)?.[1] ?? ''
    // \s* 而不是 \n：Windows runner autocrlf 后是 \r\n（v1.11.7 Windows 构建曾在此红）
    const enEntry = /'sources\.note': '([^']+)',\s*'sandbox/.exec(js)?.[1] ?? ''
    expect(zhEntry.length).toBeGreaterThan(30)
    expect(enEntry.length).toBeGreaterThan(30)

    const html = readFileSync(website('index.html'), 'utf8')
    // 下载区默认文案含 xattr 引导（切不切语言都在）
    expect(html).toContain('xattr -cr "/Applications/N1KO MUSIC.app"')
    expect(js).toContain('xattr -cr')
  })
})
