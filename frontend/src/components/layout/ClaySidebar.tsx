/**
 * 软陶皮的左侧导航面板（DESIGN v4）。
 *
 * 为什么要有这个文件——换皮本该是纯 CSS 的事，组件不该知道当前是哪张皮。
 * 这条原则在颜色、形状、投影上都成立，唯独在**版面骨架**上不成立：
 * 编辑风与波普是「顶部报头 + 一行横导航」的杂志骨架，软陶是「左侧一块竖面板」
 * 的仪表盘骨架。这不是同一份 DOM 换套样式能到达的差别——横导航是 <ul> 一行，
 * 竖导航每项还要带一枚图标砖。硬用 CSS 把横的转成竖的，会得到一份两边都别扭
 * 的结构。所以这里认一次皮肤，只认这一次：MainLayout 按 skin 选择渲染
 * TopNav 还是本组件，其余一切照旧。
 *
 * 图标砖的配色刻意用 --src-1..5 这套粉彩装饰色而不是语义色：
 * 它们在这里只是「让每一项有自己的颜色」，不承载任何状态含义。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { NavLink } from 'react-router-dom'
import {
  House, MusicNotes, MicrophoneStage, Playlist,
  Sparkle, Heart, ChartBar, Newspaper,
} from '@phosphor-icons/react'
import type { Icon } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import { prefetchRoute } from '@/routes/lazyRoutes'
import { useT } from '@/i18n'

/**
 * 与 TopNav 同一份路由表，顺序保持一致；额外给每项一枚图标与一个色档。
 *
 * 色档写成完整类名而不是 `clay-tone-${n}` 拼出来：`.clay-tone-*` 定义在
 * index.css 的 `@layer components` 里，而 Tailwind 只会保留在源码里**字面出现过**
 * 的 components 类——拼接出来的名字它扫不到，规则会被整条清掉，
 * 于是砖全是透明的（这个坑踩过一次）。
 */
const navItems: Array<{ to: string; labelKey: string; icon: Icon; tone: string }> = [
  { to: '/', labelKey: 'nav.home', icon: House, tone: 'clay-tone-1' },
  { to: '/library', labelKey: 'nav.library', icon: MusicNotes, tone: 'clay-tone-2' },
  { to: '/artists', labelKey: 'nav.artists', icon: MicrophoneStage, tone: 'clay-tone-3' },
  { to: '/playlists', labelKey: 'nav.playlists', icon: Playlist, tone: 'clay-tone-4' },
  { to: '/recommendations', labelKey: 'nav.recommendations', icon: Sparkle, tone: 'clay-tone-5' },
  { to: '/favorites', labelKey: 'nav.favorites', icon: Heart, tone: 'clay-tone-1' },
  { to: '/stats', labelKey: 'nav.stats', icon: ChartBar, tone: 'clay-tone-2' },
  { to: '/issue', labelKey: 'nav.issue', icon: Newspaper, tone: 'clay-tone-3' },
]

/**
 * 按本地时段选一句问候。
 *
 * 词条 key 写成字面量返回而不是拼 `mascot.greeting.${slot}`：
 * i18n 的死条目检查靠源码全文匹配 `'key'`，拼出来的它看不见，
 * 四句问候会被判成没有调用方（和 settings.skin.* 那次同一个坑）。
 */
/**
 * 戳一下会说的话。同样是字面量数组而不是拼 key——理由见 greetingKey。
 */
const CHAT_KEYS = [
  'mascot.chat.1',
  'mascot.chat.2',
  'mascot.chat.3',
  'mascot.chat.4',
] as const

export function greetingKey(): string {
  const hour = new Date().getHours()
  if (hour < 5) return 'mascot.greeting.night'
  if (hour < 11) return 'mascot.greeting.morning'
  if (hour < 18) return 'mascot.greeting.afternoon'
  return 'mascot.greeting.evening'
}

export function ClaySidebar() {
  const { t } = useT()

  return (
    <nav
      className="clay-sidebar flex-shrink-0"
      aria-label={t('nav.main')}
      /* 侧栏面板之间的空白也能拖窗口：软陶版面里顶栏很窄，只靠它不够顺手 */
      data-tauri-drag-region
    >
      <ul className="clay-sidebar-list">
        {navItems.map(({ to, labelKey, icon: IconComponent, tone }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={to === '/'}
              onMouseEnter={() => prefetchRoute(to)}
              onFocus={() => prefetchRoute(to)}
              onTouchStart={() => prefetchRoute(to)}
              className={({ isActive }) => cn('clay-nav-item', isActive && 'is-on')}
            >
              {/* 图标砖：粉彩底的小方块，当前项翻成主色实底 */}
              <span aria-hidden className={cn('clay-nav-tile', tone)}>
                <IconComponent size={17} weight="fill" />
              </span>
              <span className="clay-nav-label">{t(labelKey)}</span>
            </NavLink>
          </li>
        ))}
      </ul>

      <MascotCard />
    </nav>
  )
}

/**
 * 侧栏底部的一句话，对应参考里那块「Go Premium」的位置。
 *
 * 这里原本是一整张吉祥物卡片（92px 的阿糯 + 问候 + 副标）。首页有了问候
 * 横幅之后它必须缩：横幅里那只是 120px 的主角，侧栏底下再站一只，
 * 同屏两只阿糯——不是「更可爱」，是分不清哪只在说话。
 * 所以图撤掉，只留问候一行；性格靠「戳一下会换句话」保住，
 * 这一下比插画本身更能说明它是活的。
 */
function MascotCard() {
  const { t } = useT()
  const [hop, setHop] = useState(false)
  const [chat, setChat] = useState(-1)
  const hopTimer = useRef<number | null>(null)

  // 卸载时清掉在途的定时器，否则快速切皮肤/路由会对着已卸载的组件 setState
  useEffect(() => () => {
    if (hopTimer.current !== null) window.clearTimeout(hopTimer.current)
  }, [])

  const poke = useCallback(() => {
    setChat(index => (index + 1) % CHAT_KEYS.length)
    setHop(true)
    if (hopTimer.current !== null) window.clearTimeout(hopTimer.current)
    hopTimer.current = window.setTimeout(() => setHop(false), 620)
  }, [])

  // 说过话就一直显示那句；没戳过就按时段问候
  const line = chat < 0 ? greetingKey() : CHAT_KEYS[chat]

  return (
    <button
      type="button"
      className={cn('clay-mascot-card clay-mascot-hit', hop && 'is-hop')}
      onClick={poke}
      aria-label={t('mascot.poke', { name: t('mascot.name') })}
    >
      <span className="clay-mascot-line">{t(line)}</span>
    </button>
  )
}
