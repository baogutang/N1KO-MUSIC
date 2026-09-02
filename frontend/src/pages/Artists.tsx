/**
 * 歌手列表页 —— 文字索引大列表（DESIGN v2 §3，demo 歌手索引范式）
 * 衬线歌手名行 + 发丝线分隔 + mono 收录数，hover 整行右移；
 * 顶部衬线标题 + mono 总数 + 发丝线下缘过滤输入框
 *
 * 多源（PLAN 2.4）：只列声明 libraryBrowse 的音源，多个可浏览源时
 * 页头出现源切换 chip（?src=）——与专辑页同一套语义。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { MagnifyingGlass } from '@phosphor-icons/react'
import { useArtists } from '@/hooks/useServerQueries'
import { useBrowseSource } from '@/hooks/useSourceQueries'
import { SourceBadge } from '@/components/sources/SourceBadge'
import { buildIndexBuckets, IndexRail } from '@/components/common/IndexRail'
import { spaceCJK } from '@/utils/cjkTypography'
import { EmptyState } from '@/components/common/EmptyState'
import { useT } from '@/i18n'

export default function ArtistsPage() {
  const { t } = useT()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const srcParam = searchParams.get('src') ?? undefined
  const { available, current } = useBrowseSource(srcParam)
  const { data: artists, isLoading } = useArtists(current?.serverId)
  const [filter, setFilter] = useState('')

  const filtered = useMemo(
    () => artists?.filter(a => a.name.toLowerCase().includes(filter.toLowerCase())) ?? [],
    [artists, filter]
  )

  const buckets = useMemo(
    () => buildIndexBuckets(filtered, a => a.sortIndex, a => a.name),
    [filtered]
  )

  const [activeLetter, setActiveLetter] = useState<string | undefined>()
  const headingRefs = useRef(new Map<string, HTMLElement>())

  const handleJump = useCallback((letter: string) => {
    const el = headingRefs.current.get(letter)
    if (!el) return
    el.scrollIntoView({ block: 'start', behavior: 'auto' })
    setActiveLetter(letter)
  }, [])

  /**
   * 当前字母跟随滚动。用 IntersectionObserver 盯住段头，
   * 不在滚动事件里量位置——一千个段头逐个 getBoundingClientRect 会把滚动拖垮。
   */
  useEffect(() => {
    const headings = Array.from(headingRefs.current.values())
    if (!headings.length) return
    const observer = new IntersectionObserver(
      entries => {
        const visible = entries
          .filter(entry => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
        const letter = (visible?.target as HTMLElement | undefined)?.dataset.letterHead
        if (letter) setActiveLetter(letter)
      },
      { rootMargin: '0px 0px -75% 0px', threshold: 0 }
    )
    for (const heading of headings) observer.observe(heading)
    return () => observer.disconnect()
  }, [buckets])

  if (!current) {
    return (
      <div className="pt-9 animate-fade-in">
        <h1 className="font-serif text-3xl font-bold tracking-tight text-ink">{t('nav.artists')}</h1>
        <EmptyState ruled title={t('sources.noBrowseTitle')} description={t('sources.noBrowseDesc')} />
      </div>
    )
  }

  return (
    <div className="pt-9 animate-fade-in">
      <div className="mb-6">
        <h1 className="font-serif text-3xl font-bold tracking-tight text-ink">{t('nav.artists')}</h1>
        {!isLoading && (
          <p className="num text-sm text-ink-soft mt-1.5">
            {t('artist.total', { count: filtered.length })}
          </p>
        )}
        {available.length > 1 && (
          <div className="mt-4 flex items-center gap-4">
            {available.map(s => (
              <button
                key={s.serverId}
                onClick={() => setSearchParams(s.serverId === current.serverId ? {} : { src: s.serverId }, { replace: true })}
                className={
                  'inline-flex items-center gap-1.5 pb-1 border-b transition-colors ' +
                  (s.serverId === current.serverId
                    ? 'border-primary text-primary'
                    : 'border-transparent text-ink-faint hover:text-foreground')
                }
              >
                <SourceBadge serverId={s.serverId} />
                <span className="text-[12px]">{s.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 过滤：发丝线下缘输入框，focus 下缘变 accent（DESIGN §4.4） */}
      <div className="relative max-w-sm mb-8">
        <MagnifyingGlass size={15} className="absolute left-0 top-1/2 -translate-y-1/2 text-ink-faint" />
        <input
          placeholder={t('artist.filterPlaceholder')}
          value={filter}
          onChange={e => setFilter(e.target.value)}
          className="w-full border-b border-hair bg-transparent py-2 pl-6 pr-2 text-sm text-ink placeholder:text-ink-faint transition-colors duration-200 focus:border-primary focus:outline-none focus-visible:outline-none"
        />
      </div>

      {isLoading ? (
        <div className="border-t border-hair divide-y divide-hair-soft">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="flex items-baseline justify-between gap-4 px-2 py-4">
              <div className="h-4 w-48 rounded-sm bg-skeleton animate-pulse" />
              <div className="h-3 w-14 rounded-sm bg-skeleton animate-pulse" />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState ruled title={t('empty.artists.title')} description={t('empty.artists.description')} />
      ) : (
        <div className="flex gap-3">
          <div className="min-w-0 flex-1 border-t border-hair">
            {buckets.map(bucket => (
              <section key={bucket.letter}>
                <h2
                  data-letter-head={bucket.letter}
                  ref={el => {
                    if (el) headingRefs.current.set(bucket.letter, el)
                    else headingRefs.current.delete(bucket.letter)
                  }}
                  className="font-num sticky top-0 z-10 bg-paper/95 px-2 pb-1 pt-3 text-[11px] tracking-[0.24em] text-primary backdrop-blur-sm"
                >
                  {bucket.letter}
                </h2>
                <div className="divide-y divide-hair-soft border-t border-hair-soft">
                  {bucket.items.map(artist => (
                    <button
                      key={artist.id}
                      onClick={() => navigate(`/artists/${artist.id}`)}
                      className="group flex w-full items-baseline justify-between gap-4 px-2 py-3.5 text-left transition-all duration-200 hover:translate-x-1.5 hover:bg-paper-deep"
                    >
                      <span className="min-w-0 truncate font-serif text-lg font-semibold text-ink transition-colors duration-200 group-hover:text-primary md:text-xl">
                        {spaceCJK(artist.name)}
                      </span>
                      {artist.albumCount != null && (
                        <span className="num flex-shrink-0 text-xs text-ink-faint">
                          {t('artist.albumCount', { count: artist.albumCount })}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>

          <IndexRail
            letters={buckets.map(b => b.letter)}
            activeLetter={activeLetter}
            onJump={handleJump}
            className="flex-none self-start"
          />
        </div>
      )}
    </div>
  )
}
