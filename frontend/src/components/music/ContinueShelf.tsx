/**
 * 继续听。
 *
 * 长音轨（现场全集、DJ set、有声书、播客）听到一半关掉，下次回来只能凭记忆
 * 拖进度条找位置。断点本身早就在写了——useLongTrackBookmark 会把位置存到
 * 服务器的 Subsonic bookmark 上，跨设备可见——缺的只是一个「从这里接着听」
 * 的入口。
 *
 * 三条克制：
 *   1. 服务器不支持书签就整栏不出现（不是显示一个空板块）；
 *   2. 一条断点都没有也不出现——空着的板块比没有板块更伤；
 *   3. 已经听到尾声的（>95%）不列出来，那不叫「没听完」。
 */

import { useQuery } from '@tanstack/react-query'
import { Play } from '@phosphor-icons/react'
import { getAdapter } from '@/api'
import { useServerStore } from '@/store/serverStore'
import { useServerCapabilities } from '@/hooks/useServerCapabilities'
import { seekHowl } from '@/hooks/useAudioEngine'
import { playListFrom } from '@/utils/playActions'
import { formatDuration } from '@/utils/formatters'
import { spaceCJK } from '@/utils/cjkTypography'
import { useT } from '@/i18n'

/** 首页上最多列这么多，再多这一页就不是首页了 */
const MAX_ENTRIES = 4
/** 听过这个比例就算听完了，不再提示「继续」 */
const FINISHED_RATIO = 0.95

export function ContinueShelf() {
  const { t } = useT()
  const activeServerId = useServerStore(s => s.activeServerId)
  const isConnected = useServerStore(s => s.isConnected)
  const capabilities = useServerCapabilities()

  const { data: bookmarks } = useQuery({
    queryKey: [activeServerId ?? 'no-server', 'bookmarks'],
    queryFn: () => getAdapter().getBookmarks?.() ?? [],
    enabled: !!activeServerId && isConnected && capabilities.bookmarks,
    staleTime: 5 * 60 * 1000,
  })

  const entries = (bookmarks ?? [])
    .filter(entry => {
      const durationMs = (entry.song.duration || 0) * 1000
      if (durationMs <= 0) return entry.positionMs > 0
      return entry.positionMs > 0 && entry.positionMs / durationMs < FINISHED_RATIO
    })
    .slice(0, MAX_ENTRIES)

  if (!entries.length) return null

  return (
    <section aria-labelledby="home-continue">
      <div className="section-head">
        <h2 id="home-continue">
          {t('section.continue')}<small>PICK UP WHERE YOU LEFT OFF</small>
        </h2>
      </div>

      <ol className="border-t border-hair divide-y divide-hair-soft">
        {entries.map(entry => {
          const durationSec = entry.song.duration || 0
          const positionSec = Math.floor(entry.positionMs / 1000)
          const ratio = durationSec > 0 ? Math.min(1, positionSec / durationSec) : 0
          return (
            <li key={`${entry.song.serverId ?? ''}:${entry.song.id}`}>
              <button
                type="button"
                onClick={() => {
                  // 先把这首放进队列，再跳到断点：顺序反了会被新曲目的
                  // 加载复位掉（load() 会把 currentTime 归零）
                  playListFrom([entry.song], 0)
                  window.setTimeout(() => seekHowl(positionSec), 120)
                }}
                className="group flex w-full items-center gap-4 px-2 py-3 text-left transition-all duration-200 hover:translate-x-1 hover:bg-paper-deep"
              >
                <Play size={12} weight="fill" className="flex-none text-ink-faint transition-colors group-hover:text-primary" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-serif text-[15px] font-semibold transition-colors group-hover:text-primary">
                    {spaceCJK(entry.song.title)}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-ink-soft">
                    {spaceCJK(entry.song.artist)}
                  </span>
                  {/* 进度用一条发丝线表达，不用进度条控件——这里不可拖动 */}
                  <span className="mt-1.5 block h-px w-full bg-hair-soft" aria-hidden="true">
                    <span className="block h-px bg-primary" style={{ width: `${ratio * 100}%` }} />
                  </span>
                </span>
                <span className="num flex-none text-[11px] text-ink-faint">
                  {formatDuration(positionSec)}
                  {durationSec > 0 && ` / ${formatDuration(durationSec)}`}
                </span>
              </button>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
