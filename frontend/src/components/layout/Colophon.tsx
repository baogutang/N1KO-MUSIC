/**
 * 页脚版记。
 *
 * 一本刊物翻到底不该是「内容没了」，而该有一个收口：一条线、刊名、刊号、版本。
 * 它同时是最诚实的一块地方——版本号写在这里，用户不需要进设置去找自己在跑哪一版。
 *
 * 字号压到 10.5px、颜色压到 ink-faint：它是版记，不是内容，
 * 存在感应该刚好够「翻到这里知道结束了」。
 */

import { useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import { issueNumber } from '@/services/issueNumber'
import { useT } from '@/i18n'
import pkg from '../../../package.json'

/** 路径到栏目名的文案 key。找不到就不写栏目，不去猜。 */
const SECTION_KEYS: Array<[RegExp, string]> = [
  [/^\/$/, 'nav.home'],
  [/^\/library/, 'nav.library'],
  [/^\/albums\/[^/]+$/, 'section.albums'],
  [/^\/albums$/, 'section.albums'],
  [/^\/artists\/[^/]+$/, 'nav.artists'],
  [/^\/artists$/, 'nav.artists'],
  [/^\/playlists/, 'nav.playlists'],
  [/^\/recommendations/, 'nav.recommendations'],
  [/^\/favorites/, 'nav.favorites'],
  [/^\/history/, 'nav.history'],
  [/^\/stats/, 'nav.stats'],
  [/^\/issue/, 'nav.issue'],
  [/^\/search/, 'section.search'],
  [/^\/songs\//, 'nav.songDetail'],
  [/^\/settings/, 'nav.settings'],
]

export function sectionKeyFor(pathname: string): string | null {
  return SECTION_KEYS.find(([pattern]) => pattern.test(pathname))?.[1] ?? null
}

export function Colophon() {
  const { t } = useT()
  const { pathname } = useLocation()
  const issue = useMemo(() => issueNumber(), [])
  const sectionKey = sectionKeyFor(pathname)

  return (
    <footer className="mt-16 border-t border-hair pt-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1.5 text-[10.5px] tracking-[0.18em] text-ink-faint">
        <span className="font-sans font-semibold tracking-[0.3em] text-ink-soft">
          N1KO MUSIC
        </span>
        <span className="font-num">
          {issue.label}
          {sectionKey && <span className="ml-3 tracking-[0.18em]">· {t(sectionKey)}</span>}
        </span>
        <span className="font-num">v{pkg.version}</span>
      </div>
    </footer>
  )
}

/**
 * 书眉。
 *
 * 杂志的书眉在版心上沿，告诉你「翻到哪一栏了」。这里贴在导航行下方，
 * 滚动时随内容一起走——它不是第二条导航，只是一个位置提示。
 */
export function RunningHead() {
  const { t } = useT()
  const { pathname } = useLocation()
  const sectionKey = sectionKeyFor(pathname)
  const issue = useMemo(() => issueNumber(), [])
  if (!sectionKey) return null

  return (
    <div
      aria-hidden
      className="flex items-baseline justify-between gap-4 pt-3 text-[10px] tracking-[0.28em] text-ink-faint"
    >
      <span>{t(sectionKey)}</span>
      <span className="font-num">{issue.label}</span>
    </div>
  )
}
