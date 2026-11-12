import type { Plugin } from 'vite'

/**
 * 构建期剥掉 Phosphor 图标里用不到的字重。
 *
 * 为什么：`@phosphor-icons/react/dist/defs/<Name>.es.js` 每个图标都是
 * `new Map([["bold", …], ["duotone", …], ["fill", …], ["light", …], ["regular", …], ["thin", …]])`，
 * 六种字重全带，tree-shaking 管不到 Map 里的条目。项目设计只用 regular / fill / bold，
 * 94 个图标的 thin / light / duotone 白白占了 vendor 包三分之二。
 *
 * 为什么走 AST 而不是正则：定义文件里嵌着任意多层 createElement 与括号，
 * 正则切错一处就是语法错误的产物。这里按数组元素的源码区间重组；
 * 任何一步和预期对不上，一律原样返回并 warn 一次，宁可多带几 KB 也不产出坏代码。
 *
 * 守卫：src 下出现 weight="thin" 等写法会被 vite.phosphor.test.ts 的扫描测试拦下，
 * 否则被剥掉的字重在界面上只会表现为图标悄悄消失。
 */

export const STRIPPED_WEIGHTS = ['thin', 'light', 'duotone'] as const
const EXPECTED_WEIGHTS = ['bold', 'duotone', 'fill', 'light', 'regular', 'thin']

const DEFS_RE = /@phosphor-icons\/react\/dist\/defs\/[^/]+\.es\.js$/

/** 只用到的那一小块 ESTree 形状；不引 estree 类型包 */
interface AstNode {
  type: string
  start: number
  end: number
  [key: string]: unknown
}

function isNode(value: unknown): value is AstNode {
  return typeof value === 'object' && value !== null && typeof (value as AstNode).type === 'string'
}

/** 深度优先找第一个 `new Map(...)` */
function findNewMap(node: unknown): AstNode | null {
  if (Array.isArray(node)) {
    for (const item of node) {
      const hit = findNewMap(item)
      if (hit) return hit
    }
    return null
  }
  if (!isNode(node)) return null
  if (node.type === 'NewExpression') {
    const callee = node.callee
    if (isNode(callee) && callee.type === 'Identifier' && callee.name === 'Map') return node
  }
  for (const key of Object.keys(node)) {
    if (key === 'type' || key === 'start' || key === 'end') continue
    const hit = findNewMap(node[key])
    if (hit) return hit
  }
  return null
}

/** 条目 `["bold", …]` 的 key；形状不对返回 null */
function entryKey(el: unknown): string | null {
  if (!isNode(el) || el.type !== 'ArrayExpression') return null
  const items = el.elements
  if (!Array.isArray(items) || items.length !== 2) return null
  const first = items[0]
  if (!isNode(first) || first.type !== 'Literal' || typeof first.value !== 'string') return null
  return first.value
}

export interface PhosphorContext {
  parse: (code: string) => unknown
  warn: (message: string) => void
}

/**
 * 纯函数：返回剥掉之后的代码；对不上预期返回 null（调用方原样放行）。
 * 抛错也视为对不上，由 transform 兜成 warn。
 */
export function stripPhosphorWeights(code: string, parse: PhosphorContext['parse']): string | null {
  const ast = parse(code)
  const map = findNewMap(ast)
  if (!map) return null
  const args = map.arguments
  if (!Array.isArray(args) || args.length !== 1) return null
  const arr = args[0]
  if (!isNode(arr) || arr.type !== 'ArrayExpression' || !Array.isArray(arr.elements)) return null

  const entries = arr.elements as unknown[]
  const keys = entries.map(entryKey)
  if (keys.some(k => k === null)) return null
  // 六种字重必须一个不多一个不少，否则说明上游格式变了
  if ([...(keys as string[])].sort().join() !== EXPECTED_WEIGHTS.join()) return null

  const kept = entries.filter((_, i) => !(STRIPPED_WEIGHTS as readonly string[]).includes(keys[i] as string)) as AstNode[]
  const body = kept.map(el => code.slice(el.start, el.end)).join(',\n')
  // 数组括号内整体换成保留下来的元素
  return `${code.slice(0, arr.start + 1)}\n${body}\n${code.slice(arr.end - 1)}`
}

export function phosphorWeightStripPlugin(): Plugin {
  return {
    name: 'n1ko-phosphor-strip-weights',
    apply: 'build',
    enforce: 'post',
    transform(this: PhosphorContext, code: string, id: string) {
      const clean = id.split('?')[0].replace(/\\/g, '/')
      if (!DEFS_RE.test(clean)) return null
      try {
        const out = stripPhosphorWeights(code, c => this.parse(c))
        if (out === null) {
          this.warn(`[phosphor-strip] ${clean} 的结构和预期不符，已原样保留（未剥字重）`)
          return null
        }
        return { code: out, map: null }
      } catch (e) {
        this.warn(`[phosphor-strip] ${clean} 解析失败，已原样保留：${e instanceof Error ? e.message : String(e)}`)
        return null
      }
    },
  }
}
