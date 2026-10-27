/**
 * 唱片目录 · 书架。
 *
 * 一排横向滑动的专辑封面，按年份倒序摆放，每张标出年份与曲目数；
 * 没有年份的专辑收在末尾，不丢。书架下面是一张 sheet 纸片，放「你自己的历史」——
 * 全部来自本地收听历史，不需要任何额外请求。
 */

import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Play } from '@phosphor-icons/react'
import type { Album } from '@/api/types'
import { ImageWithFallback } from '@/components/common/ImageWithFallback'
import { CoverCard, CoverShelf } from '@/components/common/CoverCard'
import { CoverActionButton, CoverActions } from '@/components/music/AlbumCard'
import { findAdapterFor } from '@/api'
import { spaceCJK } from '@/utils/cjkTypography'
import { t as translate, useT } from '@/i18n'
import { detailPath } from '@/utils/detailPath'

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

  /** 书架顺序：年份倒序，同年按名称，无年份的在最后 */
  const shelf = useMemo(
    () => groups.flatMap(group => group.albums.map(album => ({ album, year: group.year }))),
    [groups]
  )

  if (!albums.length) return null

  return (
    <section aria-labelledby="discography">
      <div className="section-head">
        <h2 id="discography">{t('section.discography')}</h2>
        <span className="num flex flex-wrap justify-end gap-x-3 text-sm text-ink-faint">
          {span && <span>{t('artist.discographyYears', { from: span.min, to: span.max })}</span>}
          <span>{t('artist.discographyCount', { count: albums.length })}</span>
        </span>
      </div>

      <CoverShelf>
        {shelf.map(({ album, year }) => (
          <CoverCard
            key={album.id}
            aria-label={album.name}
            onClick={() => navigate(detailPath('albums', album.id, album.serverId))}
            tile={
              <ImageWithFallback
                src={album.coverArt
                  ? (findAdapterFor(album.serverId)?.getCoverUrl(album.coverArt, 300) ?? undefined)
                  : undefined}
                alt={album.name}
                fallbackType="album"
                className="h-full w-full object-cover"
                customCoverParams={{ type: 'album', artist: album.artist, album: album.name }}
              />
            }
            overlay={
              onPlayAlbum && (
                <CoverActions>
                  <CoverActionButton
                    onClick={e => { e.stopPropagation(); onPlayAlbum(album) }}
                    aria-label={t('album.playNamed', { name: album.name })}
                  >
                    <Play size={14} weight="fill" className="ml-px" />
                  </CoverActionButton>
                </CoverActions>
              )
            }
            title={spaceCJK(album.name)}
            meta={
              <>
                <span className="num">{year === 'unknown' ? t('artist.unknownYear') : year}</span>
                {album.songCount != null && (
                  <span className="num ml-2">{t('album.trackCount', { count: album.songCount })}</span>
                )}
              </>
            }
          />
        ))}
      </CoverShelf>

      {/* 你自己的历史：一张纸片 */}
      {marginalia && marginalia.plays > 0 && (
        <aside className="sheet mt-4 p-5 regular:p-6">
          <p className="mb-4 font-display text-[17px] font-semibold">
            {t('artist.yourHistory')}
          </p>
          <dl className="grid grid-cols-2 gap-x-8 gap-y-4 regular:grid-cols-3">
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
    </section>
  )
}

function MarginRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[13px] text-ink-faint">{label}</dt>
      <dd className={mono ? 'num mt-0.5 text-[15px] font-medium' : 'mt-0.5 text-[15px] font-medium'}>
        {spaceCJK(value)}
      </dd>
    </div>
  )
}
