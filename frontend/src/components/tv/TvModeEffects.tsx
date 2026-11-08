/**
 * 电视模式的全局副作用（lib/tv）。挂在 BrowserRouter 里、所有路由之外：登录页也要能用遥控器。
 *
 * - <html data-tv>：index.css 的电视焦点样式（墨白反相）、隐藏书架翻页键都挂在它上面
 * - 方向键导航（lib/spatialNav）
 * - 真电视上把布局视口钉在 960 宽：各家盒子的屏幕密度从 1 到 2 都有，
 *   不钉的话同一套界面在有的电视上是正常大小，在有的上只有一半
 * - 第一次在电视上打开时换成深色（只换一次）：客厅里关着灯看电视，一整屏白太刺眼
 * - 换页后把焦点放进内容区：返回时回到离开前的那个元素，前进时落到 [data-tv-autofocus]
 * - 浏览器里（没有遥控器的返回键）Esc 当返回键用，方便在电脑上调试
 */

import { useEffect, useLayoutEffect, useRef } from 'react'
import { useLocation, useNavigate, useNavigationType, type NavigateFunction } from 'react-router-dom'
import { App } from '@capacitor/app'
import { useTvMode, isTvDevice, isTvModeActive } from '@/lib/tv'
import { installSpatialNav, initialFocusTarget, revealFocused, rememberFocus } from '@/lib/spatialNav'
import { isNativePlatform } from '@/lib/platform'
import { STORAGE_KEYS } from '@/services/storageKeys'
import { useThemeStore } from '@/store/themeStore'
import { usePlayerStore } from '@/store/playerStore'
import { toast } from '@/components/ui/use-toast'
import { t } from '@/i18n'

/** 电视的布局视口宽度：1080p 电视在 2 倍密度下本来就是 960 × 540 */
const TV_VIEWPORT_WIDTH = 960

/** 导航条上的一级入口：在这些页上按返回，先回导航条，再回首页，最后才退出 */
export const TV_TOP_LEVEL = new Set(['/', '/search', '/recommendations', '/library', '/playlists', '/favorites', '/settings'])

/** react-router v7 在 history.state.idx 里记着当前条目的序号 */
function historyIndex(): number {
  const idx = (window.history.state as { idx?: number } | null)?.idx
  return typeof idx === 'number' ? idx : 0
}

let exitArmedUntil = 0

/**
 * 页面层的返回（对话框、全屏播放器、队列这些浮层由调用方先处理掉）：
 *   页面上有自己的「返回」键（[data-tv-back]，登录的分步）→ 按它
 *   详情页      → 后退一页（没得退就回首页）
 *   一级页内容  → 焦点回到导航条
 *   导航条上    → 不在首页就回首页；在首页（或登录页）就「再按一次退出」
 */
export function handleTvBack(navigate: NavigateFunction): void {
  const pageBack = document.querySelector<HTMLElement>('[data-tv-back]')
  if (pageBack && pageBack.getClientRects().length > 0) {
    pageBack.click()
    return
  }
  const pathname = window.location.pathname
  const root = pathname === '/' || pathname === '/login'
  if (!root && !TV_TOP_LEVEL.has(pathname)) {
    if (historyIndex() > 0) navigate(-1)
    else navigate('/', { replace: true })
    return
  }
  const active = document.activeElement
  const rail = document.querySelector<HTMLElement>('[data-tv-rail]')
  if (rail && !(active instanceof HTMLElement && rail.contains(active))) {
    const current = rail.querySelector<HTMLElement>('[data-nav-preferred]') ?? rail.querySelector<HTMLElement>('a[href]')
    current?.focus()
    return
  }
  if (!root) {
    navigate('/')
    return
  }
  const now = performance.now()
  if (now < exitArmedUntil) {
    exitArmedUntil = 0
    if (isNativePlatform) void App.minimizeApp()
    return
  }
  exitArmedUntil = now + 2200
  toast({ title: t('tv.pressBackAgain') })
}

/**
 * 返回键先问一下焦点所在的组件要不要自己处理（全屏播放器的「接下来」那一排：返回是收起那一排，不是关播放器）。
 * 组件在 n1ko:back 上 preventDefault 就算接住了。
 */
export function dispatchBackToFocused(): boolean {
  const target = document.activeElement ?? document.body
  const event = new CustomEvent('n1ko:back', { bubbles: true, cancelable: true })
  target.dispatchEvent(event)
  return event.defaultPrevented
}

/** 菜单（Radix DropdownMenu）开着：返回键先关菜单 */
export function closeOpenMenu(): boolean {
  if (!document.querySelector('[role="menu"][data-state="open"]')) return false
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  return true
}

function setViewport(content: string | null): string | null {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]')
  if (!meta) return null
  const previous = meta.content
  if (content !== null) meta.content = content
  return previous
}

/** 当前路由下内容区里所有可聚焦元素（顺序就是文档顺序），用来记「离开时停在第几个」 */
function contentFocusables(): HTMLElement[] {
  const main = document.querySelector('main')
  if (!main) return []
  return Array.from(main.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"]), input:not([disabled])'))
}

export function TvModeEffects() {
  const tv = useTvMode()
  const location = useLocation()
  const navigationType = useNavigationType()
  const navigate = useNavigate()

  useEffect(() => {
    document.documentElement.toggleAttribute('data-tv', tv)
    if (!tv) return
    const uninstall = installSpatialNav()

    // 只在真电视的原生壳里钉视口（电脑浏览器里强制打开电视模式时，meta viewport 本来就不生效）
    let previousViewport: string | null = null
    if (isNativePlatform && isTvDevice()) {
      previousViewport = setViewport(`width=${TV_VIEWPORT_WIDTH}, user-scalable=no, viewport-fit=cover`)
    }

    // 第一次在这台电视上打开：换成深色。只换这一次，之后用户自己改成浅色就一直是浅色
    if (isTvDevice()) {
      try {
        if (!localStorage.getItem(STORAGE_KEYS.tvThemeDefaulted)) {
          localStorage.setItem(STORAGE_KEYS.tvThemeDefaulted, '1')
          if (useThemeStore.getState().theme !== 'dark') useThemeStore.getState().setTheme('dark')
        }
      } catch {
        // 存不下：不换，免得每次启动都把用户的浅色改回去
      }
    }

    return () => {
      uninstall()
      if (previousViewport !== null) setViewport(previousViewport)
      document.documentElement.removeAttribute('data-tv')
    }
  }, [tv])

  /* 浏览器里 Esc 当返回键。捕获阶段先看一眼：有对话框 / 菜单 / 全屏播放器时让 Radix 自己用 Esc 关，这里不插手 */
  useEffect(() => {
    if (!tv || isNativePlatform) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      if (dispatchBackToFocused()) { e.preventDefault(); e.stopPropagation(); return }
      const player = usePlayerStore.getState()
      if (document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="menu"]')
        || player.isFullscreen || player.isQueueOpen || player.isCarMode) return
      e.preventDefault()
      handleTvBack(navigate)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [tv, navigate])

  /* 登录页不在 MainLayout 里，原生返回键没人接（useNativeAppIntegration 挂在 MainLayout）：
     系统默认会直接退出 App，填连接信息时按返回就丢了这一页。电视上由这里接 */
  const onLogin = location.pathname === '/login'
  useEffect(() => {
    if (!tv || !isNativePlatform || !onLogin) return
    const handle = App.addListener('backButton', () => {
      if (dispatchBackToFocused() || closeOpenMenu()) return
      if (document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]')) {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        return
      }
      handleTvBack(navigate)
    })
    return () => {
      handle.then(h => h.remove()).catch(() => {})
    }
  }, [tv, onLogin, navigate])

  /* 换页：一直记着这一页焦点停在第几个元素（换页那一刻旧页已经被换掉，那时再看就晚了）；
     新页渲染出来后把焦点放进去 */
  const savedIndex = useRef(new Map<string, number>())
  const currentKey = useRef(location.key)
  useLayoutEffect(() => { currentKey.current = location.key }, [location.key])
  useEffect(() => {
    if (!tv) return
    const onFocusIn = (e: FocusEvent) => {
      if (!(e.target instanceof HTMLElement)) return
      // 菜单比电视屏幕高时在里面滚（index.css）：Radix 挪焦点不带滚动，焦点项要自己滚进来
      if (e.target.closest('[role="menu"]')) {
        e.target.scrollIntoView({ block: 'nearest' })
        return
      }
      const main = document.querySelector('main')
      if (!main?.contains(e.target)) return
      const index = contentFocusables().indexOf(e.target)
      if (index >= 0) savedIndex.current.set(currentKey.current, index)
    }
    document.addEventListener('focusin', onFocusIn)
    return () => document.removeEventListener('focusin', onFocusIn)
  }, [tv])

  useEffect(() => {
    if (!isTvModeActive()) return
    const back = navigationType === 'POP' ? savedIndex.current.get(location.key) : undefined
    let typed = false
    const onKey = () => { typed = true }
    window.addEventListener('keydown', onKey, true)

    const started = performance.now()
    let timer = 0
    const focus = (el: HTMLElement) => {
      el.focus({ preventScroll: true })
      rememberFocus(el)
      revealFocused(el, true)
    }
    const place = () => {
      timer = 0
      // 用户已经按过键了（自己在挪焦点），或者等了 3 秒内容还没出来：不再插手
      if (typed || performance.now() - started > 3000) return
      const schedule = () => { timer = window.setTimeout(place, 120) }
      const main = document.querySelector<HTMLElement>('main')
      // 浮层开着（播放器、对话框）：焦点归它们管
      if (!main || usePlayerStore.getState().isFullscreen || document.querySelector('[role="dialog"][data-state="open"]')) {
        schedule()
        return
      }
      const target = (back !== undefined ? contentFocusables()[back] : undefined)
        ?? main.querySelector<HTMLElement>('[data-tv-autofocus]')
      if (target) {
        if (target !== document.activeElement) focus(target)
        return
      }
      // 还没有明确的落点（内容在加载，或者这一页没标 autofocus）：至少让焦点在内容区里，接着等
      const active = document.activeElement
      if (!(active instanceof HTMLElement) || !main.contains(active)) {
        const first = initialFocusTarget(document.body)
        if (first && main.contains(first)) focus(first)
      }
      schedule()
    }
    timer = window.setTimeout(place, 60)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [location.key, navigationType])

  return null
}
