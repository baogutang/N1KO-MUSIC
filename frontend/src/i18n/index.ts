/**
 * 极小的 i18n 运行时。
 *
 * 为什么不引 i18next：这个应用的需求只有「按 key 查一句话，可能带几个变量」。
 * i18next 及其 React 绑定要多带四十来 KB，换来的复数规则、命名空间、后端加载器
 * 在这里一个都用不上。多出来的每一 KB 都要在移动网络上被下载一次。
 *
 * 三条约定：
 *
 * 1. **zh-CN 是源语言**，也是唯一保证完整的那一份。其它语言缺哪句就回落到中文，
 *    再缺就显示 key 本身——让缺口在界面上看得见，而不是悄悄变成空白。
 * 2. **key 按「区域.主题」命名**（nav.home / player.play / settings.audio.title），
 *    这样 Weblate 里按前缀就能分组，译者不必猜一句话出现在哪。
 * 3. **不做复数规则**。中文没有复数；英文里真的需要时，写两个 key 由调用方选，
 *    比引入一套 ICU 语法诚实。
 */

import { useSyncExternalStore } from 'react'
import zhCN from './locales/zh-CN.json'
import enUS from './locales/en-US.json'

export type Locale = 'zh-CN' | 'en-US'
export type Catalog = Record<string, string>

export const LOCALES: Array<{ value: Locale; label: string }> = [
  { value: 'zh-CN', label: '简体中文' },
  { value: 'en-US', label: 'English' },
]

const CATALOGS: Record<Locale, Catalog> = {
  'zh-CN': zhCN as Catalog,
  'en-US': enUS as Catalog,
}

const STORAGE_KEY = 'msp-locale'
/** 源语言：永远完整，其它语言的回落目标 */
const SOURCE_LOCALE: Locale = 'zh-CN'

function detectLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'zh-CN' || saved === 'en-US') return saved
  } catch {
    // 隐私模式：按浏览器语言猜
  }
  const preferred = typeof navigator !== 'undefined' ? navigator.language : ''
  // zh、zh-Hans、zh-TW 都先落到简体：有繁体译文之前，中文界面好过英文界面
  return preferred.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US'
}

let currentLocale: Locale = detectLocale()
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

export function getLocale(): Locale {
  return currentLocale
}

export function setLocale(locale: Locale): void {
  if (locale === currentLocale) return
  currentLocale = locale
  try {
    localStorage.setItem(STORAGE_KEY, locale)
  } catch {
    // 存不下就只在本次会话生效
  }
  if (typeof document !== 'undefined') document.documentElement.lang = locale
  emit()
}

/**
 * 取一句话。
 *
 * vars 用 {name} 占位。缺失的变量原样留着占位符而不是替成 undefined——
 * 界面上出现一个 {count} 是明确的 bug 信号，出现 "undefined" 只会让人困惑。
 */
export function t(key: string, vars?: Record<string, string | number>): string {
  const template = CATALOGS[currentLocale][key]
    ?? CATALOGS[SOURCE_LOCALE][key]
    ?? key
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match)
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/**
 * 组件里用这个。
 *
 * 返回的 t 在切换语言时引用会变，因此 useMemo/useCallback 把它列进依赖就能
 * 正确地跟着重算。
 */
export function useT(): { t: typeof t; locale: Locale } {
  const locale = useSyncExternalStore(subscribe, getLocale, () => SOURCE_LOCALE)
  return { t, locale }
}

/** 供构建期脚本核对覆盖率：源语言有、目标语言没有的 key */
export function missingKeys(locale: Locale): string[] {
  const target = CATALOGS[locale]
  return Object.keys(CATALOGS[SOURCE_LOCALE]).filter(key => !(key in target))
}

if (typeof document !== 'undefined') document.documentElement.lang = currentLocale
