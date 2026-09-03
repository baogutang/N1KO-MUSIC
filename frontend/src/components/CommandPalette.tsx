/**
 * ⌘K 命令面板 —— 搜索、跳转、播放动作三合一。
 *
 * ⌘K 此前只是 navigate('/search')，对一个以键盘快捷键为卖点的桌面播放器
 * 这是缺失的那块拼图。
 *
 * 刻意不引 cmdk：它自带的样式会和 v2 的 token 打架，而这里需要的
 * 键盘导航与筛选逻辑本身很薄。基于已有的 Dialog 与 Input 原语即可。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  MagnifyingGlass, MusicNote, Disc, MicrophoneStage, ListBullets,
  Play, SkipForward, Shuffle, ArrowsClockwise, Moon, House, Gear,
} from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { useSearch } from '@/hooks/useServerQueries'
import { usePlayerStore } from '@/store/playerStore'
import { playListFrom, playAllShuffled } from '@/utils/playActions'
import { spaceCJK } from '@/utils/cjkTypography'
import { useT } from '@/i18n'
import type { Song } from '@/api/types'

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

  const { data: rawResults } = useSearch(debounced)
  /**
   * useSearch 带 keepPreviousData，而查询在空串时是 disabled 的——
   * 清空输入框后它会继续把上一次的结果端出来。这里显式在无查询时丢弃。
   */
  const results = debounced ? rawResults : undefined

  const close = useCallback(() => setOpen(false), [])

  // 播放状态要实时订阅：放进 useMemo 里读一次会把标签冻在打开面板那一刻
  const isPlaying = usePlayerStore(s => s.isPlaying)

  /** 静态命令：导航 + 播放控制 */
  const staticCommands = useMemo<Command[]>(() => {
    return [
      { id: 'nav-home', label: t('nav.home'), keywords: 'home shouye', icon: <House size={15} />, run: () => navigate('/') },
      { id: 'nav-library', label: t('nav.library'), keywords: 'library yinyueku', icon: <MusicNote size={15} />, run: () => navigate('/library') },
      { id: 'nav-artists', label: t('nav.artists'), keywords: 'artists geshou', icon: <MicrophoneStage size={15} />, run: () => navigate('/artists') },
      { id: 'nav-playlists', label: t('nav.playlists'), keywords: 'playlists gedan', icon: <ListBullets size={15} />, run: () => navigate('/playlists') },
      { id: 'nav-recommend', label: t('nav.recommendations'), keywords: 'recommend tuijian', icon: <ArrowsClockwise size={15} />, run: () => navigate('/recommendations') },
      { id: 'nav-favorites', label: t('nav.favorites'), keywords: 'favorites shoucang', icon: <Disc size={15} />, run: () => navigate('/favorites') },
      { id: 'nav-stats', label: t('nav.stats'), keywords: 'stats tongji', icon: <Disc size={15} />, run: () => navigate('/stats') },
      { id: 'nav-settings', label: t('nav.settings'), keywords: 'settings shezhi preferences', icon: <Gear size={15} />, run: () => navigate('/settings') },
      {
        id: 'act-play', label: isPlaying ? t('player.pause') : t('player.play'),
        keywords: 'play pause bofang zanting', icon: <Play size={15} />,
        run: () => usePlayerStore.getState().togglePlay(),
      },
      {
        id: 'act-next', label: t('player.next'), keywords: 'next xiayishou',
        icon: <SkipForward size={15} />, run: () => usePlayerStore.getState().next(),
      },
      {
        id: 'act-shuffle', label: t('player.toggleShuffle'), keywords: 'shuffle suiji',
        icon: <Shuffle size={15} />, run: () => usePlayerStore.getState().toggleShuffle(),
      },
      {
        id: 'act-shuffle-queue', label: t('queue.shuffleCurrent'), keywords: 'shuffle queue suiji duilie',
        icon: <Shuffle size={15} />,
        run: () => {
          const { queue } = usePlayerStore.getState()
          if (queue.length) playAllShuffled(queue, 0)
        },
      },
      {
        id: 'act-sleep-30', label: t('player.sleepAfterMinutes', { minutes: 30 }),
        keywords: 'sleep timer shuimian dingshi',
        icon: <Moon size={15} />, run: () => usePlayerStore.getState().setSleepTimer(30),
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
      icon: <MusicNote size={15} />,
      run: () => playListFrom(songs, index),
    }))
  }, [results])

  const albumItems = useMemo<Command[]>(() => (
    (results?.albums ?? []).slice(0, MAX_PER_GROUP).map(album => ({
      id: `album-${album.id}`,
      label: album.name,
      hint: album.artist,
      icon: <Disc size={15} />,
      run: () => navigate(`/albums/${album.id}?src=${encodeURIComponent(album.serverId)}`),
    }))
  ), [results, navigate])

  const artistItems = useMemo<Command[]>(() => (
    (results?.artists ?? []).slice(0, MAX_PER_GROUP).map(artist => ({
      id: `artist-${artist.id}`,
      label: artist.name,
      icon: <MicrophoneStage size={15} />,
      run: () => navigate(`/artists/${artist.id}?src=${encodeURIComponent(artist.serverId)}`),
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
      <DialogContent
        className="top-[12%] max-w-xl translate-y-0 gap-0 p-0"
        onKeyDown={onKeyDown}
      >
        <DialogTitle className="sr-only">{t('search.paletteTitle')}</DialogTitle>

        <div className="flex items-center gap-3 border-b border-hair px-4 py-3.5">
          <MagnifyingGlass size={16} className="flex-none text-ink-faint" aria-hidden="true" />
          <input
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={t('search.palettePlaceholder')}
            aria-label={t('search.paletteAria')}
            className="min-w-0 flex-1 bg-transparent font-serif text-[15px] outline-none placeholder:text-ink-faint"
          />
          <kbd className="font-num flex-none rounded border border-hair px-1.5 py-0.5 text-[10px] text-ink-faint">
            ESC
          </kbd>
        </div>

        <div ref={listRef} className="max-h-[52vh] overflow-y-auto py-1.5">
          {!flat.length && (
            <p className="px-4 py-8 text-center text-[13px] text-ink-faint">
              {trimmed ? t('search.paletteEmpty') : t('search.paletteHint')}
            </p>
          )}

          {groups.map(group => (
            <div key={group.tag} className="mb-1">
              <p className="px-4 pb-1 pt-2 text-[9.5px] uppercase tracking-[0.22em] text-ink-faint">
                {group.title}<span className="latin-tag ml-2 opacity-60">{group.tag}</span>
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
                      'flex w-full items-center gap-3 px-4 py-2 text-left transition-colors duration-100',
                      isActive ? 'bg-paper-deep text-primary' : 'text-foreground hover:bg-paper-deep/60'
                    )}
                  >
                    <span className={cn('flex-none', isActive ? 'text-primary' : 'text-ink-faint')}>
                      {item.icon}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-serif text-[14px]">
                      {spaceCJK(item.label)}
                    </span>
                    {item.hint && (
                      <span className="flex-none truncate text-[11.5px] text-ink-faint">
                        {spaceCJK(item.hint)}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          ))}
        </div>

        <div className="flex items-center gap-4 border-t border-hair px-4 py-2 text-[10.5px] text-ink-faint">
          <span><kbd className="font-num">↑↓</kbd> {t('search.paletteSelect')}</span>
          <span><kbd className="font-num">↵</kbd> {t('search.paletteRun')}</span>
          <span className="ml-auto"><kbd className="font-num">⌘K</kbd> {t('search.paletteToggle')}</span>
        </div>
      </DialogContent>
    </Dialog>
  )
}
