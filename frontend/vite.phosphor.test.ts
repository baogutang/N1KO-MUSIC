import { describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { parseAst } from 'rollup/parseAst'
import { phosphorWeightStripPlugin, stripPhosphorWeights } from './vite.phosphor'

const DEFS = path.resolve(__dirname, 'node_modules/@phosphor-icons/react/dist/defs')
const read = (name: string) => fs.readFileSync(path.join(DEFS, `${name}.es.js`), 'utf-8')

/** 把定义文件当函数跑：e 换成一个只记录结构的假 React，取出默认导出的 Map */
function evalDefs(code: string): Map<string, unknown> {
  const exported = /export\s*\{\s*(\w+)\s+as\s+default\s*\}\s*;?/.exec(code)
  if (!exported) throw new Error('找不到默认导出')
  const ns = /import \* as (\w+) from ["']react["']/.exec(code)
  if (!ns) throw new Error('找不到 react 导入')
  const body = code
    .replace(/^import .*$/m, '')
    .replace(/export\s*\{[^}]*\}\s*;?/, '')
  const fakeReact = { Fragment: 'Fragment', createElement: (t: unknown, p: unknown, ...c: unknown[]) => ({ t, p, c }) }
  return new Function(ns[1], `${body}\nreturn ${exported[1]};`)(fakeReact) as Map<string, unknown>
}

const parse = (c: string) => parseAst(c)

describe('stripPhosphorWeights', () => {
  // Play：普通；Heart / Plus 之类 duotone 里有多个 path；Alarm 随便再挑一个
  for (const name of ['Play', 'Heart', 'Alarm', 'Acorn']) {
    it(`${name}：只剩 bold / fill / regular，路径数据与原文件一致`, () => {
      const original = read(name)
      const out = stripPhosphorWeights(original, parse)
      expect(out).not.toBeNull()
      const before = evalDefs(original)
      const after = evalDefs(out as string)
      expect([...after.keys()].sort()).toEqual(['bold', 'fill', 'regular'])
      for (const w of ['bold', 'fill', 'regular']) {
        expect(JSON.stringify(after.get(w))).toBe(JSON.stringify(before.get(w)))
      }
      // 确实瘦身了，且至少有一个 duotone 是多 path 的样本（Heart）
      expect((out as string).length).toBeLessThan(original.length)
    })
  }

  it('样本里确有 duotone 多 path 的图标（确保上面的断言覆盖到这种形状）', () => {
    const duotone = evalDefs(read('Heart')).get('duotone') as { c: unknown[] }
    expect(duotone.c.length).toBeGreaterThan(1)
  })

  it('找不到 Map：返回 null', () => {
    expect(stripPhosphorWeights('export default 1', parse)).toBeNull()
  })

  it('字重不齐（少一个）：返回 null，不动代码', () => {
    const broken = read('Play').replace('"thin"', '"hairline"')
    expect(stripPhosphorWeights(broken, parse)).toBeNull()
  })

  it('元素形状不对：返回 null', () => {
    const code = 'const a = new Map([["bold", 1], ["thin"], ["fill", 2], ["light", 3], ["regular", 4], ["duotone", 5]]);'
    expect(stripPhosphorWeights(code, parse)).toBeNull()
  })
})

describe('phosphorWeightStripPlugin', () => {
  const plugin = phosphorWeightStripPlugin()
  const transform = plugin.transform as (this: unknown, code: string, id: string) => unknown
  const ctx = () => ({ parse, warn: vi.fn() })

  it('只在 build 生效', () => {
    expect(plugin.apply).toBe('build')
  })

  it('命中 defs/*.es.js（含 query 与 Windows 路径分隔符）', () => {
    const c = ctx()
    const res = transform.call(c, read('Play'), '/x/node_modules/@phosphor-icons/react/dist/defs/Play.es.js?v=1') as { code: string }
    expect(res.code).not.toContain('"thin"')
    const win = transform.call(c, read('Play'), 'C:\\x\\node_modules\\@phosphor-icons\\react\\dist\\defs\\Play.es.js') as { code: string }
    expect(win.code).not.toContain('"duotone"')
    expect(c.warn).not.toHaveBeenCalled()
  })

  it('不相干的文件不碰', () => {
    const c = ctx()
    expect(transform.call(c, 'const a = new Map()', '/src/a.ts')).toBeNull()
    expect(transform.call(c, read('Play'), '/node_modules/@phosphor-icons/react/dist/csr/Play.es.js')).toBeNull()
  })

  it('结构对不上：原样放行并 warn 一次', () => {
    const c = ctx()
    const res = transform.call(c, 'export default 1', '/n/@phosphor-icons/react/dist/defs/X.es.js')
    expect(res).toBeNull()
    expect(c.warn).toHaveBeenCalledTimes(1)
  })

  it('解析抛错：同样原样放行并 warn 一次', () => {
    const c = { parse: () => { throw new Error('boom') }, warn: vi.fn() }
    expect(transform.call(c, read('Play'), '/n/@phosphor-icons/react/dist/defs/X.es.js')).toBeNull()
    expect(c.warn).toHaveBeenCalledTimes(1)
  })
})

describe('守卫：src 里不得使用被剥掉的字重', () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full, out)
      else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full)
    }
    return out
  }
  const files = walk(path.resolve(__dirname, 'src'))
  // 不写死换行：Windows 检出是 CRLF，按行拆时统一吃掉 \r
  const lines = files.flatMap(f =>
    fs.readFileSync(f, 'utf-8').split(/\r?\n/).map((text, i) => ({ where: `${path.relative(__dirname, f)}:${i + 1}`, text })),
  )

  it('没有 weight="thin" / weight={"light"} / weight: \'duotone\' 这类写法', () => {
    const re = /\bweight\s*[=:]\s*\{?\s*["'`](thin|light|duotone)["'`]/
    expect(lines.filter(l => re.test(l.text)).map(l => l.where)).toEqual([])
  })

  it('没有用 IconContext 全局改字重', () => {
    expect(lines.filter(l => /\bIconContext\b/.test(l.text)).map(l => l.where)).toEqual([])
  })

  it('扫描确实读到了文件（防止路径写错而空转）', () => {
    expect(files.length).toBeGreaterThan(100)
  })
})
