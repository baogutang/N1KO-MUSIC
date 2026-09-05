/**
 * 沙箱产物的构建后语法自检（vite.sandbox.config.ts 的 closeBundle 钩子）。
 *
 * 真实要防的那次事故：esbuild 压缩把 he 包的代理对转义属性名输出成裸星面
 * 字符，产物整份 SyntaxError（见 DECISIONS 2026-09-02）——而单测只测源码
 * 模块、从不执行产物，一路绿到浏览器走查才炸。这里钉住的就是「坏产物必须
 * 让构建红」这件事本身，不复刻当年那个具体字符（各引擎的标识符表在动）。
 */

import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import { assertSandboxSyntax, sandboxSyntaxCheck } from './vite.sandbox.config'

describe('assertSandboxSyntax', () => {
  it('合法产物通过', () => {
    expect(() => assertSandboxSyntax('(function(){ var a = 1; })()')).not.toThrow()
  })

  it('语法错误的产物抛错（构建随之失败）', () => {
    expect(() => assertSandboxSyntax('var = ;')).toThrow(/语法自检失败/)
    expect(() => assertSandboxSyntax('(function(){')).toThrow(/语法自检失败/)
    // 报错里带得上是哪个产物
    expect(() => assertSandboxSyntax('var = ;', 'x.js')).toThrow(/x\.js/)
  })

  it('只解析不执行：产物里的 IIFE 副作用不会跑', () => {
    const marker = '__n1ko_sandbox_syntax_check__'
    expect(() => assertSandboxSyntax(`globalThis.${marker} = 1`)).not.toThrow()
    expect((globalThis as Record<string, unknown>)[marker]).toBeUndefined()
  })

  it('closeBundle 钩子读产物做自检：坏产物让构建抛错，好产物放行', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'n1ko-sandbox-'))
    const bad = path.join(dir, 'bad.js')
    const good = path.join(dir, 'good.js')
    fs.writeFileSync(bad, 'var = ;')
    fs.writeFileSync(good, 'var a = 1')
    const run = (file: string) => {
      const hook = sandboxSyntaxCheck(file).closeBundle
      ;(hook as () => void)()
    }
    expect(() => run(bad)).toThrow(/语法自检失败/)
    expect(() => run(good)).not.toThrow()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('当前构建出的 public/plugin-sandbox.js 是合法语法（pretest 已重建）', () => {
    const file = path.resolve(fileURLToPath(new URL('.', import.meta.url)), 'public/plugin-sandbox.js')
    if (!fs.existsSync(file)) return // 未构建时跳过（CI 的 pretest 会先构建）
    expect(() => assertSandboxSyntax(fs.readFileSync(file, 'utf-8'))).not.toThrow()
  })
})
