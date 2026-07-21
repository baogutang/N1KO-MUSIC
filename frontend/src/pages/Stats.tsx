import { useMemo, useState, useEffect } from 'react'
import { Headphones } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import type { Song } from '@/api/types'
import { formatDurationNatural } from '@/utils/formatters'
import { getAdapter, hasAdapter } from '@/api'
import { ImageWithFallback } from '@/components/common/ImageWithFallback'

interface HistoryEntry {
  song: Song
  playedAt: number
}

function getHistory(): HistoryEntry[] {
  try {
    return JSON.parse(localStorage.getItem('msp-play-history') ?? '[]')
  } catch {
    return []
  }
}

export default function Stats() {
  // 使用 state 存储历史，进入页面时刷新，并监听实时更新事件
  const [historyData, setHistoryData] = useState(() => getHistory())

  useEffect(() => {
    setHistoryData(getHistory())
    const onUpdate = () => setHistoryData(getHistory())
    window.addEventListener('msp-history-updated', onUpdate)
    return () => window.removeEventListener('msp-history-updated', onUpdate)
  }, [])

  const stats = useMemo(() => {
    const history = historyData
    if (!history.length) return null

    const totalPlays = history.length
    const totalDuration = history.reduce((sum, e) => sum + (e.song.duration ?? 0), 0)

    // Top songs
    const songCounts = new Map<string, { song: Song; count: number }>()
    history.forEach(e => {
      const key = e.song.id
      const existing = songCounts.get(key)
      if (existing) existing.count++
      else songCounts.set(key, { song: e.song, count: 1 })
    })
    const topSongs = Array.from(songCounts.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)

    // Top artists
    const artistCounts = new Map<string, { name: string; count: number; coverArt?: string }>()
    history.forEach(e => {
      const key = e.song.artist ?? '未知歌手'
      const existing = artistCounts.get(key)
      if (existing) existing.count++
      else artistCounts.set(key, { name: key, count: 1, coverArt: e.song.coverArt })
    })
    const topArtists = Array.from(artistCounts.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)

    // Top albums
    const albumCounts = new Map<string, { name: string; artist?: string; coverArt?: string; count: number }>()
    history.forEach(e => {
      if (!e.song.album) return
      const key = e.song.albumId ?? e.song.album
      const existing = albumCounts.get(key)
      if (existing) existing.count++
      else albumCounts.set(key, { name: e.song.album, artist: e.song.artist, coverArt: e.song.coverArt, count: 1 })
    })
    const topAlbums = Array.from(albumCounts.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)

    // Daily chart (last 7 days)
    // 以本地零点为分桶边界，否则"今天"的窗口落在未来，早于当前时刻的播放会被记到前一天
    const startOfToday = new Date()
    startOfToday.setHours(0, 0, 0, 0)
    const DAY = 86400000
    const dailyCounts = Array.from({ length: 7 }, (_, i) => {
      const dayStart = startOfToday.getTime() - (6 - i) * DAY
      const dayEnd = dayStart + DAY
      const count = history.filter(e => e.playedAt >= dayStart && e.playedAt < dayEnd).length
      const d = new Date(dayStart)
      return { label: `${d.getMonth() + 1}/${d.getDate()}`, count }
    })

    // Unique artists
    const uniqueArtists = new Set(history.map(e => e.song.artist)).size
    const uniqueAlbums = new Set(history.map(e => e.song.albumId ?? e.song.album).filter(Boolean)).size

    return {
      totalPlays,
      totalDuration,
      uniqueArtists,
      uniqueAlbums,
      topSongs,
      topArtists,
      topAlbums,
      dailyCounts,
    }
  }, [historyData])

  const maxDailyCount = stats ? Math.max(...stats.dailyCounts.map(d => d.count), 1) : 1

  return (
    <div className="min-h-full pb-8 animate-fade-in">
      <div className="px-6 py-6">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">听歌统计</h1>
          <p className="text-muted-foreground mt-1.5 text-[13.5px]">你的音乐数据报告</p>
        </div>

        {!stats ? (
          <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
            <Headphones className="w-16 h-16 mb-4 opacity-20" />
            <p className="text-lg mb-1">暂无数据</p>
            <p className="text-sm">多听一些音乐，数据就会出现在这里</p>
          </div>
        ) : (
          <>
            {/* Stat strip */}
            <div className="grid grid-cols-2 md:grid-cols-4 border-y border-border mb-10">
              <div className="px-5 py-6">
                <p className="font-num text-3xl font-medium tracking-tight">{stats.totalPlays}</p>
                <p className="text-xs text-muted-foreground mt-1.5">总播放次数</p>
              </div>
              <div className="px-5 py-6 border-l border-border">
                <p className="font-num text-3xl font-medium tracking-tight">{formatDurationNatural(stats.totalDuration)}</p>
                <p className="text-xs text-muted-foreground mt-1.5">总时长</p>
              </div>
              <div className="px-5 py-6 border-t border-border md:border-t-0 md:border-l">
                <p className="font-num text-3xl font-medium tracking-tight">
                  {stats.uniqueArtists}
                  <span className="text-sm font-normal text-muted-foreground ml-1">位</span>
                </p>
                <p className="text-xs text-muted-foreground mt-1.5">不同歌手</p>
              </div>
              <div className="px-5 py-6 border-t border-l border-border md:border-t-0">
                <p className="font-num text-3xl font-medium tracking-tight">
                  {stats.uniqueAlbums}
                  <span className="text-sm font-normal text-muted-foreground ml-1">张</span>
                </p>
                <p className="text-xs text-muted-foreground mt-1.5">不同专辑</p>
              </div>
            </div>

            {/* Weekly chart */}
            <div className="mb-12">
              <h2 className="text-lg font-bold mb-4">最近 7 天</h2>
              <div className="grid grid-cols-7 gap-3 items-end pt-2">
                {stats.dailyCounts.map(day => {
                  const isPeak = day.count > 0 && day.count === maxDailyCount
                  return (
                    <div key={day.label} className="flex flex-col items-center min-w-0">
                      <span
                        className={cn(
                          'font-num text-[11px] mb-1.5',
                          isPeak ? 'text-primary' : 'text-muted-foreground'
                        )}
                      >
                        {day.count || ''}
                      </span>
                      <div className="w-full h-36 flex items-end">
                        <div
                          className={cn(
                            'w-full rounded-t-md min-h-[4px] transition-all duration-500',
                            isPeak ? 'bg-gradient-to-b from-primary to-primary/80' : 'bg-accent'
                          )}
                          style={{ height: `${Math.max((day.count / maxDailyCount) * 100, 3)}%` }}
                        />
                      </div>
                      <span className="font-num text-[11px] text-muted-foreground mt-2.5">{day.label}</span>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Top content - 3 ranked columns */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-10 border-t border-border pt-8">
              {/* Top songs */}
              <div>
                <h2 className="text-[15px] font-bold mb-4">最爱歌曲</h2>
                <div className="space-y-1">
                  {stats.topSongs.map((item, i) => (
                    <div key={item.song.id} className="flex items-center gap-3 py-1.5">
                      <span className="font-num w-5 text-center text-xs text-muted-foreground flex-shrink-0">{i + 1}</span>
                      <div className="w-10 h-10 rounded-md ring-1 ring-border overflow-hidden flex-shrink-0">
                        <ImageWithFallback
                          src={item.song.coverArt && hasAdapter() ? getAdapter().getCoverUrl(item.song.coverArt, 64) : undefined}
                          alt={item.song.title}
                          fallbackType="album"
                          className="w-full h-full"
                          customCoverParams={{ type: 'song', title: item.song.title, artist: item.song.artist, album: item.song.album, path: item.song.path }}
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-semibold truncate">{item.song.title}</p>
                        <p className="text-xs text-muted-foreground truncate mt-0.5">{item.song.artist}</p>
                      </div>
                      <span className="font-num text-xs text-muted-foreground flex-shrink-0">{item.count}次</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Top artists */}
              <div>
                <h2 className="text-[15px] font-bold mb-4">最爱歌手</h2>
                <div className="space-y-1">
                  {stats.topArtists.map((item, i) => (
                    <div key={item.name} className="flex items-center gap-3 py-1.5">
                      <span className="font-num w-5 text-center text-xs text-muted-foreground flex-shrink-0">{i + 1}</span>
                      <div className="w-10 h-10 rounded-full ring-1 ring-border overflow-hidden flex-shrink-0">
                        <ImageWithFallback
                          src={item.coverArt && hasAdapter() ? getAdapter().getCoverUrl(item.coverArt, 64) : undefined}
                          alt={item.name}
                          fallbackType="artist"
                          className="w-full h-full"
                          customCoverParams={{ type: 'artist', artist: item.name }}
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-semibold truncate">{item.name}</p>
                      </div>
                      <span className="font-num text-xs text-muted-foreground flex-shrink-0">{item.count}次</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Top albums */}
              <div>
                <h2 className="text-[15px] font-bold mb-4">最爱专辑</h2>
                <div className="space-y-1">
                  {stats.topAlbums.map((item, i) => (
                    <div key={item.name} className="flex items-center gap-3 py-1.5">
                      <span className="font-num w-5 text-center text-xs text-muted-foreground flex-shrink-0">{i + 1}</span>
                      <div className="w-10 h-10 rounded-md ring-1 ring-border overflow-hidden flex-shrink-0">
                        <ImageWithFallback
                          src={item.coverArt && hasAdapter() ? getAdapter().getCoverUrl(item.coverArt, 64) : undefined}
                          alt={item.name}
                          fallbackType="album"
                          className="w-full h-full"
                          customCoverParams={{ type: 'album', artist: item.artist, album: item.name }}
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-semibold truncate">{item.name}</p>
                        <p className="text-xs text-muted-foreground truncate mt-0.5">{item.artist}</p>
                      </div>
                      <span className="font-num text-xs text-muted-foreground flex-shrink-0">{item.count}次</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
