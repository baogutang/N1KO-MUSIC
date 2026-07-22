/**
 * 听歌统计页
 * 杂志编辑风（DESIGN v2）：数据行统计位 + 细柱 7 天图 + 编号 Top-5 榜单，
 * 发丝线与留白承担结构，无卡片盒。本地历史计算逻辑保持不变。
 */

import { useMemo, useState, useEffect } from 'react'
import { cn } from '@/lib/utils'
import type { Song } from '@/api/types'
import { formatDurationNatural } from '@/utils/formatters'
import { useServerStore } from '@/store/serverStore'
import {
  isQualifiedListeningEvent,
  readListeningEvents,
  type ListeningEvent,
} from '@/services/listeningHistory'

// ─── 子组件 ───────────────────────────────────────────────────────────────────

/** 分区标题：衬线标题 + 拉丁小标签 + 下缘发丝线 */
function SectionHead({ title, tag }: { title: string; tag: string }) {
  return (
    <div className="flex items-baseline justify-between border-b border-hair pb-3">
      <h2 className="font-serif text-[22px] font-semibold">{title}</h2>
      <span className="text-[10px] tracking-[0.24em] text-ink-faint">{tag}</span>
    </div>
  )
}

interface RankItem {
  key: string
  title: string
  subtitle?: string
  count: number
}

/** 编号榜单：mono 序号 + 衬线名 + mono 次数，行间 hair-soft */
function RankedList({ title, tag, items }: { title: string; tag: string; items: RankItem[] }) {
  return (
    <div>
      <div className="flex items-baseline justify-between border-b border-hair pb-2.5">
        <h3 className="font-serif text-lg font-semibold">{title}</h3>
        <span className="text-[10px] tracking-[0.24em] text-ink-faint">{tag}</span>
      </div>
      <ol className="divide-y divide-hair-soft">
        {items.map((item, i) => (
          <li key={item.key} className="flex items-baseline gap-3 py-3">
            <span className="num w-5 flex-shrink-0 text-[11px] text-ink-faint">
              {String(i + 1).padStart(2, '0')}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-serif text-[15px] font-semibold">{item.title}</p>
              {item.subtitle && (
                <p className="mt-0.5 truncate text-xs text-ink-faint">{item.subtitle}</p>
              )}
            </div>
            <span className="num flex-shrink-0 text-xs text-ink-soft">{item.count} 次</span>
          </li>
        ))}
      </ol>
    </div>
  )
}

// ─── 主页面 ───────────────────────────────────────────────────────────────────

export default function Stats() {
  const activeServerId = useServerStore(s => s.activeServerId)
  // 使用 state 存储历史，进入页面时刷新，并监听实时更新事件
  const [historyData, setHistoryData] = useState<ListeningEvent[]>(() =>
    activeServerId ? readListeningEvents(activeServerId) : []
  )

  useEffect(() => {
    const refresh = () => setHistoryData(activeServerId ? readListeningEvents(activeServerId) : [])
    refresh()
    const onUpdate = (event: Event) => {
      const detail = (event as CustomEvent<{ serverId?: string }>).detail
      if (!detail?.serverId || detail.serverId === activeServerId) refresh()
    }
    window.addEventListener('msp-history-updated', onUpdate)
    return () => window.removeEventListener('msp-history-updated', onUpdate)
  }, [activeServerId])

  const stats = useMemo(() => {
    const history = historyData.filter(isQualifiedListeningEvent)
    if (!history.length) return null

    const totalPlays = history.length
    const totalDuration = history.reduce((sum, e) => sum + e.listenedSeconds, 0)

    // Top songs
    const songCounts = new Map<string, { song: Song; count: number }>()
    history.forEach(e => {
      const key = `${e.serverId}:${e.song.id}`
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
      const count = history.filter(e => e.endedAt >= dayStart && e.endedAt < dayEnd).length
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
    <div className="min-h-full pt-9 pb-8 animate-fade-in">
      {/* 报头 */}
      <header>
        <p className="text-[11px] tracking-[0.3em] text-ink-faint mb-2">LISTENING REPORT</p>
        <h1 className="font-serif text-4xl font-bold tracking-tight text-balance">听歌统计</h1>
        <p className="text-sm text-ink-soft mt-2">你的音乐数据报告</p>
      </header>

      {!stats ? (
        <div className="py-24">
          <p className="font-serif text-2xl font-semibold">这一页还没有数据。</p>
          <p className="text-sm text-ink-faint mt-3">多听一些音乐，统计就会出现在这里。</p>
        </div>
      ) : (
        <>
          {/* 数据行：mono 大数字 + wide-tracking 小标签，发丝线分隔 */}
          <div className="grid grid-cols-2 md:grid-cols-4 border-y border-hair mt-10">
            <div className="px-6 py-7 pl-0">
              <p className="num text-[40px] leading-none font-medium">{stats.totalPlays}</p>
              <p className="text-[11px] tracking-[0.2em] text-ink-faint mt-3">总播放次数</p>
            </div>
            <div className="px-6 py-7 border-l border-hair-soft">
              <p className="num text-[28px] leading-none font-medium pt-[6px]">
                {formatDurationNatural(stats.totalDuration)}
              </p>
              <p className="text-[11px] tracking-[0.2em] text-ink-faint mt-3">总时长</p>
            </div>
            <div className="px-6 py-7 pl-0 md:pl-6 border-t border-hair-soft md:border-t-0 md:border-l">
              <p className="num text-[40px] leading-none font-medium">
                {stats.uniqueArtists}
                <span className="text-base text-ink-faint ml-1">位</span>
              </p>
              <p className="text-[11px] tracking-[0.2em] text-ink-faint mt-3">不同歌手</p>
            </div>
            <div className="px-6 py-7 border-t border-l border-hair-soft md:border-t-0">
              <p className="num text-[40px] leading-none font-medium">
                {stats.uniqueAlbums}
                <span className="text-base text-ink-faint ml-1">张</span>
              </p>
              <p className="text-[11px] tracking-[0.2em] text-ink-faint mt-3">不同专辑</p>
            </div>
          </div>

          {/* 最近 7 天：细柱，ink-faint 基底 + 峰值日 accent，hover 出 mono 数值 */}
          <section className="mt-14">
            <SectionHead title="最近 7 天" tag="LAST 7 DAYS" />
            <div className="grid grid-cols-7 gap-4 pt-8">
              {stats.dailyCounts.map(day => {
                const isPeak = day.count > 0 && day.count === maxDailyCount
                return (
                  <div key={day.label} className="group flex flex-col items-center min-w-0">
                    <span
                      className={cn(
                        'num text-[11px] mb-2 transition-opacity duration-200',
                        day.count > 0 ? 'opacity-0 group-hover:opacity-100' : 'opacity-0',
                        isPeak ? 'text-primary' : 'text-ink-soft'
                      )}
                    >
                      {day.count}
                    </span>
                    <div className="w-full h-36 flex items-end justify-center border-b border-hair-soft">
                      <div
                        className={cn(
                          'w-[10px] transition-all duration-500',
                          isPeak ? 'bg-primary' : 'bg-ink-faint/50'
                        )}
                        style={{ height: `${(day.count / maxDailyCount) * 100}%` }}
                      />
                    </div>
                    <span className="num text-[11px] text-ink-faint mt-3">{day.label}</span>
                  </div>
                )
              })}
            </div>
          </section>

          {/* Top-5 三栏榜单 */}
          <section className="mt-14 grid grid-cols-1 md:grid-cols-3 gap-12 border-t border-hair pt-10">
            <RankedList
              title="最爱歌曲"
              tag="TOP SONGS"
              items={stats.topSongs.map(item => ({
                key: item.song.id,
                title: item.song.title,
                subtitle: item.song.artist,
                count: item.count,
              }))}
            />
            <RankedList
              title="最爱歌手"
              tag="TOP ARTISTS"
              items={stats.topArtists.map(item => ({
                key: item.name,
                title: item.name,
                count: item.count,
              }))}
            />
            <RankedList
              title="最爱专辑"
              tag="TOP ALBUMS"
              items={stats.topAlbums.map(item => ({
                key: item.name,
                title: item.name,
                subtitle: item.artist,
                count: item.count,
              }))}
            />
          </section>
        </>
      )}
    </div>
  )
}
