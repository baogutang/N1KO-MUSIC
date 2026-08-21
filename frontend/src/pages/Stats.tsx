/**
 * 听歌统计页
 * 杂志编辑风（DESIGN v2）：数据行统计位 + 细柱日历图 + 编号 Top-5 榜单，
 * 发丝线与留白承担结构，无卡片盒。统计口径见 services/listeningStats。
 */

import { useMemo, useState, useEffect } from 'react'
import { cn } from '@/lib/utils'
import { formatDurationNatural } from '@/utils/formatters'
import { useServerStore } from '@/store/serverStore'
import { readListeningEvents, type ListeningEvent } from '@/services/listeningHistory'
import {
  computeListeningStats,
  formatHourRange,
  formatRate,
  type RankedEntry,
  type StatsRange,
} from '@/services/listeningStats'
import { TasteProfile } from '@/components/music/TasteProfile'

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

/** 编号榜单：mono 序号 + 衬线名 + mono 次数，行间 hair-soft */
function RankedList({ title, tag, items }: { title: string; tag: string; items: RankedEntry[] }) {
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

/** 统计位：mono 大数字 + wide-tracking 小标签 */
function StatCell({
  value,
  unit,
  label,
  hint,
  className,
}: {
  value: string | number
  unit?: string
  label: string
  hint?: string
  className?: string
}) {
  return (
    <div className={cn('px-6 py-7', className)}>
      <p className="num text-[32px] leading-none font-medium">
        {value}
        {unit && <span className="text-base text-ink-faint ml-1">{unit}</span>}
      </p>
      <p className="text-[11px] tracking-[0.2em] text-ink-faint mt-3">{label}</p>
      {hint && <p className="text-[11px] text-ink-faint/70 mt-1">{hint}</p>}
    </div>
  )
}

const RANGE_OPTIONS: Array<{ value: StatsRange; label: string }> = [
  { value: 7, label: '7 天' },
  { value: 30, label: '30 天' },
  { value: 'all', label: '全部' },
]

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

  const [range, setRange] = useState<StatsRange>(7)
  const stats = useMemo(() => computeListeningStats(historyData, range), [historyData, range])
  const maxDailyPlays = stats ? Math.max(...stats.daily.map(day => day.plays), 1) : 1
  const maxHourlyPlays = stats ? Math.max(...stats.hourly, 1) : 1

  return (
    <div className="min-h-full pt-9 pb-8 animate-fade-in">
      {/* 报头 + 时间范围切换 */}
      <header className="flex items-end justify-between gap-6">
        <div>
          <p className="text-[11px] tracking-[0.3em] text-ink-faint mb-2">LISTENING REPORT</p>
          <h1 className="font-serif text-4xl font-bold tracking-tight text-balance">听歌统计</h1>
          <p className="text-sm text-ink-soft mt-2">你的音乐数据报告</p>
        </div>
        <div className="flex flex-shrink-0 items-baseline gap-5" role="group" aria-label="统计范围">
          {RANGE_OPTIONS.map(option => (
            <button
              key={String(option.value)}
              type="button"
              onClick={() => setRange(option.value)}
              aria-pressed={range === option.value}
              className={cn(
                'pb-1 text-sm transition-colors',
                range === option.value
                  ? 'text-primary border-b border-primary'
                  : 'text-ink-faint border-b border-transparent hover:text-ink-soft'
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </header>

      {!stats ? (
        <div className="py-24">
          <p className="font-serif text-2xl font-semibold">这段时间还没有数据。</p>
          <p className="text-sm text-ink-faint mt-3">
            多听一些音乐，或者把范围切到「全部」看看更早的记录。
          </p>
        </div>
      ) : (
        <>
          {/* 规模数据行 */}
          <div className="grid grid-cols-2 md:grid-cols-4 border-y border-hair mt-10">
            <StatCell value={stats.plays} label="有效播放" className="pl-0" />
            <StatCell
              value={formatDurationNatural(stats.listenedSeconds)}
              label="收听时长"
              className="border-l border-hair-soft"
            />
            <StatCell
              value={stats.uniqueArtists}
              unit="位"
              label="不同歌手"
              className="pl-0 md:pl-6 border-t border-hair-soft md:border-t-0 md:border-l"
            />
            <StatCell
              value={stats.uniqueAlbums}
              unit="张"
              label="不同专辑"
              className="border-t border-l border-hair-soft md:border-t-0"
            />
          </div>

          {/* 行为数据行：历史窗口变长后才有统计意义的口味指标 */}
          <div className="grid grid-cols-2 md:grid-cols-4 border-b border-hair">
            <StatCell value={formatRate(stats.completionRate)} label="完整听完" className="pl-0" />
            <StatCell
              value={formatRate(stats.skipRate)}
              label="开头跳过"
              className="border-l border-hair-soft"
            />
            <StatCell
              value={formatRate(stats.repeatRate)}
              label="重复收听"
              className="pl-0 md:pl-6 border-t border-hair-soft md:border-t-0 md:border-l"
            />
            <StatCell
              value={formatDurationNatural(stats.dailyAverageSeconds)}
              label="活跃日均"
              hint={`共 ${stats.activeDays} 个活跃日`}
              className="border-t border-l border-hair-soft md:border-t-0"
            />
          </div>

          {/* 日历图：细柱，ink-faint 基底 + 峰值日 accent，hover 出 mono 数值 */}
          <section className="mt-14">
            <SectionHead
              title={range === 'all' ? '最近 30 天' : `最近 ${range} 天`}
              tag={range === 'all' ? 'RECENT DAYS' : `LAST ${range} DAYS`}
            />
            <div className="flex items-end gap-1.5 pt-8 sm:gap-2">
              {stats.daily.map(day => {
                const isPeak = day.plays > 0 && day.plays === maxDailyPlays
                return (
                  <div key={day.dayStart} className="group flex min-w-0 flex-1 flex-col items-center">
                    <span
                      className={cn(
                        'num text-[11px] mb-2 transition-opacity duration-200',
                        day.plays > 0 ? 'opacity-0 group-hover:opacity-100' : 'opacity-0',
                        isPeak ? 'text-primary' : 'text-ink-soft'
                      )}
                    >
                      {day.plays}
                    </span>
                    <div className="flex h-36 w-full items-end justify-center border-b border-hair-soft">
                      <div
                        className={cn(
                          'w-full max-w-[10px] transition-all duration-500',
                          isPeak ? 'bg-primary' : 'bg-ink-faint/50'
                        )}
                        style={{ height: `${(day.plays / maxDailyPlays) * 100}%` }}
                        title={`${day.label} · ${day.plays} 次`}
                      />
                    </div>
                    {/* 30 天时逐日标签会挤在一起，只标每 5 天 */}
                    <span className="num mt-3 h-4 text-[11px] text-ink-faint">
                      {stats.daily.length <= 10 || new Date(day.dayStart).getDate() % 5 === 0
                        ? day.label
                        : ''}
                    </span>
                  </div>
                )
              })}
            </div>
          </section>

          {/* 收听时段：24 小时分布，回答「你什么时候听歌」 */}
          <section className="mt-14">
            <SectionHead title="收听时段" tag="BY HOUR" />
            {stats.peakHour !== null && (
              <p className="pt-4 text-sm text-ink-soft">
                你最常在 <span className="num text-primary">{formatHourRange(stats.peakHour)}</span> 听歌。
              </p>
            )}
            <div className="flex items-end gap-1 pt-6">
              {stats.hourly.map((plays, hour) => {
                const isPeak = plays > 0 && hour === stats.peakHour
                return (
                  <div key={hour} className="flex min-w-0 flex-1 flex-col items-center">
                    <div className="flex h-24 w-full items-end justify-center border-b border-hair-soft">
                      <div
                        className={cn(
                          'w-full max-w-[8px] transition-all duration-500',
                          isPeak ? 'bg-primary' : 'bg-ink-faint/50'
                        )}
                        style={{ height: `${(plays / maxHourlyPlays) * 100}%` }}
                        title={`${formatHourRange(hour)} · ${plays} 次`}
                      />
                    </div>
                    {/* 每 6 小时标一次，避免 24 个标签挤在一起 */}
                    <span className="num mt-3 h-4 text-[11px] text-ink-faint">
                      {hour % 6 === 0 ? String(hour).padStart(2, '0') : ''}
                    </span>
                  </div>
                )
              })}
            </div>
          </section>

          {/* Top-5 三栏榜单 */}
          <section className="mt-14 grid grid-cols-1 md:grid-cols-3 gap-12 border-t border-hair pt-10">
            <RankedList title="最爱歌曲" tag="TOP SONGS" items={stats.topSongs} />
            <RankedList title="最爱歌手" tag="TOP ARTISTS" items={stats.topArtists} />
            <RankedList title="最爱专辑" tag="TOP ALBUMS" items={stats.topAlbums} />
          </section>

          {/* 画像：上面几栏是「你听了什么」，这一栏是「引擎因此认为你是谁」，
              而且可以当场改 */}
          <TasteProfile />
        </>
      )}
    </div>
  )
}
