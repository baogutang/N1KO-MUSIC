/**
 * 唱片目录 · 年份轨。
 *
 * 把三十年的作品读成一条生涯，而不是一片封面网格——后者恰恰是设计契约
 * 想避免的东西（卡片堆叠 + 大面积重复色块），却一直留在最该发挥的那一页上。
 *
 * 年份用等宽沿一条发丝线下行，专辑挂在轨上；外侧窄边栏放「你自己的历史」，
 * 像页边注一样。没有年份的专辑收在末尾的一格里，不丢。
 */

import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Play } from '@phosphor-icons/react'
import type { Album } from '@/api/types'
import { ImageWithFallback } from '@/components/common/ImageWithFallback'
import { getAdapter, hasAdapter } from '@/api'
import { spaceCJK } from '@/utils/cjkTypography'
import { t as translate, useT } from '@/i18n'
import { cn } from '@/lib/utils'

export interface ArtistMarginalia {
  /** 第一次听到这位歌手的时间 */
  firstHeardAt?: number
  /** 有效播放总次数 */
  plays: number
  /** 听得最多的那张专辑 */
  favouriteAlbum?: string
  /** 最近一次收听 */
  lastHeardAt?: number
  /** 你拥有但从没听过的专辑数 */
  neverPlayedAlbums: number
}

function formatDate(ts?: number): string | null {
  if (!ts) return null
  const d = new Date(ts)
  return translate('artist.yearMonth', { year: d.getFullYear(), month: d.getMonth() + 1 })
}

function relativeDays(ts?: number): string | null {
  if (!ts) return null
  const days = Math.floor((Date.now() - ts) / 86_400_000)
  if (days <= 0) return translate('artist.today')
  if (days === 1) return translate('artist.yesterday')
  if (days < 30) return translate('artist.daysAgo', { count: days })
  if (days < 365) {
    const months = Math.floor(days / 30)
    // 英文里 1 个月要用单数说法，运行时不做复数规则，因此分两个 key
    return months === 1
      ? translate('artist.monthAgo')
      : translate('artist.monthsAgo', { count: months })
  }
  const years = Math.floor(days / 365)
  return years === 1
    ? translate('artist.yearAgo')
    : translate('artist.yearsAgo', { count: years })
}

export function DiscographyRail({
  albums,
  marginalia,
  onPlayAlbum,
}: {
  albums: Album[]
  marginalia?: ArtistMarginalia
  onPlayAlbum?: (album: Album) => void
}) {
  const { t } = useT()
  const navigate = useNavigate()

  /** 按年份倒序分组；无年份的收在最后 */
  const groups = useMemo(() => {
    const byYear = new Map<number | 'unknown', Album[]>()
    for (const album of albums) {
      const key = album.year && album.year > 0 ? album.year : 'unknown'
      const list = byYear.get(key) ?? []
      list.push(album)
      byYear.set(key, list)
    }
    const years = Array.from(byYear.keys())
      .filter((y): y is number => typeof y === 'number')
      .sort((a, b) => b - a)
    const out: Array<{ year: number | 'unknown'; albums: Album[] }> = years.map(y => ({
      year: y,
      albums: (byYear.get(y) ?? []).sort((a, b) => a.name.localeCompare(b.name)),
    }))
    const unknown = byYear.get('unknown')
    if (unknown?.length) out.push({ year: 'unknown', albums: unknown })
    return out
  }, [albums])

  /** 生涯跨度：只有真的横跨多年才值得说 */
  const span = useMemo(() => {
    const years = albums.map(a => a.year).filter((y): y is number => !!y && y > 0)
    if (years.length < 2) return null
    const min = Math.min(...years)
    const max = Math.max(...years)
    return max - min >= 2 ? { min, max } : null
  }, [albums])

  if (!albums.length) return null

  return (
    <section aria-labelledby="discography">
      <div className="section-head">
        <h2 id="discography">
          {t('section.discography')}<small>DISCOGRAPHY</small>
        </h2>
        <span className="more num">
          {span
            ? t('artist.discographySpan', {
                from: span.min,
                to: span.max,
                count: albums.length,
              })
            : t('artist.discographyCount', { count: albums.length })}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-x-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,15rem)]">
        {/* 主栏：年份轨 */}
        <div className="min-w-0">
          {groups.map(group => (
            <div
              key={String(group.year)}
              className="grid grid-cols-[3.5rem_1fr] gap-x-5 border-l border-hair pl-0"
            >
              <div className="relative -ml-px border-l border-hair pl-4 pt-4">
                <span className="font-num absolute -left-px top-4 block h-[2px] w-3 bg-primary" aria-hidden />
                <span className="font-num text-[13px] font-semibold tracking-[0.06em] text-ink">
                  {group.year === 'unknown' ? t('artist.unknownYear') : group.year}
                </span>
              </div>
              <ul className="pt-3">
                {group.albums.map(album => (
                  <li key={album.id}>
                    <div className="group flex items-center gap-3.5 border-b border-hair-soft py-2.5 transition-[background,transform] duration-200 hover:translate-x-1 hover:bg-paper-deep">
                      <button
                        onClick={() => navigate(`/albums/${album.id}`)}
                        className="flex min-w-0 flex-1 items-center gap-3.5 text-left"
                      >
                        <span className="h-9 w-9 flex-none overflow-hidden rounded-sm ring-1 ring-hair-soft">
                          <ImageWithFallback
                            src={album.coverArt && hasAdapter()
                              ? getAdapter().getCoverUrl(album.coverArt, 96)
                              : undefined}
                            alt={album.name}
                            fallbackType="album"
                            className="h-full w-full"
                          />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-serif text-[15px] font-semibold group-hover:text-primary">
                            {spaceCJK(album.name)}
                          </span>
                          {album.songCount != null && (
                            <span className="font-num mt-0.5 block text-[11px] text-ink-faint">
                              {t('album.trackCount', { count: album.songCount })}
                            </span>
                          )}
                        </span>
                      </button>
                      {onPlayAlbum && (
                        <button
                          onClick={() => onPlayAlbum(album)}
                          aria-label={t('album.playNamed', { name: album.name })}
                          className={cn(
                            'grid h-7 w-7 flex-none place-items-center rounded-full border border-hair',
                            'text-ink-soft opacity-0 transition-all duration-200',
                            'group-hover:opacity-100 hover:border-primary hover:text-primary active:scale-95'
                          )}
                        >
                          <Play size={11} weight="fill" className="ml-px" />
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* 边栏：你自己的历史，像页边注 */}
        {marginalia && marginalia.plays > 0 && (
          <aside className="mt-8 border-t border-hair pt-4 lg:mt-4 lg:border-t-0 lg:border-l lg:pl-6 lg:pt-4">
            <p className="mb-3 text-[10.5px] uppercase tracking-[0.24em] text-primary">
              {t('artist.yourHistory')}
            </p>
            <dl className="space-y-3 text-[12.5px]">
              {formatDate(marginalia.firstHeardAt) && (
                <MarginRow
                  label={t('artist.firstHeard')}
                  value={formatDate(marginalia.firstHeardAt)!}
                />
              )}
              <MarginRow
                label={t('artist.totalPlays')}
                value={t('artist.playCount', { count: marginalia.plays })}
                mono
              />
              {marginalia.favouriteAlbum && (
                <MarginRow label={t('artist.mostPlayed')} value={marginalia.favouriteAlbum} />
              )}
              {relativeDays(marginalia.lastHeardAt) && (
                <MarginRow
                  label={t('artist.lastHeard')}
                  value={relativeDays(marginalia.lastHeardAt)!}
                />
              )}
              {marginalia.neverPlayedAlbums > 0 && (
                <MarginRow
                  label={t('artist.neverPlayed')}
                  value={t('artist.albumCount', { count: marginalia.neverPlayedAlbums })}
                  mono
                />
              )}
            </dl>
          </aside>
        )}
      </div>
    </section>
  )
}

function MarginRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-[10.5px] tracking-[0.14em] text-ink-faint">{label}</dt>
      <dd className={cn('mt-0.5 font-serif text-[14px]', mono && 'font-num text-[13px]')}>
        {spaceCJK(value)}
      </dd>
    </div>
  )
}
