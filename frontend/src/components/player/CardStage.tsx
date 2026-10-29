/**
 * 横屏的正在播放：顶上一排分栏、中间一叠大封面（CardStack）、下面是焦点那张的说明。
 *
 * iPad、手机横过来时，正在播放整页换成它（设置里的「横屏卡片模式」可以关掉，也可以让电脑上的横屏窗口用）。
 * 不再在正在播放底下挂一排「接下来 / 歌单…」的按钮：横过来就是挑歌的姿势，竖回去就是看歌词的姿势。
 *
 * 分栏：接下来 / 推荐 / 专辑 / 歌单 / 收藏。
 * 「接下来」按播放顺序排：放过的在左边（只露出刚放完的那张），正在放的在焦点，后面的叠在右边；换歌时自己跟过去。
 * 其余几栏点哪张放哪张，放了留在原地接着挑（正在放的那张带「正在播放」角标）。每一栏记得自己翻到哪儿。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { Heart, Playlist as PlaylistGlyph, Queue, Sparkle, VinylRecord } from '@phosphor-icons/react'
import type { Icon } from '@phosphor-icons/react'
import type { Album, Playlist, Song } from '@/api/types'
import { findAdapterFor, getAdapterFor } from '@/api'
import { cn } from '@/lib/utils'
import { haptic } from '@/lib/haptics'
import { SPRING_SNAPPY } from '@/lib/motion'
import { useT } from '@/i18n'
import { usePlayerStore } from '@/store/playerStore'
import { useAlbumShelf, useRecentAlbums } from '@/hooks/useServerQueries'
import { interleaveRecommendations, useSourcePlaylists, useSourceStarred } from '@/hooks/useSourceQueries'
import { useMergedRecommendations } from '@/hooks/useMergedRecommendations'
import { toast } from '@/components/ui/use-toast'
import { playAlbum, playAllInOrder, playListFrom } from '@/utils/playActions'
import { spaceCJK } from '@/utils/cjkTypography'
import { CardStack, type StackCard } from './CardStack'

export type CardTab = 'queue' | 'recommend' | 'albums' | 'playlists' | 'favorites'

export const CARD_TABS: { tab: CardTab; icon: Icon; label: string }[] = [
  { tab: 'queue', icon: Queue, label: 'shell.upNext' },
  { tab: 'recommend', icon: Sparkle, label: 'nav.recommendations' },
  { tab: 'albums', icon: VinylRecord, label: 'nav.albums' },
  { tab: 'playlists', icon: PlaylistGlyph, label: 'nav.playlists' },
  { tab: 'favorites', icon: Heart, label: 'nav.favorites' },
]

/** 推荐一栏最多几首（和为你推荐页一样） */
const RECOMMEND_MAX = 60

type Status = 'loading' | 'error' | 'ready'

/** 从卡片叠里放了哪个歌单、放出来的是哪条队列（引用比较） */
interface PlaylistStart {
  key: string
  queue: Song[]
}

/** 一栏的数据：卡片、加载状态、挂上时停在哪张、点了怎么放 */
interface PaneData {
  cards: StackCard[]
  status: Status
  /** 没有记忆时停在哪一张（通常是正在放的那张） */
  start: number
  play: (index: number) => void | Promise<void>
  /** 外面要卡片叠挪过去（「接下来」换歌时跟着走） */
  focusTo?: { index: number; token: number; instant?: boolean }
  /** 点「正在播放」的那张还要不要动作：歌曲卡不动（免得点一下就从头放），专辑 / 歌单是「从头放这一张」 */
  replayCurrent?: boolean
}

function coverOf(serverId: string, coverArt: string | undefined) {
  if (!coverArt) return undefined
  return findAdapterFor(serverId)?.getCoverUrl(coverArt, 640) ?? coverArt
}

const sameSong = (a: Song | null | undefined, b: Song) => !!a && a.id === b.id && a.serverId === b.serverId

/* ------------------------------------------------------------------ 每一栏的数据 */

function useQueuePane(): PaneData {
  const queue = usePlayerStore(s => s.queue)
  const queueIndex = usePlayerStore(s => s.queueIndex)
  const shuffle = usePlayerStore(s => s.shuffle)
  const shuffledIndexes = usePlayerStore(s => s.shuffledIndexes)
  const jumpToIndex = usePlayerStore(s => s.jumpToIndex)

  // 播放顺序（开着随机就按随机序）：放过的在左，后面的在右
  const order = useMemo(() => {
    const identity = queue.map((_, i) => i)
    if (!shuffle || shuffledIndexes.length !== queue.length) return identity
    return shuffledIndexes
  }, [queue, shuffle, shuffledIndexes])
  const pos = Math.max(0, order.indexOf(queueIndex))

  const cards = useMemo(() => order.map(qi => {
    const song = queue[qi]
    return {
      key: `q-${qi}-${song.serverId}:${song.id}`,
      title: song.title,
      subtitle: song.artist,
      song,
      current: qi === queueIndex,
    }
  }), [order, queue, queueIndex])

  // 换歌了（自动播完、按了下一首）：卡片叠跟到正在放的那张。
  // 是从叠里点出来的就直接到位：开着随机播放时，被点的那首会挪到当前这首后面、整串重排，
  // 那张卡本身还在手指底下，叠不该从远处飞回来
  const [focusTo, setFocusTo] = useState<{ index: number; token: number; instant?: boolean }>()
  const lastPos = useRef(pos)
  const tapped = useRef(false)
  useEffect(() => {
    if (pos === lastPos.current) return
    lastPos.current = pos
    setFocusTo({ index: pos, token: performance.now(), instant: tapped.current })
    tapped.current = false
  }, [pos])

  return {
    cards,
    status: 'ready',
    start: pos,
    focusTo,
    play: i => {
      const qi = order[i]
      if (qi === undefined || qi === queueIndex) return
      tapped.current = true
      jumpToIndex(qi)
    },
  }
}

function useRecommendPane(): PaneData {
  const { t } = useT()
  const current = usePlayerStore(s => s.currentSong)
  const { grouped, isFetching, failed } = useMergedRecommendations(RECOMMEND_MAX)
  const songs = useMemo(() => interleaveRecommendations(grouped, RECOMMEND_MAX), [grouped])
  const cards = useMemo(() => songs.map(song => ({
    key: `r-${song.serverId}:${song.id}`,
    title: song.title,
    subtitle: song.artist,
    song,
    current: sameSong(current, song),
  })), [songs, current])
  const status: Status = songs.length ? 'ready' : isFetching ? 'loading' : failed.length ? 'error' : 'ready'
  return {
    cards,
    status,
    start: Math.max(0, songs.findIndex(s => sameSong(current, s))),
    play: i => {
      if (!songs[i]) return void toast({ title: t('browse.noSongs') })
      playListFrom(songs, i)
    },
  }
}

function useAlbumsPane(): PaneData {
  const current = usePlayerStore(s => s.currentSong)
  // 最近播放的专辑；新库还没有播放记录时，退回最新入库的
  const recent = useRecentAlbums(40)
  const newest = useAlbumShelf('newest', 40)
  const albums: Album[] = useMemo(() => {
    const r = recent.data ?? []
    return r.length ? r : newest.data?.items ?? []
  }, [recent.data, newest.data])
  // 正在放的歌属于哪张专辑（同一个 id 在两个音源下可能都有，连来源一起比）
  const playingAlbum = current?.albumId ? `${current.serverId}:${current.albumId}` : null
  const cards = useMemo(() => albums.map(al => ({
    key: `a-${al.serverId}:${al.id}`,
    title: al.name,
    subtitle: al.artist,
    url: coverOf(al.serverId, al.coverArt),
    current: `${al.serverId}:${al.id}` === playingAlbum,
  })), [albums, playingAlbum])
  const status: Status = albums.length ? 'ready'
    : recent.isLoading || newest.isLoading ? 'loading'
      : recent.isError && newest.isError ? 'error' : 'ready'
  return {
    cards,
    status,
    start: Math.max(0, cards.findIndex(c => c.current)),
    replayCurrent: true,
    play: async i => {
      const al = albums[i]
      if (al) await playAlbum(al)
    },
  }
}

function usePlaylistsPane(started: PlaylistStart | null, setStarted: (start: PlaylistStart) => void): PaneData {
  const { t } = useT()
  const queue = usePlayerStore(s => s.queue)
  // 播放状态里没有「这是哪个歌单」：记下从叠里放的是哪个、放出来的是哪条队列；队列一换（放了别的），角标就灭
  const playingKey = started && started.queue === queue ? started.key : null
  const groups = useSourcePlaylists()
  const lists: Playlist[] = useMemo(() => groups.flatMap(g => (g.status === 'success' ? g.data ?? [] : [])), [groups])
  const cards = useMemo(() => lists.map(pl => {
    const key = `p-${pl.serverId}:${pl.id}`
    return {
      key,
      title: pl.name,
      subtitle: pl.songCount ? t('library.songsCount', { count: pl.songCount }) : pl.owner,
      url: coverOf(pl.serverId, pl.coverArt),
      current: key === playingKey,
    }
  }), [lists, playingKey, t])
  const status: Status = lists.length ? 'ready'
    : groups.some(g => g.status === 'loading') ? 'loading'
      : groups.length && groups.every(g => g.status === 'error') ? 'error' : 'ready'
  return {
    cards,
    status,
    start: Math.max(0, cards.findIndex(c => c.current)),
    replayCurrent: true,
    play: async i => {
      const pl = lists[i]
      if (!pl) return
      try {
        const detail = await getAdapterFor(pl.serverId).getPlaylistDetail(pl.id)
        if (!detail?.songs?.length) return void toast({ title: t('playlist.emptyToast') })
        playAllInOrder(detail.songs, 0)
        setStarted({ key: `p-${pl.serverId}:${pl.id}`, queue: usePlayerStore.getState().queue })
      } catch {
        toast({ title: t('playlist.loadFailed'), variant: 'destructive' })
      }
    },
  }
}

function useFavoritesPane(): PaneData {
  const current = usePlayerStore(s => s.currentSong)
  const groups = useSourceStarred()
  const favs: Song[] = useMemo(() => groups.flatMap(g => (g.status === 'success' ? g.data?.songs ?? [] : [])), [groups])
  const cards = useMemo(() => favs.map(song => ({
    key: `f-${song.serverId}:${song.id}`,
    title: song.title,
    subtitle: song.artist,
    song,
    current: sameSong(current, song),
  })), [favs, current])
  const status: Status = favs.length ? 'ready'
    : groups.some(g => g.status === 'loading') ? 'loading'
      : groups.length && groups.every(g => g.status === 'error') ? 'error' : 'ready'
  return {
    cards,
    status,
    start: Math.max(0, favs.findIndex(s => sameSong(current, s))),
    play: i => { if (favs[i]) playListFrom(favs, i) },
  }
}

/* ------------------------------------------------------------------ 一栏 */

function Pane({ data, remembered, onRemember, label }: {
  data: PaneData
  remembered: number | undefined
  onRemember: (index: number) => void
  label: string
}) {
  const { t } = useT()
  const reduce = useReducedMotion()
  const { cards, status } = data
  const initial = Math.max(0, Math.min(cards.length - 1, remembered ?? data.start))
  const [focus, setFocus] = useState(initial)
  const [busy, setBusy] = useState(false)
  const card = cards[Math.min(focus, cards.length - 1)]

  const activate = useCallback(async (i: number) => {
    const c = cards[i]
    if (!c || busy || (c.current && !data.replayCurrent)) return
    setBusy(true)
    haptic('light')
    try {
      await data.play(i)
    } finally {
      setBusy(false)
    }
  }, [cards, busy, data])

  if (status !== 'ready' || !cards.length) {
    return (
      <div className="grid min-h-0 flex-1 place-items-center px-8 text-center">
        <p className={cn('text-[15px] font-medium', status === 'loading' ? 'animate-pulse text-ink-3' : 'text-ink-2')}>
          {status === 'loading' ? t('action.loading') : status === 'error' ? t('browse.loadFailed') : t('browse.empty')}
        </p>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <CardStack
        cards={cards}
        initial={initial}
        focusTo={data.focusTo}
        onFocus={i => { setFocus(i); onRemember(i) }}
        onActivate={i => void activate(i)}
        label={label}
        className="flex-1"
      />
      {/* 焦点那张是什么：歌名 / 专辑名、副标题、第几张 */}
      <div className="flex flex-none flex-col items-center px-8 pt-3 text-center" aria-hidden="true">
        {card && (
          <motion.div
            key={card.key}
            initial={reduce ? false : { opacity: 0, transform: 'translateY(6px)' }}
            animate={{ opacity: 1, transform: 'translateY(0px)' }}
            transition={SPRING_SNAPPY}
            className="max-w-[min(80vw,720px)]"
          >
            <p className="line-clamp-1 font-display text-[24px] font-semibold leading-tight tracking-[-0.02em] text-ink regular:text-[26px]">
              {spaceCJK(card.title)}
            </p>
            <p className="mt-1 flex justify-center gap-3 text-[15px] font-medium text-ink-2">
              {card.subtitle && <span className="line-clamp-1">{spaceCJK(card.subtitle)}</span>}
              <span className="num flex-none text-ink-3">{Math.min(focus, cards.length - 1) + 1} / {cards.length}</span>
            </p>
          </motion.div>
        )}
      </div>
    </div>
  )
}

/* 每一栏单独一个组件：只有正在看的那一栏取数据（推荐要算画像、歌单要问每个音源） */
type PaneProps = { remembered: number | undefined; onRemember: (index: number) => void; label: string }
function QueuePane(props: PaneProps) { return <Pane data={useQueuePane()} {...props} /> }
function RecommendPane(props: PaneProps) { return <Pane data={useRecommendPane()} {...props} /> }
function AlbumsPane(props: PaneProps) { return <Pane data={useAlbumsPane()} {...props} /> }
function FavoritesPane(props: PaneProps) { return <Pane data={useFavoritesPane()} {...props} /> }
function PlaylistsPane(props: PaneProps & { started: PlaylistStart | null; setStarted: (start: PlaylistStart) => void }) {
  const { started, setStarted, ...rest } = props
  return <Pane data={usePlaylistsPane(started, setStarted)} {...rest} />
}

/* ------------------------------------------------------------------ 整页 */

export function CardStage({ tab }: { tab: CardTab }) {
  const { t } = useT()
  const reduce = useReducedMotion()
  // 每一栏翻到哪儿：切去别的栏看一眼再切回来，还停在原处
  const memory = useRef(new Map<CardTab, number>())
  // 从卡片叠里放的是哪个歌单（歌单本身不在播放状态里，只能记在这儿）
  const [playlistStart, setPlaylistStart] = useState<PlaylistStart | null>(null)
  const props = {
    // 「接下来」不记：队列随时会变（放了别的、自动播完），回来时应当停在正在放的那张
    remembered: tab === 'queue' ? undefined : memory.current.get(tab),
    onRemember: (i: number) => { memory.current.set(tab, i) },
    label: t(CARD_TABS.find(x => x.tab === tab)?.label ?? 'shell.upNext'),
  }
  return (
    <motion.div
      key={tab}
      className="flex min-h-0 flex-1 flex-col"
      initial={reduce ? false : { opacity: 0, transform: 'translateX(24px)' }}
      animate={{ opacity: 1, transform: 'translateX(0px)' }}
      transition={SPRING_SNAPPY}
    >
      {tab === 'queue' && <QueuePane {...props} />}
      {tab === 'recommend' && <RecommendPane {...props} />}
      {tab === 'albums' && <AlbumsPane {...props} />}
      {tab === 'playlists' && <PlaylistsPane {...props} started={playlistStart} setStarted={setPlaylistStart} />}
      {tab === 'favorites' && <FavoritesPane {...props} />}
    </motion.div>
  )
}

/* ------------------------------------------------------------------ 分栏 */

/** 顶栏中间那排分段标签：当前项底下那块片在选项之间滑动（和竖屏的 封面 / 歌词 / 接下来 同一套样子） */
export function CardTabs({ value, onChange }: { value: CardTab; onChange: (tab: CardTab) => void }) {
  const { t } = useT()
  return (
    <div role="tablist" aria-label={t('player.nowPlaying')} className="inline-flex flex-none gap-0.5 rounded-pill bg-ink/[0.1] p-1 shadow-hair">
      {CARD_TABS.map(({ tab, icon: Glyph, label }) => {
        const on = value === tab
        return (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => { if (!on) haptic('selection'); onChange(tab) }}
            className={cn(
              'relative isolate inline-flex h-9 flex-none items-center gap-1.5 whitespace-nowrap rounded-pill px-3.5 text-[13.5px] font-semibold transition-colors duration-2',
              on ? 'text-ink' : 'text-ink-2 hover:text-ink'
            )}
          >
            {on && (
              <motion.span
                layoutId="card-tab"
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
  )
}
