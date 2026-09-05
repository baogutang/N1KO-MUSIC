/**
 * 听歌统计页
 * 杂志编辑风（DESIGN v2）：数据行统计位 + 细柱日历图 + 编号 Top-5 榜单，
 * 发丝线与留白承担结构，无卡片盒。统计口径见 services/listeningStats。
 */

import { useMemo, useState, useEffect } from 'react'
import { cn } from '@/lib/utils'
import { formatDurationNatural } from '@/utils/formatters'
import { useServerStore , useHistoryScope } from '@/store/serverStore'
import { readListeningEvents, type ListeningEvent } from '@/services/listeningHistory'
import {
  computeListeningStats,
  formatHourRange,
  formatRate,
  type RankedEntry,
  type StatsRange,
} from '@/services/listeningStats'
import { TasteProfile } from '@/components/music/TasteProfile'
import { useT } from '@/i18n'

/**
 * 把带占位符的句子从占位符处切成两半。
 *
 * 「你最常在 X 听歌」里的 X 要单独上色，整句又必须留在同一个 key 里给译者，
 * 所以在渲染时按占位符切开，而不是把句子拆成两条译文。
 */
function splitAtPlaceholder(template: string, token: string): [string, string] {
  const at = template.indexOf(token)
  if (at < 0) return [template, '']
  return [template.slice(0, at), template.slice(at + token.length)]
}

// ─── 子组件 ───────────────────────────────────────────────────────────────────

/** 分区标题：衬线标题 + 拉丁小标签 + 下缘发丝线 */
function SectionHead({ title, tag }: { title: string; tag: string }) {
  return (
    <div className="flex items-baseline justify-between border-b border-hair pb-3">
      <h2 className="font-serif text-[22px] font-semibold">{title}</h2>
      <span className="latin-tag text-[10px] tracking-[0.24em] text-ink-faint">{tag}</span>
    </div>
  )
}

/** 编号榜单：mono 序号 + 衬线名 + mono 次数，行间 hair-soft */
function RankedList({ title, tag, items }: { title: string; tag: string; items: RankedEntry[] }) {
  const { t } = useT()
  return (
    <div>
      <div className="flex items-baseline justify-between border-b border-hair pb-2.5">
        <h3 className="font-serif text-lg font-semibold">{title}</h3>
        <span className="latin-tag text-[10px] tracking-[0.24em] text-ink-faint">{tag}</span>
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
            <span className="num flex-shrink-0 text-xs text-ink-soft">
              {t('stats.playCount', { count: item.count })}
            </span>
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

const RANGE_OPTIONS: Array<{ value: StatsRange; labelKey: string }> = [
  { value: 7, labelKey: 'stats.range7' },
  { value: 30, labelKey: 'stats.range30' },
  { value: 'all', labelKey: 'stats.rangeAll' },
]

// ─── 主页面 ───────────────────────────────────────────────────────────────────

export default function Stats() {
  const { t } = useT()
  const activeServerId = useServerStore(s => s.activeServerId)
  const historyScope = useHistoryScope()
  // 使用 state 存储历史，进入页面时刷新，并监听实时更新事件
  const [historyData, setHistoryData] = useState<ListeningEvent[]>(() =>
    readListeningEvents(historyScope)
  )

  useEffect(() => {
    const refresh = () => setHistoryData(readListeningEvents(historyScope))
    refresh()
    const onUpdate = (event: Event) => {
      const detail = (event as CustomEvent<{ serverId?: string }>).detail
      // 任何**在读取范围内**的音源写入历史都要刷新：只认主库的话，
      // 在网易云听完一首这一页不会动
      if (!detail?.serverId || historyScope.includes(detail.serverId)) refresh()
    }
    window.addEventListener('msp-history-updated', onUpdate)
    return () => window.removeEventListener('msp-history-updated', onUpdate)
  }, [historyScope])

  const [range, setRange] = useState<StatsRange>(7)
  const stats = useMemo(() => computeListeningStats(historyData, range), [historyData, range])
  const maxDailyPlays = stats ? Math.max(...stats.daily.map(day => day.plays), 1) : 1
  const maxHourlyPlays = stats ? Math.max(...stats.hourly, 1) : 1
  const [peakHourBefore, peakHourAfter] = splitAtPlaceholder(t('stats.peakHour'), '{hour}')

  return (
    <div className="min-h-full pt-9 pb-8 animate-fade-in">
      {/* 报头 + 时间范围切换 */}
      <header className="flex items-end justify-between gap-6">
        <div>
          <p className="latin-tag text-[11px] tracking-[0.3em] text-ink-faint mb-2">LISTENING REPORT</p>
          <h1 className="font-serif text-4xl font-bold tracking-tight text-balance">
            {t('stats.title')}
          </h1>
          <p className="text-sm text-ink-soft mt-2">{t('stats.subtitle')}</p>
        </div>
        <div className="flex flex-shrink-0 items-baseline gap-5" role="group" aria-label={t('stats.rangeLabel')}>
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
              {t(option.labelKey)}
            </button>
          ))}
        </div>
      </header>

      {!stats ? (
        <div className="py-24">
          <p className="font-serif text-2xl font-semibold">{t('empty.stats.title')}</p>
          <p className="text-sm text-ink-faint mt-3">{t('empty.stats.description')}</p>
        </div>
      ) : (
        <>
          {/* 规模数据行 */}
          <div className="grid grid-cols-2 md:grid-cols-4 border-y border-hair mt-10">
            <StatCell value={stats.plays} label={t('stats.plays')} className="pl-0" />
            <StatCell
              value={formatDurationNatural(stats.listenedSeconds)}
              label={t('stats.listenedTime')}
              className="border-l border-hair-soft"
            />
            <StatCell
              value={stats.uniqueArtists}
              unit={t('stats.unitArtists')}
              label={t('stats.uniqueArtists')}
              className="pl-0 md:pl-6 border-t border-hair-soft md:border-t-0 md:border-l"
            />
            <StatCell
              value={stats.uniqueAlbums}
              unit={t('stats.unitAlbums')}
              label={t('stats.uniqueAlbums')}
              className="border-t border-l border-hair-soft md:border-t-0"
            />
          </div>

          {/* 行为数据行：历史窗口变长后才有统计意义的口味指标 */}
          <div className="grid grid-cols-2 md:grid-cols-4 border-b border-hair">
            <StatCell
              value={formatRate(stats.completionRate)}
              label={t('stats.completionRate')}
              className="pl-0"
            />
            <StatCell
              value={formatRate(stats.skipRate)}
              label={t('stats.skipRate')}
              className="border-l border-hair-soft"
            />
            <StatCell
              value={formatRate(stats.repeatRate)}
              label={t('stats.repeatRate')}
              className="pl-0 md:pl-6 border-t border-hair-soft md:border-t-0 md:border-l"
            />
            <StatCell
              value={formatDurationNatural(stats.dailyAverageSeconds)}
              label={t('stats.dailyAverage')}
              hint={t('stats.activeDaysHint', { count: stats.activeDays })}
              className="border-t border-l border-hair-soft md:border-t-0"
            />
          </div>

          {/* 日历图：细柱，ink-faint 基底 + 峰值日 accent，hover 出 mono 数值 */}
          <section className="mt-14">
            <SectionHead
              title={t('stats.recentDays', { count: range === 'all' ? 30 : range })}
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
                        title={t('stats.barTooltip', { label: day.label, count: day.plays })}
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
            <SectionHead title={t('stats.byHour')} tag="BY HOUR" />
            {stats.peakHour !== null && (
              <p className="pt-4 text-sm text-ink-soft">
                {peakHourBefore}
                <span className="num text-primary">{formatHourRange(stats.peakHour)}</span>
                {peakHourAfter}
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
                        title={t('stats.barTooltip', { label: formatHourRange(hour), count: plays })}
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
            <RankedList title={t('stats.topSongs')} tag="TOP SONGS" items={stats.topSongs} />
            <RankedList title={t('stats.topArtists')} tag="TOP ARTISTS" items={stats.topArtists} />
            <RankedList title={t('stats.topAlbums')} tag="TOP ALBUMS" items={stats.topAlbums} />
          </section>

          {/* 画像：上面几栏是「你听了什么」，这一栏是「引擎因此认为你是谁」，
              而且可以当场改 */}
          <TasteProfile />
        </>
      )}
    </div>
  )
}
