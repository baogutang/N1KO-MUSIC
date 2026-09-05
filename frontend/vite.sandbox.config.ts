/**
 * 沙箱运行时的独立构建（PLAN 1.1）。
 *
 * 把 src/plugins/sandbox/runtime.ts 打成 public/plugin-sandbox.js（IIFE），
 * 由宿主以 blob: 文档加载进 opaque-origin iframe。crypto-js / dayjs / qs / he
 * 作为运行时依赖直接打进去；axios 与 big-integer 是 src/plugins/sandbox/shims/
 * 的自写兼容层。产物不进 git（.gitignore），predev / prebuild / pretest 自动重建。
 */

import { defineConfig, type Plugin } from 'vite'
import fs from 'node:fs'
import path from 'node:path'

/**
 * 构建后的语法自检（DECISIONS 2026-09-02「沙箱产物关闭 minify」里承诺的兜底）。
 *
 * 为什么单测拦不住：单测只 import 源码模块，从不执行构建产物。产物真正被执行
 * 是在 opaque-origin 的沙箱 iframe 里——那儿的 SyntaxError 只会表现成「插件
 * 永远不 ready」，要到浏览器走查才发现。`new Function(source)` 只解析不执行
 * （IIFE 的副作用不会跑），拿到的正是解析器的判断。
 */
export function assertSandboxSyntax(source: string, label = 'plugin-sandbox.js'): void {
  try {
    new Function(source)
  } catch (err) {
    throw new Error(
      `沙箱产物 ${label} 语法自检失败：${err instanceof Error ? err.message : String(err)}`
    )
  }
}

/** 构建结束后读产物做一次语法自检，失败就让构建红 */
export function sandboxSyntaxCheck(outFile: string): Plugin {
  return {
    name: 'n1ko-sandbox-syntax-check',
    closeBundle() {
      const source = fs.readFileSync(outFile, 'utf-8')
      assertSandboxSyntax(source, path.basename(outFile))
    },
  }
}

export default defineConfig({
  plugins: [sandboxSyntaxCheck(path.resolve(__dirname, 'public/plugin-sandbox.js'))],
  build: {
    lib: {
      entry: path.resolve(__dirname, 'src/plugins/sandbox/runtime.ts'),
      formats: ['iife'],
      name: 'N1koPluginSandbox',
      fileName: () => 'plugin-sandbox.js',
    },
    outDir: 'public',
    // public/ 里还有 PWA 图标等既有资产，绝不能清空
    emptyOutDir: false,
    sourcemap: false,
    // 不能压缩：he 包的实体表用「代理对转义串」做属性名（合法），esbuild 压缩
    // 会把它们去引号成星层字符裸标识符（如 𝕞）——ES 语法里非法，整份产物
    // 直接 SyntaxError（沙箱 iframe 里才暴露，浏览器走查抓到）。
    minify: false,
  },
})
