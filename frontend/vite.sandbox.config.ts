/**
 * 沙箱运行时的独立构建（PLAN 1.1）。
 *
 * 把 src/plugins/sandbox/runtime.ts 打成 public/plugin-sandbox.js（IIFE），
 * 由宿主以 blob: 文档加载进 opaque-origin iframe。crypto-js / dayjs / qs / he
 * 作为运行时依赖直接打进去；axios 与 big-integer 是 src/plugins/sandbox/shims/
 * 的自写兼容层。产物不进 git（.gitignore），predev / prebuild / pretest 自动重建。
 */

import { defineConfig } from 'vite'
import path from 'node:path'

export default defineConfig({
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
