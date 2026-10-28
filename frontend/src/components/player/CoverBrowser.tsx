/**
 * 卡片浏览：全屏播放器里「挑下一首」的地方。大封面一张张横着排，左右滑，滑到中间那张点一下就播。
 *
 * 为什么是单独一页，而不是叠在当前封面后面：正在播放页只回答「现在放的是什么」；
 * 「接下来放什么」是另一件事——要看得见、能挑、挑完回到正在播放。入口是播放页底部那排按钮，
 * 进来以后顶上同一排标签随时切换：接下来 / 歌单 / 专辑 / 歌手 / 收藏 / 全部歌曲。
 *
 * 手感：滑动交给浏览器原生的横向滚动 + 吸附（iPad 上的惯性和回弹是系统的，最跟手）；
 * 中间那张大、两边小一档并压暗，按每张离中线的距离逐帧写 transform / opacity，不经 React 渲染。
 * 只渲染看得见的几张（歌手、全部歌曲动辄上千条）；全部歌曲滑到快到头时再要下一页。
 *
 * 点中间那张 = 播放；点两边的 = 把它滑到中间。播放后回到正在播放。
 * 卡片是扁平的：不做 3D 旋转、倒影这类拟物（DESIGN.md「不做拟物的 3D」）。
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, RefObject } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { CaretLeft, Heart, MicrophoneStage, MusicNotes, Play, Playlist as PlaylistGlyph, Queue, VinylRecord } from '@phosphor-icons/react'
import type { Icon } from '@phosphor-icons/react'
import type { Album, Artist, Playlist, Song } from '@/api/types'
import { findAdapterFor, getAdapterFor } from '@/api'
import { cn } from '@/lib/utils'
import { haptic } from '@/lib/haptics'
import { SPRING_SNAPPY } from '@/lib/motion'
import { useT } from '@/i18n'
import { usePlayerStore } from '@/store/playerStore'
import { useCoverUrl } from '@/hooks/useCoverUrl'
import { useAlbumShelf, useArtists, useRecentAlbums, useSongsInfinite } from '@/hooks/useServerQueries'
import { useSourcePlaylists, useSourceStarred } from '@/hooks/useSourceQueries'
import { CoverImage } from '@/components/common/CoverImage'
import { toast } from '@/components/ui/use-toast'
import { playAlbum, playAllInOrder, playListFrom } from '@/utils/playActions'
import { spaceCJK } from '@/utils/cjkTypography'

export type BrowseTab = 'queue' | 'playlists' | 'albums' | 'artists' | 'favorites' | 'songs'

export const BROWSE_TABS: { tab: BrowseTab; icon: Icon; label: string }[] = [
  { tab: 'queue', icon: Queue, label: 'shell.upNext' },
  { tab: 'playlists', icon: PlaylistGlyph, label: 'nav.playlists' },
  { tab: 'albums', icon: VinylRecord, label: 'nav.albums' },
  { tab: 'artists', icon: MicrophoneStage, label: 'nav.artists' },
  { tab: 'favorites', icon: Heart, label: 'nav.favorites' },
  { tab: 'songs', icon: MusicNotes, label: 'library.allSongs' },
]

interface Card {
  key: string
  title: string
  subtitle?: string
  /** 歌曲封面走 useCoverUrl（自定义封面、失败兜底都在里面）；其它直接给地址 */
  song?: Song
  url?: string
  /** 歌手头像是圆的，和全站的歌手卡一致 */
  round?: boolean
  current?: boolean
  play: () => void | Promise<void>
}

type Status = 'loading' | 'error' | 'ready'

function coverOf(serverId: string, coverArt: string | undefined, size: number) {
  if (!coverArt) return undefined
  return findAdapterFor(serverId)?.getCoverUrl(coverArt, size) ?? coverArt
}

/* ------------------------------------------------------------------ 数据 */

function useBrowseData(tab: BrowseTab, onPlayed: () => void): { cards: Card[]; status: Status; more?: () => void } {
  const { t } = useT()
  const queue = usePlayerStore(s => s.queue)
  const queueIndex = usePlayerStore(s => s.queueIndex)
  const shuffle = usePlayerStore(s => s.shuffle)
  const shuffledIndexes = usePlayerStore(s => s.shuffledIndexes)
  const jumpToIndex = usePlayerStore(s => s.jumpToIndex)

  // 轻的几样（歌单、收藏、最近专辑）打开就要；重的（全部歌手、全部歌曲）切到那一栏才拉
  const playlistGroups = useSourcePlaylists()
  const starredGroups = useSourceStarred()
  const recentAlbums = useRecentAlbums(40)
  const newestAlbums = useAlbumShelf('newest', 40)
  const artists = useArtists(undefined, { enabled: tab === 'artists' })
  const songs = useSongsInfinite(100, { enabled: tab === 'songs' })

  const fail = useCallback((key: string) => toast({ title: t(key), variant: 'destructive' }), [t])

  return useMemo(() => {
    const done = () => { haptic('light'); onPlayed() }
    switch (tab) {
      case 'queue': {
        const identity = queue.map((_, i) => i)
        const order = shuffle && shuffledIndexes.length === queue.length ? shuffledIndexes : identity
        const pos = Math.max(0, order.indexOf(queueIndex))
        const cards = order.slice(pos).map((qi, k) => {
          const song = queue[qi]
          return {
            key: `q-${qi}-${song.serverId}:${song.id}`,
            title: song.title,
            subtitle: song.artist,
            song,
            current: k === 0,
            play: () => {
              if (qi !== queueIndex) jumpToIndex(qi)
              done()
            },
          }
        })
        return { cards, status: 'ready' as Status }
      }
      case 'playlists': {
        const lists: Playlist[] = playlistGroups.flatMap(g => (g.status === 'success' ? g.data ?? [] : []))
        const status: Status = lists.length ? 'ready' : playlistGroups.some(g => g.status === 'loading') ? 'loading'
          : playlistGroups.length && playlistGroups.every(g => g.status === 'error') ? 'error' : 'ready'
        const cards = lists.map(pl => ({
          key: `p-${pl.serverId}:${pl.id}`,
          title: pl.name,
          subtitle: pl.songCount ? t('library.songsCount', { count: pl.songCount }) : pl.owner,
          url: coverOf(pl.serverId, pl.coverArt, 600),
          play: async () => {
            try {
              const detail = await getAdapterFor(pl.serverId).getPlaylistDetail(pl.id)
              if (!detail?.songs?.length) return void toast({ title: t('playlist.emptyToast') })
              playAllInOrder(detail.songs, 0)
              done()
            } catch {
              fail('playlist.loadFailed')
            }
          },
        }))
        return { cards, status }
      }
      case 'albums': {
        // 最近播放的专辑；新库还没有播放记录时，退回最新入库的
        const recent: Album[] = recentAlbums.data ?? []
        const albums: Album[] = recent.length ? recent : newestAlbums.data?.items ?? []
        const status: Status = albums.length ? 'ready' : recentAlbums.isLoading || newestAlbums.isLoading ? 'loading'
          : recentAlbums.isError && newestAlbums.isError ? 'error' : 'ready'
        const cards = albums.map(al => ({
          key: `a-${al.serverId}:${al.id}`,
          title: al.name,
          subtitle: al.artist,
          url: coverOf(al.serverId, al.coverArt, 600),
          play: async () => {
            await playAlbum(al)
            done()
          },
        }))
        return { cards, status }
      }
      case 'artists': {
        const list: Artist[] = artists.data ?? []
        const status: Status = list.length ? 'ready' : artists.isError ? 'error' : artists.isLoading || artists.isFetching ? 'loading' : 'ready'
        const cards = list.map(ar => ({
          key: `r-${ar.serverId}:${ar.id}`,
          title: ar.name,
          subtitle: ar.albumCount ? t('artist.albumCountShort', { count: ar.albumCount }) : undefined,
          url: ar.artistImageUrl || coverOf(ar.serverId, ar.coverArt, 600),
          round: true,
          play: async () => {
            try {
              const adapter = getAdapterFor(ar.serverId)
              const detail = await adapter.getArtistDetail(ar.id)
              let list = detail.songs?.length ? detail.songs : detail.topSongs ?? []
              if (!list.length && adapter.getArtistSongs) list = await adapter.getArtistSongs({ id: ar.id, name: ar.name })
              if (!list.length) return void toast({ title: t('browse.noSongs') })
              playAllInOrder(list, 0)
              done()
            } catch {
              fail('browse.loadFailed')
            }
          },
        }))
        return { cards, status }
      }
      case 'favorites': {
        const favs: Song[] = starredGroups.flatMap(g => (g.status === 'success' ? g.data?.songs ?? [] : []))
        const status: Status = favs.length ? 'ready' : starredGroups.some(g => g.status === 'loading') ? 'loading'
          : starredGroups.length && starredGroups.every(g => g.status === 'error') ? 'error' : 'ready'
        const cards = favs.map((song, i) => ({
          key: `f-${song.serverId}:${song.id}`,
          title: song.title,
          subtitle: song.artist,
          song,
          play: () => {
            playListFrom(favs, i)
            done()
          },
        }))
        return { cards, status }
      }
      case 'songs': {
        const all: Song[] = songs.data?.pages.flatMap(p => p.items) ?? []
        const status: Status = all.length ? 'ready' : songs.isError ? 'error' : songs.isLoading || songs.isFetching ? 'loading' : 'ready'
        const cards = all.map((song, i) => ({
          key: `s-${song.serverId}:${song.id}-${i}`,
          title: song.title,
          subtitle: song.artist,
          song,
          play: () => {
            playListFrom(all, i)
            done()
          },
        }))
        const more = songs.hasNextPage && !songs.isFetchingNextPage ? () => void songs.fetchNextPage() : undefined
        return { cards, status, more }
      }
    }
  }, [tab, queue, queueIndex, shuffle, shuffledIndexes, jumpToIndex, playlistGroups, starredGroups, recentAlbums, newestAlbums, artists, songs, onPlayed, fail, t])
}

/* ------------------------------------------------------------------ 卡片 */

function CardCover({ card, size }: { card: Card; size: number }) {
  if (card.song) return <SongCover song={card.song} size={size} />
  return <CoverImage primary={card.url} alt="" className="h-full w-full" eager />
}

function SongCover({ song, size }: { song: Song; size: number }) {
  const { primary, fallback } = useCoverUrl(song, { size })
  return <CoverImage primary={primary} fallback={fallback} alt="" className="h-full w-full" eager songId={song.id} />
}

/* ------------------------------------------------------------------ 横排 */

function Carousel({
  cards,
  focus,
  onFocus,
  onActivate,
  onNearEnd,
  label,
}: {
  cards: Card[]
  focus: number
  onFocus: (i: number) => void
  onActivate: (i: number) => void
  onNearEnd?: () => void
  label: string
}) {
  const { t } = useT()
  const reduce = useReducedMotion()
  const ref = useRef<HTMLDivElement>(null)
  const visuals = useRef(new Map<number, HTMLDivElement>())
  const [box, setBox] = useState({ w: 0, h: 0 })
  const [range, setRange] = useState<[number, number]>([0, 8])
  const focusRef = useRef(focus)
  focusRef.current = focus

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setBox({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  // 中间那张的边长：高度给标题和播放键留出地方，横屏别比 560 大。
  // 手机上占屏宽的三分之二、缝窄一点：两边那张缩小一档以后还要露出 30px 上下，看得出「还能往两边滑」
  const narrow = box.w < 600
  const card = Math.round(Math.max(150, Math.min(box.h * 0.86, box.w * (narrow ? 0.66 : 0.62), 560)))
  const gap = Math.round(card * (narrow ? 0.06 : 0.1))
  const pitch = card + gap
  const pad = Math.max(0, (box.w - card) / 2)
  const n = cards.length

  const paint = useCallback(() => {
    const el = ref.current
    if (!el || !pitch) return
    const at = el.scrollLeft / pitch
    for (const [i, node] of visuals.current) {
      const d = Math.min(2, Math.abs(i - at))
      node.style.transform = `scale(${1 - d * 0.14})`
      node.style.setProperty('--dim', String(Math.min(1, d) * 0.5))
    }
    const centre = Math.max(0, Math.min(n - 1, Math.round(at)))
    if (centre !== focusRef.current) onFocus(centre)
    const half = Math.ceil(box.w / pitch / 2) + 2
    const next: [number, number] = [Math.max(0, Math.floor(at) - half), Math.min(n, Math.ceil(at) + half + 1)]
    setRange(r => (r[0] === next[0] && r[1] === next[1] ? r : next))
  }, [pitch, n, box.w, onFocus])

  // 滚动只在下一帧画一次：iPad 惯性滚动期间每帧都有 scroll 事件
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let raf = 0
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; paint() })
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    paint()
    return () => {
      el.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(raf)
    }
  }, [paint])

  // 可见窗口挪了：新挂上的几张还没按位置缩放、压暗，当帧补画
  useLayoutEffect(() => { paint() }, [range, paint])

  // 换了一批卡（切栏）或者尺寸变了：滚回当前焦点
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !pitch) return
    el.scrollLeft = Math.min(focusRef.current, Math.max(0, n - 1)) * pitch
    paint()
    // 只在几何变化时对齐，不跟着 focus 走（focus 本身就是滚动算出来的）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pitch, n === 0])

  // 快滑到头：再要一页（只有「全部歌曲」会给 onNearEnd）
  useEffect(() => {
    if (onNearEnd && n && focus >= n - 8) onNearEnd()
  }, [focus, n, onNearEnd])

  const scrollTo = useCallback((i: number) => {
    const el = ref.current
    if (!el) return
    const k = Math.max(0, Math.min(n - 1, i))
    el.scrollTo({ left: k * pitch, behavior: reduce ? 'auto' : 'smooth' })
  }, [n, pitch, reduce])

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); scrollTo(focus + 1) }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); scrollTo(focus - 1) }
    else if (e.key === 'Home') { e.preventDefault(); scrollTo(0) }
    else if (e.key === 'End') { e.preventDefault(); scrollTo(n - 1) }
  }

  const items: number[] = []
  for (let i = range[0]; i < range[1]; i++) items.push(i)

  return (
    <div
      ref={ref}
      role="listbox"
      aria-label={label}
      aria-activedescendant={n ? `cb-card-${focus}` : undefined}
      tabIndex={0}
      onKeyDown={onKeyDown}
      // 焦点环不画在整条横排上（它贴着屏幕两边，只露出上下两条线，像多出来的分割线），画在中间那张卡上。
      // 手机上横排只比卡片高一点（66vw 是卡片边长），和下面的标题一起在页面里居中，不在卡片和标题之间悬一大块空
      className="group/cb scrollbar-hide relative min-h-0 w-full flex-1 snap-x snap-mandatory overflow-x-auto overflow-y-hidden overscroll-x-contain focus-visible:outline-none max-[599px]:max-h-[calc(66vw+64px)]"
      style={{ WebkitOverflowScrolling: 'touch' }}
    >
      <div className="relative h-full" style={{ width: n ? pad * 2 + n * pitch - gap : '100%' }}>
        {items.map(i => {
          const c = cards[i]
          if (!c) return null
          return (
            <button
              key={c.key}
              id={`cb-card-${i}`}
              type="button"
              role="option"
              aria-selected={i === focus}
              aria-label={c.subtitle ? `${c.title} · ${c.subtitle}` : c.title}
              tabIndex={-1}
              onClick={() => (i === focus ? onActivate(i) : scrollTo(i))}
              className="absolute snap-center outline-none"
              style={{ left: pad + i * pitch, top: Math.max(0, (box.h - card) / 2), width: card, height: card }}
            >
              <div
                ref={node => {
                  if (node) visuals.current.set(i, node)
                  else visuals.current.delete(i)
                }}
                className={cn(
                  'cover-frame relative h-full w-full shadow-cover will-change-transform',
                  c.round && 'rounded-full',
                  i === focus && 'group-focus-visible/cb:outline group-focus-visible/cb:outline-[length:var(--focus-width)] group-focus-visible/cb:outline-offset-4 group-focus-visible/cb:outline-leaf'
                )}
                style={{ transformOrigin: '50% 50%' }}
              >
                <CardCover card={c} size={600} />
                {/* 离中线越远压得越暗：一层黑色蒙版的透明度，比 filter 便宜 */}
                <span aria-hidden="true" className={cn('pointer-events-none absolute inset-0 bg-stage-deep opacity-[var(--dim,0)]', c.round && 'rounded-full')} />
                {c.current && (
                  <span className="absolute left-3 top-3 rounded-pill bg-stage-deep/70 px-2.5 py-1 text-[12px] font-semibold text-ink">
                    {/* 当前这首：队列里的第一张 */}
                    {t('player.nowPlaying')}
                  </span>
                )}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ 整页 */

export function CoverBrowser({
  tab,
  onTab,
  onClose,
}: {
  tab: BrowseTab
  onTab: (tab: BrowseTab) => void
  onClose: () => void
}) {
  const { t } = useT()
  const { cards, status, more } = useBrowseData(tab, onClose)
  // 每一栏记住自己滑到哪儿：从「歌单」切去「接下来」看一眼再切回来，还停在刚才那张
  const [focusByTab, setFocusByTab] = useState<Partial<Record<BrowseTab, number>>>({})
  const focus = focusByTab[tab] ?? 0
  const setFocus = useCallback((i: number) => setFocusByTab(m => (m[tab] === i ? m : { ...m, [tab]: i })), [tab])
  const [busy, setBusy] = useState(false)

  const activate = useCallback(async (i: number) => {
    const c = cards[i]
    if (!c || busy) return
    setBusy(true)
    try {
      await c.play()
    } finally {
      setBusy(false)
    }
  }, [cards, busy])

  const current = cards[focus]
  const tabLabel = t(BROWSE_TABS.find(x => x.tab === tab)?.label ?? 'shell.upNext')

  return (
    <div className="absolute inset-0 z-20 flex flex-col" role="region" aria-label={t('browse.title')} data-cover-browser="">
      <header
        className="flex flex-none items-center gap-3 px-4 pb-3 regular:px-6"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 10px)' }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label={t('browse.back')}
          className="press-pop grid h-11 w-11 flex-none place-items-center rounded-pill bg-ink/[0.1] text-ink shadow-hair hover:bg-ink/[0.16]"
        >
          <CaretLeft size={20} weight="bold" />
        </button>
        <BrowseTabs value={tab} onChange={onTab} className="min-w-0 flex-1" />
      </header>

      <div className="flex min-h-0 flex-1 flex-col justify-center pb-[calc(env(safe-area-inset-bottom)+20px)]">
        {status === 'ready' && cards.length > 0 ? (
          <Carousel
            key={tab}
            cards={cards}
            focus={Math.min(focus, cards.length - 1)}
            onFocus={setFocus}
            onActivate={i => void activate(i)}
            onNearEnd={more}
            label={tabLabel}
          />
        ) : (
          <div className="grid min-h-0 flex-1 place-items-center px-8 text-center">
            <p className={cn('text-[15px] font-medium', status === 'loading' ? 'animate-pulse text-ink-3' : 'text-ink-2')}>
              {status === 'loading' ? t('lyrics.loading') : status === 'error' ? t('browse.loadFailed') : t('browse.empty')}
            </p>
          </div>
        )}

        <div className="flex flex-none flex-col items-center gap-4 px-6 pt-6 text-center">
          <div className="min-h-[3.5rem] max-w-[min(90vw,640px)]">
            {current && (
              <motion.div key={current.key} initial={{ opacity: 0, transform: 'translateY(6px)' }} animate={{ opacity: 1, transform: 'translateY(0px)' }} transition={SPRING_SNAPPY}>
                <p className="line-clamp-1 font-display text-[24px] font-semibold leading-tight tracking-[-0.02em] text-ink regular:text-[28px]">
                  {spaceCJK(current.title)}
                </p>
                {current.subtitle && <p className="mt-1 line-clamp-1 text-[15px] font-medium text-ink-2">{spaceCJK(current.subtitle)}</p>}
              </motion.div>
            )}
          </div>
          <div className="flex items-center gap-4">
            <span className="num w-20 text-right text-[13px] text-ink-3" aria-hidden="true">
              {cards.length > 0 ? `${Math.min(focus, cards.length - 1) + 1} / ${cards.length}${more ? '+' : ''}` : ''}
            </span>
            <button
              type="button"
              disabled={!current || busy || current.current}
              onClick={() => void activate(focus)}
              className="press-pop inline-flex h-12 items-center gap-2 rounded-pill bg-lime px-7 text-[15px] font-semibold text-lime-ink hover:bg-lime-deep disabled:opacity-50"
            >
              <Play size={18} weight="fill" />
              {current?.current ? t('player.nowPlaying') : t('player.play')}
            </button>
            <span className="w-20" aria-hidden="true" />
          </div>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ 横着滑的一排 */

/** 横着滑的一排（入口、标签）：还滑得动的那一侧边缘渐隐，放得下就不加遮罩。遮罩只看透明度 */
function useEdgeFade(ref: RefObject<HTMLDivElement>): CSSProperties | undefined {
  const [edges, setEdges] = useState({ start: true, end: true })

  useEffect(() => {
    const el = ref.current
    if (!el) return
    let raf = 0
    const measure = () => {
      raf = 0
      const start = el.scrollLeft <= 2
      const end = el.scrollLeft >= el.scrollWidth - el.clientWidth - 2
      setEdges(prev => (prev.start === start && prev.end === end ? prev : { start, end }))
    }
    const sync = () => { if (!raf) raf = requestAnimationFrame(measure) }
    measure()
    el.addEventListener('scroll', sync, { passive: true })
    // 里面那排也要看：切语言时字变长，外框尺寸不变
    const ro = new ResizeObserver(sync)
    ro.observe(el)
    if (el.firstElementChild) ro.observe(el.firstElementChild)
    return () => {
      cancelAnimationFrame(raf)
      el.removeEventListener('scroll', sync)
      ro.disconnect()
    }
  }, [ref])

  if (edges.start && edges.end) return undefined
  const solid = 'oklch(var(--ink))'
  const mask = `linear-gradient(to right, ${edges.start ? solid : 'transparent'}, ${solid} 28px, ${solid} calc(100% - 28px), ${edges.end ? solid : 'transparent'})`
  return { WebkitMaskImage: mask, maskImage: mask }
}

/* ------------------------------------------------------------------ 入口 */

/** 两种尺寸。窄窗口（手机）：横排贴着屏幕两边出血（留白挪到里面那一排上，和书架一样），胶囊大一号——
 *  六颗反正放不下，就让它明明白白地滑：最后一颗露出半截，一看就知道还有，不会差几像素被切掉一条边。
 *  宽窗口（iPad 横竖屏）：紧凑一点，中英文六颗都放得下 */
const ENTRY = {
  compact: { rail: '-mx-6', row: 'gap-2 px-6', chip: 'h-10 px-4 text-[14px]' },
  regular: { rail: '', row: 'gap-1.5', chip: 'h-9 px-2.5 text-[13.5px]' },
} as const

/** 正在播放页控制区下面那排入口：一颗颗分开的胶囊、只有字（图标放进卡片浏览的标签里），点了打开卡片浏览的那一栏。
 *  故意不长成顶上「封面 / 歌词 / 接下来」那种连在一条槽里的分段标签：那是切换这一页的视图，这是去另一页 */
export function BrowseEntries({ onOpen, size }: { onOpen: (tab: BrowseTab) => void; size: keyof typeof ENTRY }) {
  const { t } = useT()
  const ref = useRef<HTMLDivElement>(null)
  const fade = useEdgeFade(ref)
  const m = ENTRY[size]
  return (
    <div ref={ref} className={cn('scrollbar-hide flex overflow-x-auto overscroll-x-contain', m.rail)} style={fade}>
      <div role="group" aria-label={t('browse.title')} data-browse-entries="" className={cn('mx-auto inline-flex flex-none', m.row)}>
        {BROWSE_TABS.map(({ tab, label }) => (
          <button
            key={tab}
            type="button"
            onClick={() => onOpen(tab)}
            className={cn('press-pop flex-none whitespace-nowrap rounded-pill bg-ink/[0.08] font-semibold text-ink-2 hover:bg-ink/[0.14] hover:text-ink', m.chip)}
          >
            {t(label)}
          </button>
        ))}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ 标签 */

/** 卡片浏览顶上那排分段标签：当前项底下那块片在选项之间滑动（和播放页的 封面 / 歌词 / 接下来 同一套样子）。
 *  窄屏放不下就横着滑；当前那一栏总在视野里（从「专辑」点进来，「专辑」不该半截在屏幕外） */
function BrowseTabs({ value, onChange, className }: { value: BrowseTab; onChange: (tab: BrowseTab) => void; className?: string }) {
  const { t } = useT()
  const reduce = useReducedMotion()
  const ref = useRef<HTMLDivElement>(null)
  const fade = useEdgeFade(ref)
  const first = useRef(true)

  useLayoutEffect(() => {
    const el = ref.current
    const on = el?.querySelector<HTMLElement>('[aria-selected="true"]')
    if (!el || !on) return
    // 两边各让出渐隐的那 28px
    const r = on.getBoundingClientRect()
    const c = el.getBoundingClientRect()
    const d = r.left - 28 < c.left ? r.left - 28 - c.left : r.right + 28 > c.right ? r.right + 28 - c.right : 0
    if (d) el.scrollBy({ left: d, behavior: first.current || reduce ? 'auto' : 'smooth' })
    first.current = false
  }, [value, reduce])

  return (
    <div ref={ref} className={cn('scrollbar-hide flex overflow-x-auto overscroll-x-contain', className)} style={fade}>
      <div role="tablist" aria-label={t('browse.title')} className="mx-auto inline-flex flex-none gap-0.5 rounded-pill bg-ink/[0.1] p-1 shadow-hair">
        {BROWSE_TABS.map(({ tab, icon: Glyph, label }) => {
          const on = value === tab
          return (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => { haptic('selection'); onChange(tab) }}
              className={cn(
                'relative isolate inline-flex h-9 flex-none items-center gap-1.5 whitespace-nowrap rounded-pill px-3.5 text-[13.5px] font-semibold transition-colors duration-2',
                on ? 'text-ink' : 'text-ink-2 hover:text-ink'
              )}
            >
              {on && (
                <motion.span
                  layoutId="cb-tab"
                  transition={SPRING_SNAPPY}
                  aria-hidden="true"
                  className="absolute inset-0 -z-10 rounded-pill bg-ink/[0.16]"
                />
              )}
              <Glyph size={16} weight={on ? 'fill' : 'regular'} aria-hidden="true" />
              {t(label)}
            </button>
          )
        })}
      </div>
    </div>
  )
}
