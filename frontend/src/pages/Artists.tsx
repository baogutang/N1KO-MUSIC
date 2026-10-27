/**
 * 歌手列表页 —— 按字母分段的名单
 * 大标题 + 总数 + 纸片胶囊过滤框；歌手名一行一位，靠行距与 hover 底区分，不画分隔线；
 * 右侧贴边一条字母索引轨（IndexRail）。
 *
 * 多源（PLAN 2.4）：只列声明 libraryBrowse 的音源，多个可浏览源时
 * 页头出现源切换 chip（?src=）——与专辑页同一套语义。
 */

import { useCallback, useEffect, useDeferredValue, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { MagnifyingGlass } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { useArtists } from '@/hooks/useServerQueries'
import { useBrowseSource } from '@/hooks/useSourceQueries'
import { SourceBadge } from '@/components/sources/SourceBadge'
import { buildIndexBuckets, IndexRail } from '@/components/common/IndexRail'
import { spaceCJK } from '@/utils/cjkTypography'
import { EmptyState } from '@/components/common/EmptyState'
import { ErrorState } from '@/components/common/ErrorState'
import { useT } from '@/i18n'
import { sourceParam } from '@/lib/sourceParam'
import { detailPath } from '@/utils/detailPath'

export default function ArtistsPage() {
  const { t } = useT()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const srcParam = sourceParam(searchParams)
  const { available, current } = useBrowseSource(srcParam)
  const { data: artists, isLoading, isError, refetch } = useArtists(current?.serverId)
  const [filter, setFilter] = useState('')

  /* 输入过滤用 deferred 值（阶段 3.8）：千级歌手下每键重建分组会卡输入 */
  const deferredFilter = useDeferredValue(filter)
  const filtered = useMemo(
    () => artists?.filter(a => a.name.toLowerCase().includes(deferredFilter.toLowerCase())) ?? [],
    [artists, deferredFilter]
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
      <div className="pt-2 regular:pt-4 animate-fade-in">
        <h1 className="font-display text-[34px] regular:text-[40px] font-semibold leading-[1.05] tracking-[-0.02em]">{t('nav.artists')}</h1>
        <div className="mt-8">
          <EmptyState ruled title={t('sources.noBrowseTitle')} description={t('sources.noBrowseDesc')} />
        </div>
      </div>
    )
  }

  return (
    <div className="pt-2 regular:pt-4 animate-fade-in">
      <h1 className="font-display text-[34px] regular:text-[40px] font-semibold leading-[1.05] tracking-[-0.02em]">{t('nav.artists')}</h1>
      {/* 出错时也不显示计数（复核 F12）：0 位是把故障说成空库 */}
      {!isLoading && !isError && (
        <p className="num mt-3 text-sm text-ink-faint">
          {t('artist.total', { count: filtered.length })}
        </p>
      )}
      {available.length > 1 && (
        <div className="mt-5 inline-flex max-w-full gap-1 overflow-x-auto rounded-pill bg-paper-deep p-1 scrollbar-hide">
          {available.map(s => (
            <button
              key={s.serverId}
              /* 与专辑页同一处修正：点当前项不做任何事。清空 ?src= 会让
                 useBrowseSource 回落到「主库或第一个可浏览源」，
                 点亮着的 chip 反而把你换到别的库去。 */
              disabled={s.serverId === current.serverId}
              onClick={() => setSearchParams({ src: s.serverId }, { replace: true })}
              className={cn(
                'seg-option inline-flex min-h-11 flex-none items-center gap-2 whitespace-nowrap rounded-pill px-4 text-[14px] font-medium transition-colors duration-150',
                s.serverId === current.serverId
                  ? 'is-on disabled:cursor-default'
                  : 'text-ink-soft [@media(hover:hover)]:hover:text-ink'
              )}
            >
              <SourceBadge serverId={s.serverId} />
              <span>{s.name}</span>
            </button>
          ))}
        </div>
      )}

      {/* 过滤：纸片胶囊输入框 */}
      <div className="relative mt-6 max-w-sm">
        <MagnifyingGlass size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-faint" />
        <Input
          placeholder={t('artist.filterPlaceholder')}
          aria-label={t('artist.filterPlaceholder')}
          value={filter}
          onChange={e => setFilter(e.target.value)}
          className="pl-10"
        />
      </div>

      <div className="mt-8">
        {isLoading ? (
          <div className="space-y-0.5" aria-hidden="true">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="flex min-h-12 items-center justify-between gap-4 px-3">
                <div className="h-4 w-48 rounded-sm bg-skeleton animate-pulse" />
                <div className="h-3 w-14 rounded-sm bg-skeleton animate-pulse" />
              </div>
            ))}
          </div>
        ) : isError ? (
          /* 加载失败 ≠ 空态（阶段 2.1）：空过滤框配「没有名字相符的歌手」
             是在撒谎——真话是「没读到」。 */
          <ErrorState retry={() => { void refetch() }} />
        ) : filtered.length === 0 ? (
          <EmptyState ruled title={t('empty.artists.title')} description={t('empty.artists.description')} />
        ) : (
          <div className="flex gap-3">
            <div className="min-w-0 flex-1">
              {buckets.map(bucket => (
                <section key={bucket.letter} style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 600px' }}>
                  <h2
                    data-letter-head={bucket.letter}
                    ref={el => {
                      if (el) headingRefs.current.set(bucket.letter, el)
                      else headingRefs.current.delete(bucket.letter)
                    }}
                    className="num sticky top-[60px] z-10 scroll-mt-[60px] bg-paper/95 px-3 pb-1 pt-4 text-[15px] font-semibold text-ink-faint backdrop-blur-sm"
                  >
                    {bucket.letter}
                  </h2>
                  <div>
                    {bucket.items.map(artist => (
                      <button
                        key={artist.id}
                        onClick={() => navigate(detailPath('artists', artist.id, artist.serverId))}
                        className="flex min-h-12 w-full items-center justify-between gap-4 rounded-sm px-3 py-2 text-left transition-colors duration-150 [@media(hover:hover)]:hover:bg-paper-deep"
                      >
                        <span className="min-w-0 truncate font-display text-[17px] font-semibold text-ink">
                          {spaceCJK(artist.name)}
                        </span>
                        {artist.albumCount != null && (
                          <span className="num flex-shrink-0 text-[13px] text-ink-faint">
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
    </div>
  )
}
