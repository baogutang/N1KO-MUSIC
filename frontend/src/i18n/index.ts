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
import { STORAGE_KEYS } from '@/services/storageKeys'

export type Locale = 'zh-CN' | 'en-US'
export type Catalog = Record<string, string>

export const LOCALES: Array<{ value: Locale; label: string }> = [
  { value: 'zh-CN', label: '简体中文' },
  { value: 'en-US', label: 'English' },
]

/**
 * 已加载的语言包。zh-CN 同步静态打进入口（源语言 + 回落目标，必须随时可用）；
 * en-US 约 60 kB，中文用户用不到，按需动态加载（见 loadLocale）。
 */
const CATALOGS: Partial<Record<Locale, Catalog>> = {
  'zh-CN': zhCN as Catalog,
}

const LOADERS: Partial<Record<Locale, () => Promise<{ default: unknown }>>> = {
  'en-US': () => import('./locales/en-US.json'),
}

const loading = new Map<Locale, Promise<boolean>>()

/** 加载某个语言包；已加载直接返回 true，失败返回 false（下次可重试）。 */
export function loadLocale(locale: Locale): Promise<boolean> {
  if (CATALOGS[locale]) return Promise.resolve(true)
  const loader = LOADERS[locale]
  if (!loader) return Promise.resolve(false)
  const pending = loading.get(locale)
  if (pending) return pending
  const task = loader().then(
    mod => { CATALOGS[locale] = mod.default as Catalog; return true },
    () => false,
  ).finally(() => { loading.delete(locale) })
  loading.set(locale, task)
  return task
}

/** 未加载的语言按空表处理：查词会回落到中文 */
function catalogOf(locale: Locale): Catalog {
  return CATALOGS[locale] ?? {}
}

/** 源语言：永远完整，其它语言的回落目标 */
const SOURCE_LOCALE: Locale = 'zh-CN'

function detectLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.locale)
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

/** 最近一次想切到的语言：异步加载期间用户又改了主意时，丢弃过期的那次 */
let wanted: Locale = currentLocale

function applyLocale(locale: Locale): void {
  if (locale === currentLocale) return
  currentLocale = locale
  try {
    localStorage.setItem(STORAGE_KEYS.locale, locale)
  } catch {
    // 存不下就只在本次会话生效
  }
  if (typeof document !== 'undefined') document.documentElement.lang = locale
  emit()
}

/**
 * 切语言。语言包已在内存里就**同步**切换（调用方不必 await）；
 * 还没加载（en-US 首次）就先加载、加载完再切换并通知订阅者。加载失败则保持当前语言。
 */
export function setLocale(locale: Locale): Promise<void> {
  wanted = locale
  if (CATALOGS[locale]) {
    applyLocale(locale)
    return Promise.resolve()
  }
  return loadLocale(locale).then(ok => {
    if (ok && wanted === locale) applyLocale(locale)
  })
}

/**
 * 启动时用：等「检测到的语言」的语言包就绪。main.tsx 在首次渲染前 await 它，
 * 英文用户才不会先看到一屏中文再跳成英文。加载失败回落中文（不写入存储，下次启动重试），不抛错。
 */
export async function whenLocaleReady(): Promise<void> {
  const target = currentLocale
  if (CATALOGS[target]) return
  const ok = await loadLocale(target)
  if (ok) {
    emit()
    return
  }
  currentLocale = SOURCE_LOCALE
  wanted = SOURCE_LOCALE
  if (typeof document !== 'undefined') document.documentElement.lang = SOURCE_LOCALE
  emit()
}

/**
 * 取一句话。
 *
 * vars 用 {name} 占位。缺失的变量原样留着占位符而不是替成 undefined——
 * 界面上出现一个 {count} 是明确的 bug 信号，出现 "undefined" 只会让人困惑。
 */
export function t(key: string, vars?: Record<string, string | number>): string {
  return format(key, vars, currentLocale)
}

/**
 * 取词 + 单复数 + 插值，**唯一**的一份实现。
 *
 * 此前模块级的 t 和 useT() 返回的 bound 各写了一遍同样的逻辑。
 * 给 t 加单复数时只改了一处，而组件用的全是 useT()——机制加了、
 * 测试也绿了（测的是模块级 t），界面上却一个字没变。
 * 重复的实现迟早会分叉；合并成一份，就不可能只修一半。
 */
function format(
  key: string,
  vars: Record<string, string | number> | undefined,
  locale: Locale
): string {
  const template = translate(pluralKey(key, vars, locale), locale)
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match)
}

/**
 * 单复数。
 *
 * 中文没有复数形态，所以这套词表一直是单一形式，英文于是读成
 * 「1 tracks」「1 albums」「1 stars」——八处，全在计数最常出现的地方。
 *
 * 约定：给需要区分的键补一条 `<key>_one`，`count === 1` 时优先用它。
 * 没有 `_one` 的键行为完全不变，所以中文词表一个字都不用改，
 * 也不必为此引入 Intl.PluralRules 或任何运行时依赖。
 *
 * 只处理 1 与非 1：英文只有这一条界线。真要支持俄语那种多档形态时，
 * 再换成 Intl.PluralRules，而那时这个函数就是唯一要改的地方。
 */
function pluralKey(
  key: string,
  vars: Record<string, string | number> | undefined,
  locale: Locale
): string {
  if (!vars || vars.count === undefined) return key
  // 只有恰好为 1 才用单数。字符串 '1' 也算；NaN、小数、负数都走复数。
  if (Number(vars.count) !== 1) return key
  const singular = `${key}_one`
  return singular in catalogOf(locale) ? singular : key
}

/**
 * 查表。
 *
 * 用 `key in catalog` 而不是 `catalog[key] ?? fallback`：**空字符串是一种合法的译文**。
 * 中文的量词（「3 位歌手」的「位」、「5 张专辑」的「张」）在英文里根本不存在，
 * 正确的英文译文就是空。用 `??` 的话空串会被当成缺失、回落成中文，
 * 于是英文界面上会冒出一个「位」。
 */
function translate(key: string, locale: Locale): string {
  const own = catalogOf(locale)
  if (key in own) return own[key]
  const source = catalogOf(SOURCE_LOCALE)
  if (key in source) return source[key]
  return key
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/**
 * 组件里用这个。
 *
 * 返回的 t **每换一次语言就换一个引用**，因此把它放进 useMemo / useCallback 的
 * 依赖数组是有效的，切语言时依赖它的记忆值会跟着重算。
 * 这一点必须成立：模块级的那个 t 引用永远不变，直接把它列进依赖等于没列，
 * 记忆住的旧语言文案会一直留在界面上。
 */
const boundCache = new Map<Locale, typeof t>()
function boundT(locale: Locale): typeof t {
  const cached = boundCache.get(locale)
  if (cached) return cached
  const bound: typeof t = (key, vars) => format(key, vars, locale)
  boundCache.set(locale, bound)
  return bound
}

/** 仅供测试：拿到某个语言的 bound t，用来验证组件走的那条路径 */
export const boundTForTest = boundT

export function useT(): { t: typeof t; locale: Locale } {
  const locale = useSyncExternalStore(subscribe, getLocale, () => SOURCE_LOCALE)
  return { t: boundT(locale), locale }
}

/** 供构建期脚本核对覆盖率：源语言有、目标语言没有的 key（空串算已翻译） */
export function missingKeys(locale: Locale): string[] {
  const target = catalogOf(locale)
  return Object.keys(catalogOf(SOURCE_LOCALE)).filter(key => !(key in target))
}

if (typeof document !== 'undefined') document.documentElement.lang = currentLocale
