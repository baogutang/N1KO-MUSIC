/**
 * 遥控器方向键导航（电视模式，lib/tv）。
 *
 * 电视上只有上下左右和确认。浏览器拿到方向键只会滚页面，所以电视模式下由这里接管：
 * 在当前这一层（最上面那个打开的对话框，没有就是整页）里，找那个方向上最近的可聚焦元素，
 * 把焦点挪过去，再把它滚进视野。确认键在 WebView 里就是 Enter，按钮自己会响应。
 *
 * 规则（和电视版 demo 一致）：
 * - 几何优先：候选必须真的在那个方向上，再比距离。左右走只认同一条「光束」里的（上下有重叠）：
 *   一排的最后一张往右是轻推，不会斜着跳到下面某一排去；只有进出导航条可以离开光束
 * - 一排记住上次停在哪：[data-nav-group] 是一排（书架、导航条），从外面进来时回到上次那一个；
 *   排里带 [data-nav-preferred] 的元素（导航条上的当前页）优先于记忆
 * - [data-nav-contain="y"]：上下键不离开这一排（导航条走到底不会掉进内容里）
 * - [data-nav-enter="x"]：只能横着进这一排（导航条：内容区里按上下不会掉进去）；
 *   从这一排横着出去时回到进来之前停的那个元素
 * - [data-nav-w]：按这个宽度算元素的框（导航条收起时只露出图标那一截，标签在框外）
 * - [data-nav-noauto]：进页面 / 焦点丢了时不落在这里（吸顶工具栏在 DOM 里排在内容前面）
 * - 一组选项（tablist / radiogroup / [data-nav-options]）：从外面进来落在选中的那一项上
 * - [data-nav-last]：从外面进来时排在所有候选后面（工具栏右上角的「正在播放」：
 *   往上走先到页面顶上的标签、按钮，上面真没东西了才到它）
 * - 书架里滚出可视区的卡，从书架外面看不见（只能沿着书架走过去）
 * - 书架（[data-nav-shelf] 滚动容器）左对齐：焦点卡停在书架左边，后面的卡往前挪
 * - 行内动作：[data-nav-row] 是一行（歌曲行）。焦点在行上按右进入行内按钮，在行内左右走，
 *   走到最左再按左回到行本身；上下直接换行
 * - 嵌在别的可聚焦元素里的控件（封面卡上的播放键）不当候选：卡片本身就是那个焦点
 * - 方向键属于控件自己时让路：菜单、沿着方向的滑块、光标没到头的文本框、[data-nav-own]
 * - 走到头轻推一下（.tv-bump-*），焦点不会掉出去
 */

export type NavDir = 'up' | 'down' | 'left' | 'right'

export interface Rect {
  left: number
  top: number
  right: number
  bottom: number
}

const KEY_TO_DIR: Record<string, NavDir> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
}

export function dirForKey(key: string): NavDir | null {
  return KEY_TO_DIR[key] ?? null
}

const isHorizontal = (dir: NavDir) => dir === 'left' || dir === 'right'

/* ---------------- 纯几何（单测覆盖） ---------------- */

/**
 * to 是否在 from 的 dir 方向上。
 * 近边必须越过 from 的远边——但给一点余量：焦点元素放大了 6%，它的框会伸进邻居的缝里。
 * 中心也必须在那一侧，防止两个大面积重叠的框互相算作「在下面」。
 */
export function isInDirection(from: Rect, to: Rect, dir: NavDir): boolean {
  const slackX = Math.min(16, (from.right - from.left) * 0.3)
  const slackY = Math.min(16, (from.bottom - from.top) * 0.3)
  const fcx = (from.left + from.right) / 2
  const fcy = (from.top + from.bottom) / 2
  const tcx = (to.left + to.right) / 2
  const tcy = (to.top + to.bottom) / 2
  switch (dir) {
    case 'down': return to.top >= from.bottom - slackY && tcy > fcy
    case 'up': return to.bottom <= from.top + slackY && tcy < fcy
    case 'right': return to.left >= from.right - slackX && tcx > fcx
    case 'left': return to.right <= from.left + slackX && tcx < fcx
  }
}

/**
 * 越小越近。主方向的缝 + 正交方向偏出光束的距离（权重 3：偏出光束比远一点更糟），
 * 光束内再按中心对齐程度微调，让正下方那个赢过斜下方那个。
 */
export function navDistance(from: Rect, to: Rect, dir: NavDir): number {
  let gap: number
  let orthGap: number
  let centerOffset: number
  if (isHorizontal(dir)) {
    gap = dir === 'right' ? to.left - from.right : from.left - to.right
    const overlap = Math.min(from.bottom, to.bottom) - Math.max(from.top, to.top)
    orthGap = overlap > 0 ? 0 : to.top > from.bottom ? to.top - from.bottom : from.top - to.bottom
    centerOffset = Math.abs((to.top + to.bottom) / 2 - (from.top + from.bottom) / 2)
  } else {
    gap = dir === 'down' ? to.top - from.bottom : from.top - to.bottom
    const overlap = Math.min(from.right, to.right) - Math.max(from.left, to.left)
    orthGap = overlap > 0 ? 0 : to.left > from.right ? to.left - from.right : from.left - to.right
    centerOffset = Math.abs((to.left + to.right) / 2 - (from.left + from.right) / 2)
  }
  return Math.max(0, gap) + orthGap * 3 + centerOffset * 0.05
}

/** 左右走时 to 和 from 在不在同一条光束里（上下有重叠）；上下走不限 */
export function inBeam(from: Rect, to: Rect, dir: NavDir): boolean {
  if (!isHorizontal(dir)) return true
  return Math.min(from.bottom, to.bottom) - Math.max(from.top, to.top) > 0
}

/** 在候选里挑 dir 方向上最近的一个；没有返回 -1 */
export function pickNearest(from: Rect, candidates: Rect[], dir: NavDir): number {
  let best = -1
  let bestScore = Infinity
  candidates.forEach((rect, i) => {
    if (!isInDirection(from, rect, dir)) return
    const score = navDistance(from, rect, dir)
    if (score < bestScore) {
      bestScore = score
      best = i
    }
  })
  return best
}

/* ---------------- DOM ---------------- */

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(',')

const TEXT_INPUT_TYPES = new Set(['text', 'search', 'url', 'email', 'password', 'tel', 'number'])

function toRect(r: DOMRect): Rect {
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
}

/** 导航用的框：[data-nav-w] 覆盖宽度（从左边量） */
function navRect(el: HTMLElement): Rect {
  const rect = toRect(el.getBoundingClientRect())
  const width = Number(el.dataset.navW)
  if (width > 0) rect.right = rect.left + width
  return rect
}

/** 书架外面看书架里的卡：只算露在书架可视区里的那一截，完全滚出去的返回 null */
function visibleFrom(el: HTMLElement, rect: Rect, current: HTMLElement): Rect | null {
  const shelf = el.closest<HTMLElement>('[data-nav-shelf]')
  if (!shelf || shelf.contains(current)) return rect
  const box = shelf.getBoundingClientRect()
  const left = Math.max(rect.left, box.left)
  const right = Math.min(rect.right, box.right)
  return right - left < 1 ? null : { ...rect, left, right }
}

/** 只能横着进的那一排（导航条） */
function gateOf(el: HTMLElement): HTMLElement | null {
  return el.closest<HTMLElement>('[data-nav-enter]')
}

function isShown(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect()
  if (r.width < 1 || r.height < 1) return false
  const check = (el as HTMLElement & { checkVisibility?: (o?: object) => boolean }).checkVisibility
  if (check) return check.call(el, { checkOpacity: true, checkVisibilityCSS: true })
  return getComputedStyle(el).visibility !== 'hidden'
}

/** 跳过的：[data-nav-skip] 子树、inert 子树、aria-hidden 子树 */
function isExcluded(el: HTMLElement): boolean {
  return !!el.closest('[data-nav-skip], [inert], [aria-hidden="true"]')
}

/** 离它最近的、本身也可聚焦的祖先（嵌套控件的「主人」） */
function ownerOf(el: HTMLElement, scope: HTMLElement): HTMLElement | null {
  let node = el.parentElement
  while (node && node !== scope) {
    if (node.matches(FOCUSABLE)) return node
    node = node.parentElement
  }
  return null
}

/** 当前这一层：最上面那个打开的对话框（Radix 的门户按打开顺序追加在 body 末尾），没有就是整页 */
export function navScope(): HTMLElement {
  const layers = document.querySelectorAll<HTMLElement>(
    '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]'
  )
  return layers.length ? layers[layers.length - 1] : document.body
}

/** 方向键是不是属于焦点控件自己 */
export function arrowOwnedByControl(el: HTMLElement, dir: NavDir): boolean {
  const axis = isHorizontal(dir) ? 'x' : 'y'
  const own = el.closest<HTMLElement>('[data-nav-own]')
  if (own) {
    const value = own.dataset.navOwn
    if (value === 'xy' || value === axis) return true
  }
  if (el.closest('[role="menu"], [role="menubar"]')) return true
  if (el.getAttribute('role') === 'combobox') return axis === 'y'
  if (el.getAttribute('role') === 'slider') {
    const vertical = el.getAttribute('aria-orientation') === 'vertical'
    return vertical ? axis === 'y' : axis === 'x'
  }
  if (el.isContentEditable || el.tagName === 'TEXTAREA') return true
  if (el.tagName === 'SELECT') return axis === 'y'
  if (el instanceof HTMLInputElement) {
    if (el.type === 'range') return axis === 'x'
    if (!TEXT_INPUT_TYPES.has(el.type) || axis === 'y') return false
    // 光标在中间时左右键移动光标；到头了才把焦点交出去
    const start = el.selectionStart
    const end = el.selectionEnd
    if (start === null || end === null) return false
    if (start !== end) return true
    return dir === 'left' ? start > 0 : start < el.value.length
  }
  return false
}

interface Candidate {
  el: HTMLElement
  rect: Rect
}

const OPTION_SET = '[role="tablist"], [role="radiogroup"], [data-nav-options]'
const SELECTED_OPTION = '[aria-selected="true"], [aria-checked="true"], [aria-current="page"]'

/** 分组记忆：每一排最后停过的元素 */
const groupMemory = new WeakMap<HTMLElement, HTMLElement>()
/** 进导航条之前停的那个元素：从导航条横着出去时回到它 */
let lastOutside: HTMLElement | null = null

function groupOf(el: HTMLElement): HTMLElement | null {
  return el.closest<HTMLElement>('[data-nav-group]')
}

export function rememberFocus(el: HTMLElement): void {
  const group = groupOf(el)
  if (group) groupMemory.set(group, el)
  if (!gateOf(el)) lastOutside = el
}

function collect(scope: HTMLElement, exclude: HTMLElement | null): HTMLElement[] {
  return Array.from(scope.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(el => el !== exclude && !isExcluded(el))
}

/**
 * 从 current 往 dir 走，下一个该拿焦点的元素；走到头返回 null。
 */
export function findNext(current: HTMLElement, dir: NavDir, scope: HTMLElement = navScope()): HTMLElement | null {
  const fromRect = navRect(current)
  const row = current.closest<HTMLElement>('[data-nav-row]')
  const insideRow = row && row !== current ? row : null
  const group = groupOf(current)
  const contained = group?.dataset.navContain?.includes(isHorizontal(dir) ? 'x' : 'y') ? group : null
  const gate = gateOf(current)

  const all = collect(scope, current)

  /** 嵌套控件只在自己那一行里可达：焦点在那一行上，或在同一行的别的按钮上 */
  const eligible = (el: HTMLElement): boolean => {
    const owner = ownerOf(el, scope)
    if (!owner) return true
    return owner.hasAttribute('data-nav-row') && (owner === current || owner === insideRow)
  }

  /** 只能横着进的那一排，从外面按上下进不去 */
  const enterable = (el: HTMLElement): boolean => {
    const target = gateOf(el)
    if (!target || target === gate) return true
    return target.dataset.navEnter === (isHorizontal(dir) ? 'x' : 'y')
  }

  const choose = (pool: HTMLElement[], from: Rect): HTMLElement | null => {
    const cands: Candidate[] = []
    for (const el of pool) {
      const rect = visibleFrom(el, navRect(el), current)
      if (!rect || rect.right - rect.left < 1 || rect.bottom - rect.top < 1) continue
      if (!isInDirection(from, rect, dir) || !enterable(el)) continue
      // 离开光束只为进出导航条
      if (!inBeam(from, rect, dir) && !gate && !gateOf(el)) continue
      cands.push({ el, rect })
    }
    const lastResort = (el: HTMLElement) => {
      const last = el.closest('[data-nav-last]')
      return !!last && !last.contains(current)
    }
    const score = (c: Candidate) => (lastResort(c.el) ? 1e7 : 0) + (inBeam(from, c.rect, dir) ? 0 : 1e6) + navDistance(from, c.rect, dir)
    cands.sort((a, b) => score(a) - score(b))
    for (const c of cands) {
      if (eligible(c.el) && isShown(c.el)) return c.el
    }
    return null
  }

  // 行内左右走：只在这一行的按钮之间；最左边再往左回到行本身
  if (insideRow && isHorizontal(dir)) {
    const siblings = all.filter(el => el !== insideRow && insideRow.contains(el))
    const hit = choose(siblings, fromRect)
    if (hit) return hit
    return dir === 'left' ? insideRow : null
  }

  // 焦点在行上按右：从行的左边缘起找行内第一个按钮
  if (row === current && dir === 'right') {
    const inner = all.filter(el => current.contains(el))
    const edge: Rect = { left: fromRect.left, right: fromRect.left, top: fromRect.top, bottom: fromRect.bottom }
    const hit = choose(inner, edge)
    if (hit) return hit
  }

  // 从导航条横着出去：回到进来之前停的那个
  if (gate && isHorizontal(dir) && lastOutside && lastOutside.isConnected && scope.contains(lastOutside)
    && !isExcluded(lastOutside) && isShown(lastOutside)) {
    const rect = navRect(lastOutside)
    if (isInDirection(fromRect, rect, dir) && rect.bottom > 0 && rect.top < window.innerHeight) return lastOutside
  }

  const pool = contained ? all.filter(el => contained.contains(el)) : all
  const best = choose(pool, fromRect)
  if (!best) return null

  // 进入一组选项（分段控件、标签）：落在选中的那一项上，不是几何上最近的那一项
  const options = best.closest<HTMLElement>(OPTION_SET)
  if (options && !options.contains(current)) {
    const selected = options.querySelector<HTMLElement>(SELECTED_OPTION)
    if (selected && !isExcluded(selected) && isShown(selected)) return selected
  }

  // 进入另一排：当前页那一项优先，其次回到这一排上次停的位置
  const target = groupOf(best)
  if (target && target !== group) {
    const preferred = target.querySelector<HTMLElement>('[data-nav-preferred]')
    if (preferred && preferred !== current && !isExcluded(preferred) && isShown(preferred)) return preferred
    const remembered = groupMemory.get(target)
    if (remembered && remembered.isConnected && target.contains(remembered) && !isExcluded(remembered) && isShown(remembered)) {
      const rect = visibleFrom(remembered, navRect(remembered), current)
      if (rect && isInDirection(fromRect, rect, dir)) return remembered
    }
  }
  return best
}

/**
 * 没有焦点时（刚进页面、焦点所在的元素被换掉）落到哪：
 * 这一层里的 [data-tv-autofocus]，其次是内容区（main）里第一个看得见的，最后是这一层第一个。
 */
export function initialFocusTarget(scope: HTMLElement = navScope()): HTMLElement | null {
  // [data-nav-noauto]（吸顶工具栏）：DOM 里排在内容前面，但不该是进页面时的落点
  const visible = (el: HTMLElement) => !isExcluded(el) && !el.closest('[data-nav-noauto]') && isShown(el) && ownerOf(el, scope) === null
  const auto = Array.from(scope.querySelectorAll<HTMLElement>('[data-tv-autofocus]')).find(visible)
  if (auto) return auto
  const inViewport = (el: HTMLElement) => {
    const r = el.getBoundingClientRect()
    return r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth
  }
  const main = scope === document.body ? document.querySelector<HTMLElement>('main') : null
  for (const root of main ? [main, scope] : [scope]) {
    const hit = collect(root, null).find(el => visible(el) && inViewport(el))
    if (hit) return hit
  }
  return null
}

/* ---------------- 滚进视野 ---------------- */

function scrollerOf(el: HTMLElement, axis: 'x' | 'y'): HTMLElement | null {
  let node = el.parentElement
  while (node && node !== document.body) {
    // 书架只横着滚：overflow-x:auto 会把 overflow-y 也算成 auto，焦点卡放大时它会多出几像素「可纵向滚动」
    if (axis === 'y' && node.hasAttribute('data-nav-shelf')) {
      node = node.parentElement
      continue
    }
    const style = getComputedStyle(node)
    const overflow = axis === 'x' ? style.overflowX : style.overflowY
    if ((overflow === 'auto' || overflow === 'scroll')
      && (axis === 'x' ? node.scrollWidth > node.clientWidth : node.scrollHeight > node.clientHeight)) {
      return node
    }
    node = node.parentElement
  }
  return null
}

function px(value: string): number {
  const n = parseFloat(value)
  return Number.isFinite(n) ? n : 0
}

/**
 * 纵向：焦点放到滚动区中间（电视上内容往上走，焦点留在视线中央）。
 * 横向：书架左对齐到它的 scroll-padding；别的横向滚动区只滚到刚好看见。
 */
export function revealFocused(el: HTMLElement, instant = false): void {
  // 吸顶 / 固定的那几块（电视工具栏）本来就一直在视野里，滚动区不该为它们动
  if (el.closest('[data-nav-noscroll]')) return
  const behavior: ScrollBehavior = instant || window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
  const rect = el.getBoundingClientRect()

  const xScroller = scrollerOf(el, 'x')
  if (xScroller) {
    const box = xScroller.getBoundingClientRect()
    const style = getComputedStyle(xScroller)
    const padStart = px(style.scrollPaddingLeft) || px(style.paddingLeft)
    let delta = 0
    if (xScroller.hasAttribute('data-nav-shelf')) delta = rect.left - (box.left + padStart)
    else if (rect.left < box.left + padStart) delta = rect.left - (box.left + padStart)
    else if (rect.right > box.right - padStart) delta = rect.right - (box.right - padStart)
    if (Math.abs(delta) > 1) xScroller.scrollTo({ left: xScroller.scrollLeft + delta, behavior })
  }

  const yScroller = scrollerOf(el, 'y')
  if (yScroller) {
    const box = yScroller.getBoundingClientRect()
    const delta = (rect.top + rect.bottom) / 2 - (box.top + box.bottom) / 2
    if (Math.abs(delta) > 1) yScroller.scrollTo({ top: yScroller.scrollTop + delta, behavior })
  }
}

/* ---------------- 轻推 ---------------- */

function bump(el: HTMLElement, dir: NavDir): void {
  const cls = `tv-bump-${dir}`
  el.classList.remove('tv-bump-up', 'tv-bump-down', 'tv-bump-left', 'tv-bump-right')
  void el.offsetWidth
  el.classList.add(cls)
  window.setTimeout(() => el.classList.remove(cls), 320)
}

/* ---------------- 安装 ---------------- */

/**
 * 在方向键导航之前先看按键的人（全屏播放器的「闲置」：控件淡出后第一下按键只是把它们叫回来）。
 * 返回 true 表示这一下被吃掉了：不挪焦点、不传给任何人。
 */
type KeyInterceptor = (e: KeyboardEvent) => boolean
const interceptors = new Set<KeyInterceptor>()

export function addNavInterceptor(fn: KeyInterceptor): () => void {
  interceptors.add(fn)
  return () => { interceptors.delete(fn) }
}

function focusAndReveal(el: HTMLElement, instant: boolean): void {
  el.focus({ preventScroll: true })
  rememberFocus(el)
  revealFocused(el, instant)
}

/** 焦点落到 body 上（元素被换掉、对话框关了）时，把它接回来 */
export function restoreFocus(): void {
  const active = document.activeElement
  const scope = navScope()
  if (active && active !== document.body && active.isConnected && scope.contains(active)) return
  const target = initialFocusTarget(scope)
  if (target) focusAndReveal(target, true)
}

/**
 * 装上方向键导航，返回卸载函数。捕获阶段挂在 window 上：比 React 的根监听器、
 * 全局快捷键都先拿到按键；接管了就 stopPropagation，没人会再拿它去快进。
 */
export function installSpatialNav(): () => void {
  const onKeyDown = (e: KeyboardEvent) => {
    for (const fn of interceptors) {
      if (fn(e)) {
        e.preventDefault()
        e.stopPropagation()
        return
      }
    }
    const dir = dirForKey(e.key)
    if (!dir || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.defaultPrevented) return
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (active && active !== document.body && arrowOwnedByControl(active, dir)) return

    const scope = navScope()
    e.preventDefault()
    e.stopPropagation()

    if (!active || active === document.body || !scope.contains(active) || active === scope) {
      const target = initialFocusTarget(scope)
      if (target) focusAndReveal(target, true)
      return
    }
    const next = findNext(active, dir, scope)
    if (next) focusAndReveal(next, e.repeat)
    else bump(active, dir)
  }

  const onFocusIn = (e: FocusEvent) => {
    if (e.target instanceof HTMLElement) rememberFocus(e.target)
  }

  /* 焦点所在的元素被卸载时浏览器不发任何事件，焦点悄悄回到 body——遥控器上就再也看不见焦点了。
     focusout 之后过一拍看一眼，落空了就接回来 */
  let pending = 0
  const onFocusOut = () => {
    window.clearTimeout(pending)
    pending = window.setTimeout(restoreFocus, 60)
  }
  const observer = new MutationObserver(() => {
    const active = document.activeElement
    if (!active || active === document.body) {
      window.clearTimeout(pending)
      pending = window.setTimeout(restoreFocus, 60)
    }
  })
  observer.observe(document.body, { childList: true, subtree: true })

  window.addEventListener('keydown', onKeyDown, true)
  document.addEventListener('focusin', onFocusIn)
  document.addEventListener('focusout', onFocusOut)
  return () => {
    window.removeEventListener('keydown', onKeyDown, true)
    document.removeEventListener('focusin', onFocusIn)
    document.removeEventListener('focusout', onFocusOut)
    observer.disconnect()
    window.clearTimeout(pending)
  }
}
