/**
 * 全局测试设置（vite.config.ts 的 test.setupFiles）。
 *
 * 1. IS_REACT_ACT_ENVIRONMENT：不设的话 React 18 在每次 act() 时都会打一条
 *    "The current testing environment is not configured to support act(...)"，
 *    此前整套测试有近 400 条，把真正的警告淹没了。
 * 2. 预加载 en-US 语言包：运行时它是按需动态加载的，而大量测试同步地 setLocale('en-US')
 *    再断言英文文案；预加载后这些测试保持同步语义，不必逐个加 await。
 */
import { loadLocale } from '@/i18n'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

await loadLocale('en-US')
