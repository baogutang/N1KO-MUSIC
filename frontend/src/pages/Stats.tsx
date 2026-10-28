/**
 * 听歌统计页（v6 舞台光）
 * 一个大数字（收听时长是这一页、也是全站唯一的 font-figure 巨字）+ 一块数据面板 +
 * 细柱日历图 / 时段图（叶绿柱，暗色下自动换成青柠）+ 三张 Top-5 面板。统计口径见 services/listeningStats。
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
import { EmptyState } from '@/components/common/EmptyState'
import { SegmentedPill } from '@/components/settings/primitives'
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

/**
 * 自然语言时长拆成大数字 + 小单位（「12 小时 30 分钟」→ 12 [小时] 30 [分钟]）。
 * 句子仍由 formatDurationNatural 出（两种语言各一份词条），这里只按数字与非数字切开：
 * 数字走调用方给的大字号，单位退成说明字，窄屏上整串也放得下。
 */
function Figure({ text, unitClassName }: { text: string; unitClassName: string }) {
  return (
    <>
      {text.split(/(\d+)/).map((part, i) => {
        if (/^\d+$/.test(part)) return <span key={i}>{part}</span>
        const unit = part.trim()
        if (!unit) return null
        return (
          <span key={i} className={cn('mx-1 font-ui tracking-normal text-ink-3', unitClassName)}>
            {unit}
          </span>
        )
      })}
    </>
  )
}

/** 分区标题：Geologica 半粗，靠上方留白分区，不画线 */
function PanelHead({ title }: { title: string }) {
  return <h2 className="font-display text-[20px] font-semibold leading-tight tracking-[-0.015em] text-ink">{title}</h2>
}

/** 编号榜单：一块面板，序号 + 名称 + 次数，行间靠留白 */
function RankedList({ title, items }: { title: string; items: RankedEntry[] }) {
  const { t } = useT()
  return (
    <div className="sheet min-w-0 p-4 regular:p-5">
      <PanelHead title={title} />
      <ol className="mt-2">
        {items.map((item, i) => (
          <li key={item.key} className="flex items-baseline gap-3 py-2.5">
            <span className="num w-6 flex-shrink-0 text-[13px] text-ink-3">
              {String(i + 1).padStart(2, '0')}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-semibold text-ink">{item.title}</p>
              {item.subtitle && (
                <p className="mt-0.5 truncate text-[13px] text-ink-3">{item.subtitle}</p>
              )}
            </div>
            <span className="num flex-shrink-0 text-[13px] text-ink-2">
              {t('stats.playCount', { count: item.count })}
            </span>
          </li>
        ))}
      </ol>
    </div>
  )
}

/** 统计位：数字（Geologica + 等宽数字）在上，说明在下 */
function StatCell({
  value,
  unit,
  label,
  hint,
}: {
  value: React.ReactNode
  unit?: string
  label: string
  hint?: string
}) {
  return (
    <div className="min-w-0">
      <p className="num font-display text-[28px] font-semibold leading-none tracking-[-0.02em] text-ink">
        {value}
        {unit && <span className="ml-1 font-ui text-[15px] font-medium tracking-normal text-ink-3">{unit}</span>}
      </p>
      <p className="mt-2 text-[13px] text-ink-3">{label}</p>
      {hint && <p className="mt-0.5 text-[13px] text-ink-3">{hint}</p>}
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
    <div className="min-h-full pt-2 regular:pt-4 pb-8">
      {/* 页头 + 时间范围切换 */}
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <h1 className="font-display text-[34px] font-bold leading-[1.05] tracking-[-0.03em] text-ink text-balance regular:text-[44px]">
            {t('stats.title')}
          </h1>
          <p className="mt-3 text-[15px] text-ink-3">{t('stats.subtitle')}</p>
        </div>
        <SegmentedPill
          semantics="pressed"
          label={t('stats.rangeLabel')}
          value={String(range)}
          onChange={next => {
            const picked = RANGE_OPTIONS.find(option => String(option.value) === next)
            if (picked) setRange(picked.value)
          }}
          options={RANGE_OPTIONS.map(option => ({
            value: String(option.value),
            label: t(option.labelKey),
          }))}
          className="flex-shrink-0"
        />
      </header>

      {!stats ? (
        <EmptyState mascot="maodou-listen"
          title={t('empty.stats.title')}
          description={t('empty.stats.description')}
          className="mt-8"
        />
      ) : (
        <>
          {/* 规模：收听时长是这一页最重的数字，也是全站唯一的 font-figure 巨字 */}
          <section className="mt-10 min-w-0">
            <p className="font-figure text-[64px] leading-none text-ink regular:text-[88px]">
              <Figure
                text={formatDurationNatural(stats.listenedSeconds)}
                unitClassName="text-[20px] font-semibold regular:text-[24px]"
              />
            </p>
            <p className="mt-3 text-[15px] font-medium text-ink-3">{t('stats.listenedTime')}</p>
          </section>

          {/* 数据面板：规模三项 + 听歌行为（历史窗口变长后才有统计意义的口味指标） */}
          <section className="sheet mt-8 p-5 regular:p-7">
            <div className="grid grid-cols-3 gap-x-4 gap-y-5 regular:grid-cols-4 regular:gap-x-6">
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
            <div className="mt-8 grid grid-cols-2 gap-x-6 gap-y-6 regular:grid-cols-4">
              <StatCell value={formatRate(stats.completionRate)} label={t('stats.completionRate')} />
              <StatCell value={formatRate(stats.skipRate)} label={t('stats.skipRate')} />
              <StatCell value={formatRate(stats.repeatRate)} label={t('stats.repeatRate')} />
              <StatCell
                value={
                  <Figure
                    text={formatDurationNatural(stats.dailyAverageSeconds)}
                    unitClassName="text-[15px] font-medium"
                  />
                }
                label={t('stats.dailyAverage')}
                hint={t('stats.activeDaysHint', { count: stats.activeDays })}
              />
            </div>
          </section>

          {/* 日历图：细柱，峰值日叶绿、其余同色淡档，hover 出数值 */}
          <section>
            <div className="section-head">
              <h2>{t('stats.recentDays', { count: range === 'all' ? 30 : range })}</h2>
            </div>
            <div className="flex items-end gap-1.5 pt-2 regular:gap-2">
              {stats.daily.map(day => {
                const isPeak = day.plays > 0 && day.plays === maxDailyPlays
                return (
                  <div key={day.dayStart} className="group flex min-w-0 flex-1 flex-col items-center">
                    <span
                      className={cn(
                        'num mb-2 text-[12px] font-semibold transition-opacity duration-3',
                        day.plays > 0 ? 'opacity-0 group-hover:opacity-100' : 'opacity-0',
                        isPeak ? 'text-leaf' : 'text-ink-2'
                      )}
                    >
                      {day.plays}
                    </span>
                    <div className="flex h-36 w-full max-w-[14px] items-end overflow-hidden rounded-pill bg-ink/[0.05]">
                      <div
                        className={cn('w-full rounded-pill', isPeak ? 'bg-leaf' : 'bg-leaf/35')}
                        style={{ height: `${(day.plays / maxDailyPlays) * 100}%` }}
                        title={t('stats.barTooltip', { label: day.label, count: day.plays })}
                      />
                    </div>
                    {/* 30 天时逐日标签会挤在一起，只标每 5 天 */}
                    <span className="num mt-3 h-4 text-[12px] text-ink-3">
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
          <section>
            <div className="section-head">
              <h2>{t('stats.byHour')}</h2>
            </div>
            {stats.peakHour !== null && (
              <p className="text-[15px] text-ink-2">
                {peakHourBefore}
                <span className="num font-semibold text-leaf">{formatHourRange(stats.peakHour)}</span>
                {peakHourAfter}
              </p>
            )}
            <div className="flex items-end gap-1 pt-5">
              {stats.hourly.map((plays, hour) => {
                const isPeak = plays > 0 && hour === stats.peakHour
                return (
                  <div key={hour} className="flex min-w-0 flex-1 flex-col items-center">
                    <div className="flex h-24 w-full max-w-[12px] items-end overflow-hidden rounded-pill bg-ink/[0.05]">
                      <div
                        className={cn('w-full rounded-pill', isPeak ? 'bg-leaf' : 'bg-leaf/35')}
                        style={{ height: `${(plays / maxHourlyPlays) * 100}%` }}
                        title={t('stats.barTooltip', { label: formatHourRange(hour), count: plays })}
                      />
                    </div>
                    {/* 每 6 小时标一次，避免 24 个标签挤在一起 */}
                    <span className="num mt-3 h-4 text-[12px] text-ink-3">
                      {hour % 6 === 0 ? String(hour).padStart(2, '0') : ''}
                    </span>
                  </div>
                )
              })}
            </div>
          </section>

          {/* Top-5 三块面板：宽度够就三列，不够就折行 */}
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
