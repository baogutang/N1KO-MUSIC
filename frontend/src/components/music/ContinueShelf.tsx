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
 *
 * 版式：左边是一副叠卡（最多三条断点的封面叠在一起，悬停或聚焦时扇开，
 * 点它从第一条接着听），右边是逐条的断点：曲名、歌手、一条细进度、时间。
 */

import { useQuery } from '@tanstack/react-query'
import { Play } from '@phosphor-icons/react'
import { getAdapter } from '@/api'
import { CoverStack, SongCover } from '@/components/music/AlbumShelf'
import { useServerStore } from '@/store/serverStore'
import { useServerCapabilities } from '@/hooks/useServerCapabilities'
import { seekHowl } from '@/hooks/useAudioEngine'
import { playListFrom } from '@/utils/playActions'
import { usePlayerStore } from '@/store/playerStore'
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

  const resume = (entry: (typeof entries)[number]) => {
    const positionSec = Math.floor(entry.positionMs / 1000)
    // 先把这首放进队列，再跳到断点：顺序反了会被新曲目的
    // 加载复位掉（load() 会把 currentTime 归零）
    playListFrom([entry.song], 0)
    // 这 120ms 里用户完全可能又点了别的歌。不校验身份的话，
    // 这一跳会把**新歌**甩到旧断点上——听起来像播放器抽风。
    window.setTimeout(() => {
      if (usePlayerStore.getState().currentSong?.id !== entry.song.id) return
      seekHowl(positionSec)
    }, 120)
  }

  return (
    <section aria-labelledby="home-continue">
      <div className="section-head">
        <h2 id="home-continue">{t('section.continue')}</h2>
      </div>

      <div className="flex flex-col gap-6 regular:flex-row regular:items-center regular:gap-10 wide:gap-12">
        <CoverStack
          className="w-[min(46vw,200px)] flex-none regular:w-[160px] wide:w-[200px]"
          aria-label={t('section.continue')}
          onClick={() => resume(entries[0])}
          covers={entries.slice(0, 3).map(entry => (
            <SongCover key={`${entry.song.serverId ?? ''}:${entry.song.id}`} song={entry.song} />
          ))}
        />

        <ol className="grid min-w-0 flex-1 gap-1">
          {entries.map(entry => {
            const durationSec = entry.song.duration || 0
            const positionSec = Math.floor(entry.positionMs / 1000)
            const ratio = durationSec > 0 ? Math.min(1, positionSec / durationSec) : 0
            return (
              <li key={`${entry.song.serverId ?? ''}:${entry.song.id}`}>
                <button
                  type="button"
                  onClick={() => resume(entry)}
                  className="group flex min-h-[56px] w-full items-center gap-4 rounded-sm px-3 py-2.5 text-left transition-colors duration-2 active:bg-ink/[0.08] [@media(hover:hover)]:hover:bg-ink/[0.05]"
                >
                  <Play size={14} weight="fill" className="flex-none text-ink-3 transition-colors group-hover:text-leaf" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold text-ink">
                      {spaceCJK(entry.song.title)}
                    </span>
                    <span className="mt-0.5 block truncate text-[13px] text-ink-3">
                      {spaceCJK(entry.song.artist)}
                    </span>
                    {/* 进度是一条细轨：这里不可拖动，不用进度条控件。填充用 scaleX，不动宽度 */}
                    <span className="mt-2 block h-1 w-full overflow-hidden rounded-pill bg-ink/[0.12]" aria-hidden="true">
                      <span className="block h-full origin-left rounded-pill bg-leaf" style={{ transform: `scaleX(${ratio})` }} />
                    </span>
                  </span>
                  <span className="num flex-none text-[13px] text-ink-3">
                    {formatDuration(positionSec)}
                    {durationSec > 0 && ` / ${formatDuration(durationSec)}`}
                  </span>
                </button>
              </li>
            )
          })}
        </ol>
      </div>
    </section>
  )
}
