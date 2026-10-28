/**
 * ⌘K 命令面板 —— 搜索、跳转、播放动作三合一。
 *
 * ⌘K 此前只是 navigate('/search')，对一个以键盘快捷键为卖点的桌面播放器
 * 这是缺失的那块拼图。
 *
 * 刻意不引 cmdk：它自带的样式会和我们的 token 打架，而这里需要的
 * 键盘导航与筛选逻辑本身很薄。基于已有的 Dialog 与 Input 原语即可：
 * 一块玻璃（ui/Dialog + glass）＋ 56px 无框输入行（只有底下一道发丝线）＋ 分组结果行 ＋ 底部快捷键提示。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  MagnifyingGlass, MusicNote, Disc, MicrophoneStage, ListBullets,
  Play, SkipForward, Shuffle, ArrowsClockwise, Moon, House, Gear,
} from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { usePlayerStore } from '@/store/playerStore'
import { playListFrom, playAllShuffled } from '@/utils/playActions'
import { spaceCJK } from '@/utils/cjkTypography'
import { useT } from '@/i18n'
import type { Song } from '@/api/types'
import { useSourceSearch, usePlaybackPriorityOrder } from '@/hooks/useSourceQueries'
import { mergeSongs } from '@/plugins/match'
import { detailPath } from '@/utils/detailPath'
import { notePauseReason } from '@/lib/playbackTrail'

interface Command {
  id: string
  label: string
  hint?: string
  icon: React.ReactNode
  run: () => void
  /** 用于筛选的额外关键词 */
  keywords?: string
}

const MAX_PER_GROUP = 5

/** 键帽：一小块墨色淡底，不画框 */
const KEYCAP = 'num flex-none rounded-xs bg-ink/[0.07] px-1.5 py-0.5 font-sans text-[12px] font-medium leading-4 text-ink-2'

export function CommandPalette() {
  const { t } = useT()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const navigate = useNavigate()
  const listRef = useRef<HTMLDivElement>(null)

  // ⌘K / Ctrl+K 开关。绑在 document 上以便任何焦点位置都能触发。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen(prev => !prev)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!open) { setQuery(''); setActive(0) }
  }, [open])

  const trimmed = query.trim()

  /**
   * 输入防抖。每敲一个键就发一次 search3，输入「beatles」等于七次请求，
   * 对家里的 NAS 是没必要的压力。
   */
  const [debounced, setDebounced] = useState('')
  useEffect(() => {
    if (!trimmed) { setDebounced(''); return }
    const timer = setTimeout(() => setDebounced(trimmed), 180)
    return () => clearTimeout(timer)
  }, [trimmed])

  /*
   * ⌘K 也要搜**所有**已连接音源。
   *
   * 早先这里只用 useSearch（主库）：连着 NAS + 网易云 + QQ 时，⌘K 静默少两个源，
   * 而搜索页是聚合的——同一个关键词在两处给出不同结果，用户只会以为「⌘K 搜不到」。
   * 单源时两条链路的 query key 相同，React Query 去重，不会多打请求。
   */
  const sourceGroups = useSourceSearch(debounced)
  const priorityOrder = usePlaybackPriorityOrder()
  const results = useMemo(() => {
    if (!debounced) return undefined
    const ok = sourceGroups.filter(g => g.status === 'success' && g.data)
    if (!ok.length) return undefined
    const order = priorityOrder.map(s => s.serverId)
    // 与搜索页同一套合并：按相关度混排，而不是按源拼接
    const merged = mergeSongs(
      ok.map(g => ({ serverId: g.serverId, songs: g.data!.songs })),
      order,
      debounced,
    )
    /** 专辑 / 歌手按源轮转取，避免第一个源把面板占满 */
    const roundRobin = <T,>(lists: T[][]): T[] => {
      const out: T[] = []
      for (let i = 0; out.length < MAX_PER_GROUP * 2; i++) {
        const before = out.length
        for (const list of lists) if (list[i]) out.push(list[i])
        if (out.length === before) break
      }
      return out
    }
    return {
      songs: merged.map(m => m.song),
      albums: roundRobin(ok.map(g => g.data!.albums ?? [])),
      artists: roundRobin(ok.map(g => g.data!.artists ?? [])),
    }
  }, [debounced, sourceGroups, priorityOrder])

  const close = useCallback(() => setOpen(false), [])

  // 播放状态要实时订阅：放进 useMemo 里读一次会把标签冻在打开面板那一刻
  const isPlaying = usePlayerStore(s => s.isPlaying)

  /** 静态命令：导航 + 播放控制 */
  const staticCommands = useMemo<Command[]>(() => {
    return [
      { id: 'nav-home', label: t('nav.home'), keywords: 'home shouye', icon: <House size={18} />, run: () => navigate('/') },
      { id: 'nav-library', label: t('nav.library'), keywords: 'library yinyueku', icon: <MusicNote size={18} />, run: () => navigate('/library') },
      { id: 'nav-artists', label: t('nav.artists'), keywords: 'artists geshou', icon: <MicrophoneStage size={18} />, run: () => navigate('/artists') },
      { id: 'nav-playlists', label: t('nav.playlists'), keywords: 'playlists gedan', icon: <ListBullets size={18} />, run: () => navigate('/playlists') },
      { id: 'nav-recommend', label: t('nav.recommendations'), keywords: 'recommend tuijian', icon: <ArrowsClockwise size={18} />, run: () => navigate('/recommendations') },
      { id: 'nav-favorites', label: t('nav.favorites'), keywords: 'favorites shoucang', icon: <Disc size={18} />, run: () => navigate('/favorites') },
      { id: 'nav-stats', label: t('nav.stats'), keywords: 'stats tongji', icon: <Disc size={18} />, run: () => navigate('/stats') },
      { id: 'nav-settings', label: t('nav.settings'), keywords: 'settings shezhi preferences', icon: <Gear size={18} />, run: () => navigate('/settings') },
      {
        id: 'act-play', label: isPlaying ? t('player.pause') : t('player.play'),
        keywords: 'play pause bofang zanting', icon: <Play size={18} />,
        run: () => { notePauseReason('ui', 'command palette'); usePlayerStore.getState().togglePlay() },
      },
      {
        id: 'act-next', label: t('player.next'), keywords: 'next xiayishou',
        icon: <SkipForward size={18} />, run: () => usePlayerStore.getState().next(),
      },
      {
        id: 'act-shuffle', label: t('player.toggleShuffle'), keywords: 'shuffle suiji',
        icon: <Shuffle size={18} />, run: () => usePlayerStore.getState().toggleShuffle(),
      },
      {
        id: 'act-shuffle-queue', label: t('queue.shuffleCurrent'), keywords: 'shuffle queue suiji duilie',
        icon: <Shuffle size={18} />,
        run: () => {
          const { queue } = usePlayerStore.getState()
          if (queue.length) playAllShuffled(queue, 0)
        },
      },
      {
        id: 'act-sleep-30', label: t('player.sleepAfterMinutes', { minutes: 30 }),
        keywords: 'sleep timer shuimian dingshi',
        icon: <Moon size={18} />, run: () => usePlayerStore.getState().setSleepTimer(30),
      },
    ]
  }, [t, navigate, isPlaying])

  const filteredCommands = useMemo(() => {
    if (!trimmed) return staticCommands.slice(0, 8)
    const q = trimmed.toLocaleLowerCase()
    return staticCommands
      .filter(c => c.label.toLocaleLowerCase().includes(q) || c.keywords?.includes(q))
      .slice(0, MAX_PER_GROUP)
  }, [staticCommands, trimmed])

  /** 搜索结果转成可执行项 */
  const songItems = useMemo<Command[]>(() => {
    const songs = results?.songs ?? []
    return songs.slice(0, MAX_PER_GROUP).map((song: Song, index: number) => ({
      id: `song-${song.id}`,
      label: song.title,
      hint: song.artist,
      icon: <MusicNote size={18} />,
      run: () => playListFrom(songs, index),
    }))
  }, [results])

  const albumItems = useMemo<Command[]>(() => (
    (results?.albums ?? []).slice(0, MAX_PER_GROUP).map(album => ({
      id: `album-${album.id}`,
      label: album.name,
      hint: album.artist,
      icon: <Disc size={18} />,
      run: () => navigate(detailPath('albums', album.id, album.serverId)),
    }))
  ), [results, navigate])

  const artistItems = useMemo<Command[]>(() => (
    (results?.artists ?? []).slice(0, MAX_PER_GROUP).map(artist => ({
      id: `artist-${artist.id}`,
      label: artist.name,
      icon: <MicrophoneStage size={18} />,
      run: () => navigate(detailPath('artists', artist.id, artist.serverId)),
    }))
  ), [results, navigate])

  const groups = useMemo(() => ([
    { title: t('search.groupCommands'), tag: 'COMMANDS', items: filteredCommands },
    { title: t('library.songs'), tag: 'SONGS', items: songItems },
    { title: t('library.albums'), tag: 'ALBUMS', items: albumItems },
    { title: t('nav.artists'), tag: 'ARTISTS', items: artistItems },
  ]).filter(g => g.items.length), [t, filteredCommands, songItems, albumItems, artistItems])

  const flat = useMemo(() => groups.flatMap(g => g.items), [groups])

  // 结果变化时把高亮收回首项，否则下标可能指向已消失的条目
  useEffect(() => { setActive(0) }, [trimmed, flat.length])

  const runActive = useCallback(() => {
    const item = flat[active]
    if (!item) return
    item.run()
    close()
  }, [flat, active, close])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive(i => (i + 1) % Math.max(1, flat.length))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive(i => (i - 1 + flat.length) % Math.max(1, flat.length))
    } else if (e.key === 'Enter') {
      /* 组词中的 Enter 是确认候选词，不是提交（阶段 2.5；复核 F14 补上此处） */
      if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return
      e.preventDefault()
      runActive()
    }
  }

  // 高亮项滚动进视野
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('[data-active="true"]')
    el?.scrollIntoView({ block: 'nearest' })
  }, [active])

  let cursor = -1

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {/*
        玻璃面板：贴顶偏下（Spotlight 的位置）；窄窗口四周留 12px 而不是贴底升起。
        玻璃调到 94% 不透明：Dialog 的遮罩带 opacity 动画，会让它成了「背景根」，
        里面这块玻璃的 backdrop-filter 看不到遮罩之外的东西（模糊失效），透明度再低底下的字就透出来了。
      */}
      <DialogContent
        aria-describedby={undefined}
        className="glass mt-[calc(env(safe-area-inset-top)+12px)] w-[calc(100%-24px)] max-w-[640px] gap-0 self-start overflow-hidden rounded-xl p-0 [--glass-alpha:0.94] regular:mt-[12vh] regular:w-full regular:p-0"
        onKeyDown={onKeyDown}
      >
        <DialogTitle className="sr-only">{t('search.paletteTitle')}</DialogTitle>

        {/* 输入行：56px 高，没有框，只有底下一道发丝线；右侧让出 Dialog 自带的关闭键（absolute right-3 top-3，36px） */}
        <div className="hairline-b flex h-14 flex-none items-center pl-4 pr-14">
          <div className="relative w-full">
            <MagnifyingGlass
              size={20}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3"
              aria-hidden="true"
            />
            <Input
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={t('search.palettePlaceholder')}
              aria-label={t('search.paletteAria')}
              className="h-10 border-transparent bg-transparent pl-10 text-[17px] hover:border-transparent regular:text-[17px]"
            />
          </div>
        </div>

        <div ref={listRef} className="max-h-[52vh] overflow-y-auto p-2">
          {!flat.length && (
            <p className="px-4 py-10 text-center text-[14px] text-ink-3">
              {trimmed ? t('search.paletteEmpty') : t('search.paletteHint')}
            </p>
          )}

          {groups.map(group => (
            <div key={group.tag} className="mb-1">
              <p className="px-3 pb-1 pt-3 text-[13px] font-semibold text-ink-3">
                {group.title}
              </p>
              {group.items.map(item => {
                cursor += 1
                const index = cursor
                const isActive = index === active
                return (
                  <button
                    key={item.id}
                    data-active={isActive}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => { item.run(); close() }}
                    className={cn(
                      'flex min-h-11 w-full items-center gap-3 rounded-[12px] px-3 py-2 text-left text-ink transition-colors duration-1',
                      isActive ? 'bg-ink/[0.08] hover:bg-ink/[0.08]' : 'hover:bg-ink/[0.06]'
                    )}
                  >
                    <span className={cn('flex-none', isActive ? 'text-leaf' : 'text-ink-3')}>
                      {item.icon}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[15px] font-medium">
                      {spaceCJK(item.label)}
                    </span>
                    {item.hint && (
                      <span className="max-w-[45%] flex-none truncate text-[13px] text-ink-3">
                        {spaceCJK(item.hint)}
                      </span>
                    )}
                    {isActive && (
                      <kbd aria-hidden="true" className={KEYCAP}>↵</kbd>
                    )}
                  </button>
                )
              })}
            </div>
          ))}
        </div>

        <div className="hairline-t flex flex-wrap items-center gap-x-4 gap-y-1.5 px-5 py-3 text-[13px] text-ink-3">
          <span className="flex items-center gap-1.5"><kbd className={KEYCAP}>↑↓</kbd>{t('search.paletteSelect')}</span>
          <span className="flex items-center gap-1.5"><kbd className={KEYCAP}>↵</kbd>{t('search.paletteRun')}</span>
          <span className="flex items-center gap-1.5"><kbd className={KEYCAP}>esc</kbd>{t('dialog.close')}</span>
          <span className="ml-auto flex items-center gap-1.5"><kbd className={KEYCAP}>⌘K</kbd>{t('search.paletteToggle')}</span>
        </div>
      </DialogContent>
    </Dialog>
  )
}
