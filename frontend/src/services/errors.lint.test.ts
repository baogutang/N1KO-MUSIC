/**
 * 阶段 2.7 的 lint 级测试：生产代码不得把原始 error.message 直接交给用户。
 *
 * 允许清单（这些位置的 message 是「自定义接口返回的文案」或 dev-only 调试输出，
 * 不是插件/网络层的原始报错）：
 *  - ScrobbleSettings：ListenBrainz 自定义接口的回执文案
 *  - QrLogin 的 DEV 块：import.meta.env.DEV 才显示
 *  - utils/redactUrl、services 内部 console：不进 UI
 * 若新增直出，会在此红灯——请改走 describeError / pluginErrorCode。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const srcRoot = resolve(__dirname, '..')

/** 递归收集生产 tsx 文件 */
function collectTsx(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) out.push(...collectTsx(full))
    else if (/\.tsx$/.test(name)) out.push(full)
  }
  return out
}

describe('原始 error.message 不直出界面（阶段 2.7）', () => {
  it('tsx 里没有 err instanceof Error ? err.message 直交 UI 的写法', () => {
    const offenders: string[] = []
    for (const file of collectTsx(srcRoot)) {
      const src = readFileSync(file, 'utf8')
      // 直出模式：message 直接进 setError / toast / description
      const pattern = /(?:setError\(|description:\s*|title:\s*)(?:err instanceof Error \? err\.message|\(err as Error\)\.message)/
      if (pattern.test(src)) offenders.push(file.replace(srcRoot, ''))
    }
    expect(offenders, `这些文件仍直出原始 message：\n${offenders.join('\n')}`).toEqual([])
  })

  it('鸭子取码 (e as { code }).code 只允许出现在 errors.ts 自身', () => {
    const offenders: string[] = []
    for (const file of collectTsx(srcRoot)) {
      if (file.includes('errors.ts')) continue
      const src = readFileSync(file, 'utf8')
      // 只禁 UI/适配器层的取码断言（useAudioEngine 的传参给 classifyStreamFailure 不算断言）
      if (/\.code\s*===\s*['"](?:unauthorized|forbidden|rate-limited)['"]/.test(src)
        && !file.includes('errors.ts')
        && !file.includes('QrLogin')
        && !file.includes('Search.tsx')) { // Search 比较的是 sectionFailures[].code（已是字符串，非鸭子取属性）
        offenders.push(file.replace(srcRoot, ''))
      }
    }
    expect(offenders, `这些文件仍在鸭子断言错误码：\n${offenders.join('\n')}`).toEqual([])
  })
})
