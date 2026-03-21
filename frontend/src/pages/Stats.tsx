import { useMemo, useState, useEffect } from 'react'
import { BarChart3, Music2, Clock, TrendingUp, Calendar, Headphones, Disc3, Mic2 } from 'lucide-react'
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

interface StatCardProps {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  sub?: string
  color?: string
}

function StatCard({ icon: Icon, label, value, sub, color = 'text-primary' }: StatCardProps) {
  return (
    <div className="bg-card rounded-2xl p-5 border border-border">
      <div className={`w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center mb-3 ${color}`}>
        <Icon className="w-5 h-5" />
      </div>
      <p className="text-2xl font-bold mb-0.5">{value}</p>
      <p className="text-sm text-muted-foreground">{label}</p>
      {sub && <p className="text-xs text-muted-foreground/60 mt-1">{sub}</p>}
    </div>
  )
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
    const now = Date.now()
    const DAY = 86400000
    const dailyCounts = Array.from({ length: 7 }, (_, i) => {
      const dayStart = now - (6 - i) * DAY
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
    <div className="min-h-full pb-8">
      <div className="px-6 py-6">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <BarChart3 className="w-8 h-8 text-primary" />
            听歌统计
          </h1>
          <p className="text-muted-foreground mt-1">你的音乐数据报告</p>
        </div>

        {!stats ? (
          <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
            <Headphones className="w-16 h-16 mb-4 opacity-20" />
            <p className="text-lg mb-1">暂无数据</p>
            <p className="text-sm">多听一些音乐，数据就会出现在这里</p>
          </div>
        ) : (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
              <StatCard
                icon={Music2}
                label="总播放次数"
                value={String(stats.totalPlays)}
              />
              <StatCard
                icon={Clock}
                label="总时长"
                value={formatDurationNatural(stats.totalDuration)}
                color="text-blue-500"
              />
              <StatCard
                icon={Mic2}
                label="不同歌手"
                value={String(stats.uniqueArtists)}
                sub="位"
                color="text-purple-500"
              />
              <StatCard
                icon={Disc3}
                label="不同专辑"
                value={String(stats.uniqueAlbums)}
                sub="张"
                color="text-amber-500"
              />
            </div>

            {/* Weekly chart */}
            <div className="bg-card rounded-2xl border border-border p-5 mb-6">
              <h2 className="font-semibold mb-4 flex items-center gap-2">
                <Calendar className="w-4 h-4 text-primary" />
                最近 7 天
              </h2>
              <div className="flex items-end gap-2 h-32">
                {stats.dailyCounts.map(day => (
                  <div key={day.label} className="flex-1 flex flex-col items-center gap-1">
                    <span className="text-xs text-muted-foreground">{day.count || ''}</span>
                    <div className="w-full bg-muted rounded-t-sm overflow-hidden" style={{ height: '80px' }}>
                      <div
                        className="w-full bg-primary/70 rounded-t-sm transition-all duration-500"
                        style={{
                          height: `${(day.count / maxDailyCount) * 80}px`,
                          marginTop: `${80 - (day.count / maxDailyCount) * 80}px`,
                        }}
                      />
                    </div>
                    <span className="text-xs text-muted-foreground">{day.label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Top content - 3 columns */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Top songs */}
              <div className="bg-card rounded-2xl border border-border p-5">
                <h2 className="font-semibold mb-4 flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-primary" />
                  最爱歌曲
                </h2>
                <div className="space-y-3">
                  {stats.topSongs.map((item, i) => (
                    <div key={item.song.id} className="flex items-center gap-3">
                      <span className="w-5 text-center text-sm font-bold text-muted-foreground/60">{i + 1}</span>
                      <div className="w-9 h-9 rounded-lg overflow-hidden flex-shrink-0">
                        <ImageWithFallback
                          src={item.song.coverArt && hasAdapter() ? getAdapter().getCoverUrl(item.song.coverArt, 64) : undefined}
                          alt={item.song.title}
                          fallbackType="album"
                          className="w-full h-full"
                          customCoverParams={{ type: 'song', title: item.song.title, artist: item.song.artist, album: item.song.album, path: item.song.path }}
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{item.song.title}</p>
                        <p className="text-xs text-muted-foreground truncate">{item.song.artist}</p>
                      </div>
                      <span className="text-xs text-muted-foreground flex-shrink-0">{item.count}次</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Top artists */}
              <div className="bg-card rounded-2xl border border-border p-5">
                <h2 className="font-semibold mb-4 flex items-center gap-2">
                  <Mic2 className="w-4 h-4 text-purple-500" />
                  最爱歌手
                </h2>
                <div className="space-y-3">
                  {stats.topArtists.map((item, i) => (
                    <div key={item.name} className="flex items-center gap-3">
                      <span className="w-5 text-center text-sm font-bold text-muted-foreground/60">{i + 1}</span>
                      <div className="w-9 h-9 rounded-full overflow-hidden flex-shrink-0">
                        <ImageWithFallback
                          src={item.coverArt && hasAdapter() ? getAdapter().getCoverUrl(item.coverArt, 64) : undefined}
                          alt={item.name}
                          fallbackType="artist"
                          className="w-full h-full"
                          customCoverParams={{ type: 'artist', artist: item.name }}
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{item.name}</p>
                      </div>
                      <span className="text-xs text-muted-foreground flex-shrink-0">{item.count}次</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Top albums */}
              <div className="bg-card rounded-2xl border border-border p-5">
                <h2 className="font-semibold mb-4 flex items-center gap-2">
                  <Disc3 className="w-4 h-4 text-amber-500" />
                  最爱专辑
                </h2>
                <div className="space-y-3">
                  {stats.topAlbums.map((item, i) => (
                    <div key={item.name} className="flex items-center gap-3">
                      <span className="w-5 text-center text-sm font-bold text-muted-foreground/60">{i + 1}</span>
                      <div className="w-9 h-9 rounded-lg overflow-hidden flex-shrink-0">
                        <ImageWithFallback
                          src={item.coverArt && hasAdapter() ? getAdapter().getCoverUrl(item.coverArt, 64) : undefined}
                          alt={item.name}
                          fallbackType="album"
                          className="w-full h-full"
                          customCoverParams={{ type: 'album', artist: item.artist, album: item.name }}
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{item.name}</p>
                        <p className="text-xs text-muted-foreground truncate">{item.artist}</p>
                      </div>
                      <span className="text-xs text-muted-foreground flex-shrink-0">{item.count}次</span>
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
