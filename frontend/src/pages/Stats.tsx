/**
 * 听歌统计页（v5 暖纸）
 * 规模纸片（收听时长是全站唯一的 font-figure 大数字）+ 行为纸片 + 细柱日历图 / 时段图 +
 * 三张 Top-5 纸片。统计口径见 services/listeningStats。
 */

import { useMemo, useState, useEffect } from 'react'
import { HISTORY_UPDATED_EVENT } from '@/services/storageKeys'
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

/** 分区标题：21px 半粗，靠上方留白分区，不画线 */
function SectionHead({ title }: { title: string }) {
  return <h2 className="text-[21px] font-semibold leading-tight">{title}</h2>
}

/** 编号榜单：一张纸片，序号 + 名称 + 次数，行间靠留白 */
function RankedList({ title, items }: { title: string; items: RankedEntry[] }) {
  const { t } = useT()
  return (
    <div className="sheet min-w-0 p-4 regular:p-5">
      <SectionHead title={title} />
      <ol className="mt-2">
        {items.map((item, i) => (
          <li key={item.key} className="flex items-baseline gap-3 py-2.5">
            <span className="num w-6 flex-shrink-0 text-[13px] text-ink-faint">
              {String(i + 1).padStart(2, '0')}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-semibold">{item.title}</p>
              {item.subtitle && (
                <p className="mt-0.5 truncate text-[13px] text-ink-faint">{item.subtitle}</p>
              )}
            </div>
            <span className="num flex-shrink-0 text-[13px] text-ink-soft">
              {t('stats.playCount', { count: item.count })}
            </span>
          </li>
        ))}
      </ol>
    </div>
  )
}

/** 统计位：数字（font-display + num）在上，说明在下 */
function StatCell({
  value,
  unit,
  label,
  hint,
}: {
  value: string | number
  unit?: string
  label: string
  hint?: string
}) {
  return (
    <div className="min-w-0">
      <p className="num font-display text-[26px] font-semibold leading-tight regular:text-[30px]">
        {value}
        {unit && <span className="ml-1 text-base font-normal text-ink-faint">{unit}</span>}
      </p>
      <p className="mt-2 text-[13px] text-ink-faint">{label}</p>
      {hint && <p className="mt-0.5 text-[13px] text-ink-faint">{hint}</p>}
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
    window.addEventListener(HISTORY_UPDATED_EVENT, onUpdate)
    return () => window.removeEventListener(HISTORY_UPDATED_EVENT, onUpdate)
  }, [historyScope])

  const [range, setRange] = useState<StatsRange>(7)
  const stats = useMemo(() => computeListeningStats(historyData, range), [historyData, range])
  const maxDailyPlays = stats ? Math.max(...stats.daily.map(day => day.plays), 1) : 1
  const maxHourlyPlays = stats ? Math.max(...stats.hourly, 1) : 1
  const [peakHourBefore, peakHourAfter] = splitAtPlaceholder(t('stats.peakHour'), '{hour}')

  return (
    <div className="min-h-full pt-2 regular:pt-4 pb-8 animate-fade-in">
      {/* 页头 + 时间范围切换 */}
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div>
          <h1 className="font-display text-[34px] regular:text-[40px] font-semibold leading-[1.05] tracking-[-0.02em] text-balance">
            {t('stats.title')}
          </h1>
          <p className="mt-3 text-sm text-ink-faint">{t('stats.subtitle')}</p>
        </div>
        <div
          className="inline-flex flex-shrink-0 gap-1 rounded-pill bg-paper-deep p-1"
          role="group"
          aria-label={t('stats.rangeLabel')}
        >
          {RANGE_OPTIONS.map(option => (
            <button
              key={String(option.value)}
              type="button"
              onClick={() => setRange(option.value)}
              aria-pressed={range === option.value}
              className={cn(
                'seg-option min-h-11 rounded-pill px-5 text-[14px] font-medium transition-colors duration-150',
                range === option.value
                  ? 'is-on'
                  : 'text-ink-soft [@media(hover:hover)]:hover:text-ink'
              )}
            >
              {t(option.labelKey)}
            </button>
          ))}
        </div>
      </header>

      {!stats ? (
        <div className="py-24">
          <p className="text-2xl font-semibold">{t('empty.stats.title')}</p>
          <p className="mt-3 text-sm text-ink-faint">{t('empty.stats.description')}</p>
        </div>
      ) : (
        <>
          {/* 规模：收听时长是这一页最重的数字，也是全站唯一的 font-figure */}
          <section className="sheet mt-8 p-5 regular:p-7">
            <div className="min-w-0">
              <p className="font-figure text-[48px] leading-none regular:text-[64px]">
                {formatDurationNatural(stats.listenedSeconds)}
              </p>
              <p className="mt-3 text-[14px] text-ink-faint">{t('stats.listenedTime')}</p>
            </div>
            <div className="mt-7 grid grid-cols-3 gap-x-4 gap-y-5">
              <StatCell value={stats.plays} label={t('stats.plays')} />
              <StatCell
                value={stats.uniqueArtists}
                unit={t('stats.unitArtists')}
                label={t('stats.uniqueArtists')}
              />
              <StatCell
                value={stats.uniqueAlbums}
                unit={t('stats.unitAlbums')}
                label={t('stats.uniqueAlbums')}
              />
            </div>
          </section>

          {/* 行为：历史窗口变长后才有统计意义的口味指标 */}
          <section className="sheet mt-4 grid grid-cols-2 gap-x-6 gap-y-6 p-5 regular:p-7">
            <StatCell value={formatRate(stats.completionRate)} label={t('stats.completionRate')} />
            <StatCell value={formatRate(stats.skipRate)} label={t('stats.skipRate')} />
            <StatCell value={formatRate(stats.repeatRate)} label={t('stats.repeatRate')} />
            <StatCell
              value={formatDurationNatural(stats.dailyAverageSeconds)}
              label={t('stats.dailyAverage')}
              hint={t('stats.activeDaysHint', { count: stats.activeDays })}
            />
          </section>

          {/* 日历图：细柱，浅墨基底 + 峰值日陶土，hover 出数值 */}
          <section className="mt-10">
            <SectionHead title={t('stats.recentDays', { count: range === 'all' ? 30 : range })} />
            <div className="flex items-end gap-1.5 pt-6 regular:gap-2">
              {stats.daily.map(day => {
                const isPeak = day.plays > 0 && day.plays === maxDailyPlays
                return (
                  <div key={day.dayStart} className="group flex min-w-0 flex-1 flex-col items-center">
                    <span
                      className={cn(
                        'num mb-2 text-[12px] transition-opacity duration-200',
                        day.plays > 0 ? 'opacity-0 group-hover:opacity-100' : 'opacity-0',
                        isPeak ? 'text-primary' : 'text-ink-soft'
                      )}
                    >
                      {day.plays}
                    </span>
                    <div className="flex h-36 w-full max-w-[14px] items-end overflow-hidden rounded-pill bg-paper-deep">
                      <div
                        className={cn('w-full rounded-pill', isPeak ? 'bg-primary' : 'bg-ink-faint/50')}
                        style={{ height: `${(day.plays / maxDailyPlays) * 100}%` }}
                        title={t('stats.barTooltip', { label: day.label, count: day.plays })}
                      />
                    </div>
                    {/* 30 天时逐日标签会挤在一起，只标每 5 天 */}
                    <span className="num mt-3 h-4 text-[12px] text-ink-faint">
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
          <section className="mt-10">
            <SectionHead title={t('stats.byHour')} />
            {stats.peakHour !== null && (
              <p className="pt-3 text-sm text-ink-soft">
                {peakHourBefore}
                <span className="num text-primary">{formatHourRange(stats.peakHour)}</span>
                {peakHourAfter}
              </p>
            )}
            <div className="flex items-end gap-1 pt-5">
              {stats.hourly.map((plays, hour) => {
                const isPeak = plays > 0 && hour === stats.peakHour
                return (
                  <div key={hour} className="flex min-w-0 flex-1 flex-col items-center">
                    <div className="flex h-24 w-full max-w-[12px] items-end overflow-hidden rounded-pill bg-paper-deep">
                      <div
                        className={cn('w-full rounded-pill', isPeak ? 'bg-primary' : 'bg-ink-faint/50')}
                        style={{ height: `${(plays / maxHourlyPlays) * 100}%` }}
                        title={t('stats.barTooltip', { label: formatHourRange(hour), count: plays })}
                      />
                    </div>
                    {/* 每 6 小时标一次，避免 24 个标签挤在一起 */}
                    <span className="num mt-3 h-4 text-[12px] text-ink-faint">
                      {hour % 6 === 0 ? String(hour).padStart(2, '0') : ''}
                    </span>
                  </div>
                )
              })}
            </div>
          </section>

          {/* Top-5 三张纸片：宽度够就三列，不够就折行 */}
          <section className="mt-10 grid grid-cols-[repeat(auto-fit,minmax(min(100%,260px),1fr))] gap-4">
            <RankedList title={t('stats.topSongs')} items={stats.topSongs} />
            <RankedList title={t('stats.topArtists')} items={stats.topArtists} />
            <RankedList title={t('stats.topAlbums')} items={stats.topAlbums} />
          </section>

          {/* 画像：上面几栏是「你听了什么」，这一栏是「引擎因此认为你是谁」，
              而且可以当场改 */}
          <TasteProfile />
        </>
      )}
    </div>
  )
}
