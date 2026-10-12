/**
 * 阶段 2.7 的 lint 级测试（复核 F13 重写）：生产代码不得把原始
 * error.message 直接交给用户，也不许用 `(e as { code }).code` 鸭子断言协议码。
 *
 * 复核 F13 修三处：
 *  - 扫描范围 .ts + .tsx（点名的鸭子取码多在 .ts：useAudioEngine / 适配器）；
 *  - 直出检测按「行里有 .message 且该行是 UI 汇点」匹配多种写法；
 *  - 豁免从「整文件」收敛为「行级清单」，QrLogin / Search 不再一刀切放行。
 * 若新增直出，会在此红灯——请改走 describeError / pluginErrorCode。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const srcRoot = resolve(__dirname, '..')

/** 递归收集生产源码文件（.ts/.tsx；测试与类型声明不算生产面） */
function collectSources(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) out.push(...collectSources(full))
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.[jt]sx?$/.test(name) && !/\.d\.ts$/.test(name)) out.push(full)
  }
  return out
}

/** UI 汇点：message 出现在这些语境里就是「要给用户看」 */
const UI_SINK = /(?:toast\(|description:\s|title:\s|setError\(|\.textContent\s*=)/

/** 行级豁免：文件 → 允许的行（含理由）。新增条目前先确认真的不进正式 UI */
const MESSAGE_LINE_ALLOWLIST: Array<{ file: RegExp; line: RegExp; why: string }> = [
  // ListenBrainz 自定义接口的回执文案（服务端写的用户语言，不是异常串）
  { file: /ScrobbleSettings\.tsx$/, line: /result\.message/, why: '自定义接口回执' },
  // DEV 块内的调试输出（import.meta.env.DEV 包裹，正式界面不渲染）
  { file: /TopListDetail\.tsx$/, line: /error instanceof Error \? error\.message/, why: 'DEV-only 调试' },
]

describe('原始 error.message 不直出界面（阶段 2.7 / 复核 F13）', () => {
  it('.ts/.tsx 里没有 message 直接进 UI 汇点的行（行级豁免除外）', () => {
    const offenders: string[] = []
    for (const file of collectSources(srcRoot)) {
      const rel = file.replace(srcRoot, '')
      const lines = readFileSync(file, 'utf8').split(/\r?\n/)
      lines.forEach((line, i) => {
        if (!/\.message\b/.test(line) || !UI_SINK.test(line)) return
        const allowed = MESSAGE_LINE_ALLOWLIST.some(
          a => a.file.test(rel) && a.line.test(line)
        )
        if (!allowed) offenders.push(`${rel}:${i + 1}: ${line.trim()}`)
      })
    }
    expect(offenders, `这些行仍把原始 message 交给 UI：\n${offenders.join('\n')}`).toEqual([])
  })

  it('鸭子取码 (e as { code }).code / 裸 .code===协议码 只允许出现在 errors.ts 自身', () => {
    const offenders: string[] = []
    for (const file of collectSources(srcRoot)) {
      const rel = file.replace(srcRoot, '')
      if (/services[\\/]errors\.ts$/.test(file)) continue
      const src = readFileSync(file, 'utf8')
      // 鸭子 cast 后取 code（instanceof PluginCallError 的类型化取码不算）
      if (/as\s*\{[^}]*\bcode\b[^}]*\}\s*\|?\s*null?\)?\.?\*?\)?\.?code/.test(src)
        || /\(\s*\w+\s+as\s+\{\s*code\??:/.test(src)) {
        offenders.push(`${rel}: 鸭子 cast 取 code`)
      }
      // 裸 .code 与协议码字面量比较。instanceof PluginCallError 的类型化取码不算；
      // Search 的 sectionFailures[].code 也是类型化字符串字段（zipQueryResults 产出），
      // 不是从抛出的错误上鸭子取属性——按行豁免，不再整文件放行
      const CODE_LINE_ALLOWLIST: Array<{ file: RegExp; line: RegExp; why: string }> = [
        { file: /pages[\\/]Search\.tsx$/, line: /sectionFailures|failures\.some/, why: '类型化字段 sectionFailures[].code' },
      ]
      const lines = src.split(/\r?\n/)
      lines.forEach((line, i) => {
        if (!/\.code\s*===\s*['"](?:unauthorized|forbidden|rate-limited|not-found)['"]/.test(line)) return
        if (/instanceof\s+PluginCallError/.test(line)) return
        const allowed = CODE_LINE_ALLOWLIST.some(a => a.file.test(rel) && a.line.test(line))
        if (!allowed) offenders.push(`${rel}:${i + 1}: ${line.trim()}`)
      })
    }
    expect(offenders, `这些文件仍在鸭子断言错误码：\n${offenders.join('\n')}`).toEqual([])
  })
})
