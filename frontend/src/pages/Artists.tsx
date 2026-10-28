/**
 * 歌手列表页 —— 按字母分段的圆头像墙
 * 大标题 + 总数 + 过滤框；每个字母一段（吸顶的字母头 + 圆头像网格），
 * 右侧贴边一条字母索引轨（IndexRail），一千位歌手也能一下跳到想要的字母。
 *
 * 多源（PLAN 2.4）：只列声明 libraryBrowse 的音源，多个可浏览源时
 * 页头出现源切换（?src=）——与专辑页同一套语义。
 */

import { useCallback, useEffect, useDeferredValue, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { MagnifyingGlass } from '@phosphor-icons/react'
import { motion } from 'motion/react'
import { cn } from '@/lib/utils'
import { SPRING_SNAPPY } from '@/lib/motion'
import { Input } from '@/components/ui/input'
import { useArtists } from '@/hooks/useServerQueries'
import { useBrowseSource } from '@/hooks/useSourceQueries'
import { SourceBadge } from '@/components/sources/SourceBadge'
import { buildIndexBuckets, IndexRail } from '@/components/common/IndexRail'
import { ArtistCard } from '@/components/music/ArtistCard'
import { CoverGrid } from '@/components/common/CoverCard'
import { EmptyState } from '@/components/common/EmptyState'
import { ErrorState } from '@/components/common/ErrorState'
import { useT } from '@/i18n'
import { sourceParam } from '@/lib/sourceParam'

/**
 * 分段控件的一格：看起来 36px，触点用 ::before 向上下各多出 4px（落在轨道的内边距里），凑足 44px。
 */
const SEG_OPTION =
  'press-pop relative isolate inline-flex h-9 flex-none items-center gap-2 whitespace-nowrap rounded-pill px-4 text-[14px] font-semibold before:absolute before:inset-x-0 before:-inset-y-1'

/** 当前格底下托起的那块片。暗色下 surface 与轨道（ink 6%）几乎同亮（对比 1.03:1），改用 fill-2 才托得起来 */
const SEG_PILL = 'absolute inset-0 -z-10 rounded-pill seg-pill'

/** 歌手墙的列宽比专辑墙窄：圆头像不需要 160px，窄屏（右边还有索引轨）也能排两列 */
const ARTIST_GRID = 'grid-cols-[repeat(auto-fill,minmax(min(100%,128px),1fr))] gap-x-4 gap-y-6'

/** 圆头像形骨架：圆 + 居中的两行图注，位置和真实卡片一致 */
function ArtistSkeletons({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex flex-col items-center">
          <div className="skeleton cover-frame aspect-square w-full rounded-full" />
          <div className="skeleton mt-2.5 h-3.5 w-2/3 rounded-pill" />
          <div className="skeleton mt-2 h-3 w-1/3 rounded-pill" />
        </div>
      ))}
    </>
  )
}

export default function ArtistsPage() {
  const { t } = useT()
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
      <div className="pt-2 regular:pt-4">
        <h1 className="font-display text-[34px] font-bold leading-[1.05] tracking-[-0.03em] text-ink regular:text-[44px]">
          {t('nav.artists')}
        </h1>
        <div className="mt-8">
          <EmptyState mascot="maodou-wave" ruled title={t('sources.noBrowseTitle')} description={t('sources.noBrowseDesc')} />
        </div>
      </div>
    )
  }

  return (
    <div className="pt-2 regular:pt-4">
      <h1 className="font-display text-[34px] font-bold leading-[1.05] tracking-[-0.03em] text-ink regular:text-[44px]">
        {t('nav.artists')}
      </h1>
      {/* 出错时也不显示计数（复核 F12）：0 位是把故障说成空库 */}
      {!isLoading && !isError && (
        <p className="num mt-3 text-[14px] font-medium text-ink-3">
          {t('artist.total', { count: filtered.length })}
        </p>
      )}
      {available.length > 1 && (
        <div className="mt-6 inline-flex max-w-full overflow-x-auto rounded-pill bg-ink/[0.06] p-1 scrollbar-hide">
          {available.map(s => {
            const here = s.serverId === current.serverId
            return (
              <button
                key={s.serverId}
                /* 与专辑页同一处修正：点当前项不做任何事。清空 ?src= 会让
                   useBrowseSource 回落到「主库或第一个可浏览源」，
                   点亮着的选项反而把你换到别的库去。 */
                disabled={here}
                onClick={() => setSearchParams({ src: s.serverId }, { replace: true })}
                className={cn(SEG_OPTION, here ? 'cursor-default text-ink' : 'text-ink-3 hover:text-ink-2')}
              >
                {here && (
                  <motion.span
                    layoutId="artists-source"
                    transition={SPRING_SNAPPY}
                    aria-hidden="true"
                    className={SEG_PILL}
                  />
                )}
                <SourceBadge serverId={s.serverId} />
                <span>{s.name}</span>
              </button>
            )
          })}
        </div>
      )}

      {/* 过滤框 */}
      <div className="relative mt-6 max-w-sm">
        <MagnifyingGlass size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-3" />
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
          <div aria-hidden="true">
            <CoverGrid className={ARTIST_GRID}>
              <ArtistSkeletons count={12} />
            </CoverGrid>
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
                <section key={bucket.letter} className="mt-6 first:mt-0" style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 600px' }}>
                  {/* 字母头是一枚小玻璃片，吸在工具栏下面：歌手头像从它底下滑过，
                      只有这一小块盖住内容（通栏的底会在光场上露出一条色带） */}
                  <h2
                    data-letter-head={bucket.letter}
                    ref={el => {
                      if (el) headingRefs.current.set(bucket.letter, el)
                      else headingRefs.current.delete(bucket.letter)
                    }}
                    className="num sticky top-[calc(env(safe-area-inset-top)+60px)] z-raised mb-3 flex h-8 w-fit min-w-8 scroll-mt-[calc(env(safe-area-inset-top)+60px)] items-center justify-center rounded-pill bg-surface/80 px-3 font-display text-[15px] font-bold leading-none text-ink-2 shadow-sm backdrop-blur-xl"
                  >
                    {bucket.letter}
                  </h2>
                  <CoverGrid className={ARTIST_GRID}>
                    {bucket.items.map(artist => (
                      <ArtistCard key={artist.id} artist={artist} />
                    ))}
                  </CoverGrid>
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
