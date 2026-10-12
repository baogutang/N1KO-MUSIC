/** 阶段 3.4：非拉丁子集不进 SW 预缓存（文件名带 -subset- 标签才可被 globIgnores 区分） */
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const publicFonts = resolve(__dirname, '../../public/fonts')
const css = readFileSync(resolve(__dirname, './fonts.css'), 'utf8')

describe('字体子集标签（3.4）', () => {
  it('cyrillic/greek/vietnamese 子集文件都带 -subset- 标签', () => {
    const subsets = ['cyrillic-ext', 'cyrillic', 'greek', 'greek-ext', 'vietnamese']
    const referenced = [...css.matchAll(/url\((\/fonts\/([^)]+))\)/g)]
      .map(m => m[2])
      .filter(f => f.includes('-subset-'))
    // fonts.css 引用的子集文件全部带标签
    for (const f of referenced) expect(f).toMatch(/-subset-(cyrillic|greek|vietnamese)/)
    // 目录里非拉丁子集（按 @face 块的子集名）都改了名
    const cssSubsets = [...css.matchAll(/\/\* (\w[\w-]*) \*\/\s*@font-face/g)].map(m => m[1])
    for (const subset of subsets) {
      if (!cssSubsets.includes(subset)) continue
      const block = css.slice(css.indexOf(`/* ${subset} */`))
      const urls = [...block.slice(0, block.indexOf('/*', 10) > 0 ? block.indexOf('/*', 10) : block.length).matchAll(/url\(\/fonts\/([^)]+)\)/g)].map(m => m[1])
      for (const u of urls) expect(u).toContain('-subset-')
    }
  })

  it('fonts.css 引用的每个字体文件都存在', () => {
    const referenced = [...css.matchAll(/url\((?:[^)]*)?\/fonts\/([^)]+)\)/g)].map(m => m[1])
    expect(referenced.length).toBeGreaterThan(30)
    for (const f of referenced) {
      const exists = readdirSync(publicFonts).includes(f)
      expect(exists, `${f} 缺失`).toBe(true)
    }
  })
})
