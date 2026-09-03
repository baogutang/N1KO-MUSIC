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
import { Play } from '@phosphor-icons/react'
import { useServerStore } from '@/store/serverStore'
import { readListeningEvents } from '@/services/listeningHistory'
import { buildRediscovery, type RediscoveryEntry } from '@/services/rediscovery'
import { playAllInOrder, playListFrom } from '@/utils/playActions'
import { spaceCJK } from '@/utils/cjkTypography'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'

/** 一栏最多列这么多，再多这一页就不是首页了 */
const PER_COLUMN = 5

export function RediscoveryShelf() {
  const { t } = useT()
  const navigate = useNavigate()
  const serverId = useServerStore(s => s.activeServerId)

  const rediscovery = useMemo(
    () => buildRediscovery(serverId ? readListeningEvents(serverId) : []),
    [serverId]
  )

  const columns = [
    {
      key: 'anniversary',
      title: t('section.onThisDay'),
      tag: 'ON THIS DAY',
      entries: rediscovery.anniversary,
    },
    {
      key: 'dormant',
      title: t('section.longUnplayed'),
      tag: 'LONG UNPLAYED',
      entries: rediscovery.dormant,
    },
    {
      key: 'onceOnly',
      title: t('section.heardOnce'),
      tag: 'HEARD ONCE',
      entries: rediscovery.onceOnly,
    },
  ].filter(column => column.entries.length > 0)

  if (!columns.length) return null

  return (
    <section aria-labelledby="home-rediscovery">
      <div className="section-head">
        <h2 id="home-rediscovery">
          {t('section.rediscovery')}<small>FROM YOUR OWN SHELF</small>
        </h2>
        <span className="more num">{t('stats.rediscoverySource')}</span>
      </div>

      <div
        className={cn(
          'grid grid-cols-1 gap-x-12',
          columns.length === 2 && 'md:grid-cols-2',
          columns.length === 3 && 'md:grid-cols-3'
        )}
      >
        {columns.map(column => (
          <div key={column.key} className="min-w-0 pb-2">
            <div className="mb-3 flex items-baseline justify-between gap-3 border-b border-hair pb-2">
              <h3 className="flex items-baseline gap-2.5 font-serif text-[17px] font-bold">
                {column.title}
                <span className="latin-tag font-num text-[9.5px] tracking-[0.22em] text-ink-faint">
                  {column.tag}
                </span>
              </h3>
              {column.entries.length > 1 && (
                <button
                  onClick={() => playAllInOrder(column.entries.map(entry => entry.song))}
                  className="flex-none text-[11px] text-ink-faint transition-colors hover:text-primary"
                >
                  <Play size={10} weight="fill" className="mr-1 inline" />
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
                  onOpenArtist={() => entry.song.artistId && navigate(`/artists/${entry.song.artistId}?src=${encodeURIComponent(entry.song.serverId)}`)}
                />
              ))}
            </ol>
          </div>
        ))}
      </div>
    </section>
  )
}

function RediscoveryRow({
  entry, onPlay, onOpenArtist,
}: {
  entry: RediscoveryEntry
  onPlay: () => void
  onOpenArtist: () => void
}) {
  return (
    <li>
      <div className="group flex items-baseline gap-3 border-b border-hair-soft py-2.5 transition-[background,transform] duration-200 hover:translate-x-1 hover:bg-paper-deep">
        <button onClick={onPlay} className="min-w-0 flex-1 text-left">
          <span className="block truncate font-serif text-[14.5px] font-semibold group-hover:text-primary">
            {spaceCJK(entry.song.title)}
          </span>
          <span className="mt-0.5 flex items-baseline gap-2 text-[11px] text-ink-faint">
            <button
              type="button"
              onClick={event => { event.stopPropagation(); onOpenArtist() }}
              className={cn(
                'min-w-0 truncate',
                entry.song.artistId && 'hover:text-primary hover:underline'
              )}
            >
              {spaceCJK(entry.song.artist)}
            </button>
            {/* 说明句由真实数据拼成，不做任何修辞 */}
            <span className="flex-none text-primary/70">{entry.note}</span>
          </span>
        </button>
      </div>
    </li>
  )
}
