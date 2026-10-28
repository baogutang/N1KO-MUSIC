/**
 * 重听栏。
 *
 * 推荐负责「你可能喜欢什么」，这一栏负责另一件事：你**已经**喜欢过的东西
 * 正在从手边消失。私人曲库真正的价值不是源源不断地推新，
 * 而是听过又忘掉的东西还找得回来。
 *
 * 三栏各自对应一种「丢失」：时间上的重合（去年今日）、长久的冷落（久违）、
 * 一次性的擦肩（只听过一次）。哪一栏没内容就整栏不出现——
 * 空着的板块比没有板块更伤。
 */

import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { CoverImage } from '@/components/common/CoverImage'
import { useCoverUrl } from '@/hooks/useCoverUrl'
import { useHistoryScope } from '@/store/serverStore'
import { readListeningEvents } from '@/services/listeningHistory'
import { buildRediscovery, type RediscoveryEntry } from '@/services/rediscovery'
import { playAllInOrder, playListFrom } from '@/utils/playActions'
import { spaceCJK } from '@/utils/cjkTypography'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import { detailPath } from '@/utils/detailPath'

/** 一栏最多列这么多，再多这一页就不是首页了 */
const PER_COLUMN = 5

export function RediscoveryShelf() {
  const { t } = useT()
  const navigate = useNavigate()

  /* 口径（阶段 5 / F15）：全源历史——重听的对象不分来源 */
  const historyScope = useHistoryScope()
  const rediscovery = useMemo(
    () => buildRediscovery(readListeningEvents(historyScope)),
    [historyScope]
  )

  const columns = [
    {
      key: 'anniversary',
      title: t('section.onThisDay'),
      entries: rediscovery.anniversary,
    },
    {
      key: 'dormant',
      title: t('section.longUnplayed'),
      entries: rediscovery.dormant,
    },
    {
      key: 'onceOnly',
      title: t('section.heardOnce'),
      entries: rediscovery.onceOnly,
    },
  ].filter(column => column.entries.length > 0)

  if (!columns.length) return null

  return (
    <section aria-labelledby="home-rediscovery">
      <div className="section-head">
        <h2 id="home-rediscovery">{t('section.rediscovery')}</h2>
        <span className="min-w-0 text-right text-[13px] text-ink-3">{t('stats.rediscoverySource')}</span>
      </div>

      {/* 按实际可用宽度折列：窗口是宽档不等于内容区宽（右侧可能还开着面板） */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,280px),1fr))] gap-4">
        {columns.map(column => (
          <div key={column.key} className="sheet min-w-0 p-3 regular:p-4">
            <div className="flex items-baseline justify-between gap-3 px-2 pb-1 pt-1">
              <h3 className="min-w-0 truncate font-display text-[18px] font-semibold tracking-[-0.015em] text-ink">
                {column.title}
              </h3>
              {column.entries.length > 1 && (
                <button
                  onClick={() => playAllInOrder(column.entries.map(entry => entry.song))}
                  className="-my-3 flex-none py-3 text-[14px] font-semibold text-leaf hover:underline"
                >
                  {t('player.playAllShort')}
                </button>
              )}
            </div>
            <ol>
              {column.entries.slice(0, PER_COLUMN).map((entry, index) => (
                <RediscoveryRow
                  key={`${entry.song.serverId ?? ''}:${entry.song.id}`}
                  entry={entry}
                  onPlay={() => playListFrom(
                    column.entries.map(item => item.song),
                    index
                  )}
                  onOpenArtist={() => entry.song.artistId && navigate(detailPath('artists', entry.song.artistId, entry.song.serverId))}
                />
              ))}
            </ol>
          </div>
        ))}
      </div>
    </section>
  )
}

/**
 * 一行：整行点了就播（曲名按钮用 ::after 铺满整行），歌手名是叠在上面的另一个按钮。
 * 两个按钮并列而不是嵌套——嵌套的 button 是非法 HTML，React 会警告。
 */
function RediscoveryRow({
  entry, onPlay, onOpenArtist,
}: {
  entry: RediscoveryEntry
  onPlay: () => void
  onOpenArtist: () => void
}) {
  const { primary, fallback } = useCoverUrl(entry.song, { size: 96 })
  return (
    <li className="group relative flex min-h-[56px] items-center gap-3 rounded-sm px-2 py-2 [@media(hover:hover)]:hover:bg-ink/[0.05]">
      <span className="cover-frame h-11 w-11 flex-none">
        <CoverImage
          primary={primary}
          fallback={fallback}
          alt=""
          className="h-full w-full"
          songId={entry.song.id}
          customCoverParams={{
            type: 'song',
            title: entry.song.title,
            artist: entry.song.artist,
            album: entry.song.album,
            path: entry.song.path,
          }}
        />
      </span>
      <span className="min-w-0 flex-1">
        <button
          onClick={onPlay}
          className="block w-full truncate rounded-sm text-left text-[15px] font-semibold text-ink after:absolute after:inset-0 after:content-['']"
        >
          {spaceCJK(entry.song.title)}
        </button>
        <span className="mt-0.5 flex items-baseline gap-x-3 text-[13px] text-ink-3">
          <button
            type="button"
            onClick={onOpenArtist}
            className={cn(
              'relative -my-2 min-w-0 truncate py-2',
              entry.song.artistId && 'hover:text-leaf hover:underline'
            )}
          >
            {spaceCJK(entry.song.artist)}
          </button>
          {/* 说明句由真实数据拼成，不做任何修辞 */}
          <span className="flex-none">{entry.note}</span>
        </span>
      </span>
    </li>
  )
}
