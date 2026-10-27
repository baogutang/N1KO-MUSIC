/**
 * 《本期》—— 把一段收听期读成一期刊物。
 *
 * 编者按、封面故事、排行表、超级数据、本期发现。
 * 编者按只由真实数据拼成的模板句组成（见 services/issue.ts），不虚构。
 * 版式：编者按与封面故事合成一张纸片，三张排行表各一张纸片，其余靠留白分区。
 */

import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { detailPath } from '@/utils/detailPath'
import { CaretLeft, CaretRight, Play } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import { useServerStore , useHistoryScope } from '@/store/serverStore'
import { readListeningEvents } from '@/services/listeningHistory'
import {
  buildIssue, monthPeriod, shiftPeriod, yearPeriod, MIN_PLAYS_FOR_ISSUE,
  type IssueEntry, type IssuePeriod,
} from '@/services/issue'
import { spaceCJK } from '@/utils/cjkTypography'
import { ImageWithFallback } from '@/components/common/ImageWithFallback'
import { findAdapterFor } from '@/api'
import { startRadio } from '@/services/radio'
import { useT } from '@/i18n'

type Translate = (key: string, vars?: Record<string, string | number>) => string

function formatHours(seconds: number, t: Translate): string {
  const hours = seconds / 3600
  if (hours >= 1) return t('issue.hours', { value: hours.toFixed(1) })
  return t('issue.minutes', { value: Math.max(1, Math.round(seconds / 60)) })
}

export default function IssuePage() {
  const { t } = useT()
  const navigate = useNavigate()
  const serverId = useServerStore(s => s.activeServerId)
  const historyScope = useHistoryScope()
  const [kind, setKind] = useState<'month' | 'year'>('month')
  const [offset, setOffset] = useState(0)

  const events = useMemo(
    () => readListeningEvents(historyScope),
    [historyScope]
  )

  const period: IssuePeriod = useMemo(() => {
    const base = kind === 'month' ? monthPeriod() : yearPeriod()
    return offset === 0 ? base : shiftPeriod(base, offset)
  }, [kind, offset])

  const issue = useMemo(() => buildIssue(events, period), [events, period])

  const coverArt = issue.coverArtist?.coverArt
  const coverUrl = coverArt
    ? (findAdapterFor(issue.coverArtist?.serverId)?.getCoverUrl(coverArt, 600) ?? undefined)
    : undefined

  return (
    <div className="pt-2 regular:pt-4 pb-8 animate-fade-in">
      {/* ============ 页头：大标题 + 刊期切换 ============ */}
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
        <h1 className="font-display text-[34px] regular:text-[40px] font-semibold leading-[1.05] tracking-[-0.02em]">
          {t('nav.issue')}
        </h1>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <div
            role="radiogroup"
            aria-label={t('issue.periodKind')}
            className="inline-flex gap-1 rounded-pill bg-paper-deep p-1"
          >
            {(['month', 'year'] as const).map(k => (
              <button
                key={k}
                role="radio"
                aria-checked={kind === k}
                onClick={() => { setKind(k); setOffset(0) }}
                className={cn(
                  'seg-option min-h-11 rounded-pill px-5 text-[14px] font-medium transition-colors duration-150',
                  kind === k ? 'is-on' : 'text-ink-soft [@media(hover:hover)]:hover:text-ink'
                )}
              >
                {k === 'month' ? t('issue.monthly') : t('issue.yearly')}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setOffset(o => o - 1)}
              aria-label={t('issue.previous')}
              className="act-icon grid place-items-center"
            >
              <CaretLeft size={16} />
            </button>
            <span className="num min-w-[5rem] text-center text-[15px] font-medium">
              {period.label}
            </span>
            <button
              onClick={() => setOffset(o => Math.min(0, o + 1))}
              disabled={offset >= 0}
              aria-label={t('issue.next')}
              className="act-icon grid place-items-center"
            >
              <CaretRight size={16} />
            </button>
          </div>
        </div>
      </header>

      {!issue.hasEnough ? (
        <IssueZero plays={issue.plays} onStart={() => navigate('/library')} />
      ) : (
        <>
          {/* ============ 编者按 + 封面故事：一张纸片 ============ */}
          <article className="sheet mt-8 grid grid-cols-1 items-start gap-6 p-5 regular:grid-cols-[minmax(0,1fr)_200px] regular:gap-8 regular:p-7 wide:grid-cols-[minmax(0,1fr)_240px]">
            <div className="min-w-0">
              <h2 className="text-[21px] font-semibold leading-tight">{t('issue.editorsNote')}</h2>
              <p className="mt-3 max-w-[34em] text-[17px] leading-[1.9] text-ink">
                {spaceCJK(issue.editorsNote)}
              </p>

              <dl className="mt-7 grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-x-6 gap-y-5">
                {[
                  { id: 'plays', label: t('stats.plays'), value: String(issue.plays) },
                  { id: 'listened', label: t('stats.listenedTime'), value: formatHours(issue.listenedSeconds, t) },
                  { id: 'songs', label: t('stats.uniqueSongs'), value: String(issue.uniqueSongs) },
                  { id: 'days', label: t('stats.activeDays'), value: String(issue.activeDays) },
                ].map(stat => (
                  <div key={stat.id}>
                    <dt className="text-[13px] text-ink-faint">{stat.label}</dt>
                    <dd className="num mt-1 font-display text-[24px] font-semibold leading-tight">{stat.value}</dd>
                  </div>
                ))}
              </dl>
            </div>

            {issue.coverArtist && (
              <figure className="min-w-0">
                <div className="cover-slab aspect-square w-full overflow-hidden bg-paper-deep">
                  <ImageWithFallback
                    src={coverUrl}
                    alt={issue.coverArtist.title}
                    fallbackType="artist"
                    className="h-full w-full"
                    eager
                  />
                </div>
                <figcaption className="mt-4 min-w-0">
                  <span className="block text-[13px] text-ink-faint">
                    {t('issue.coverStar')}
                  </span>
                  <button
                    onClick={() => issue.coverArtist?.id && navigate(detailPath('artists', issue.coverArtist.id, issue.coverArtist.serverId))}
                    className="mt-0.5 block max-w-full truncate text-left text-[19px] font-semibold transition-colors hover:text-primary"
                  >
                    {spaceCJK(issue.coverArtist.title)}
                  </button>
                  <span className="num mt-0.5 block text-[13px] text-ink-faint">
                    {t('stats.playCount', { count: issue.coverArtist.count })}
                  </span>
                </figcaption>
              </figure>
            )}
          </article>

          {/* ============ 超级数据 ============ */}
          {issue.superlatives.length > 0 && (
            <section aria-labelledby="issue-superlatives">
              <div className="section-head">
                <h2 id="issue-superlatives">{t('issue.superlatives')}</h2>
              </div>
              <dl className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,200px),1fr))] gap-x-8 gap-y-6">
                {issue.superlatives.map(item => (
                  <div key={item.label}>
                    <dt className="text-[13px] text-ink-faint">{item.label}</dt>
                    <dd className="mt-1 text-[17px] font-semibold leading-snug">
                      {spaceCJK(item.value)}
                      {item.detail && (
                        <span className="num mt-0.5 block text-[13px] font-normal text-ink-faint">
                          {item.detail}
                        </span>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          {/* ============ 三张排行表：各一张纸片 ============ */}
          <div className="mt-10 grid grid-cols-[repeat(auto-fit,minmax(min(100%,260px),1fr))] gap-4">
            <RankTable
              title={t('section.tracks')} idSuffix="TRACKS" entries={issue.topSongs}
              onOpen={e => e.id && navigate(detailPath('songs', e.id, e.serverId))}
            />
            <RankTable
              title={t('nav.artists')} idSuffix="ARTISTS" entries={issue.topArtists}
              onOpen={e => e.id && navigate(detailPath('artists', e.id, e.serverId))}
            />
            <RankTable
              title={t('section.albums')} idSuffix="ALBUMS" entries={issue.topAlbums}
              onOpen={e => e.id && navigate(detailPath('albums', e.id, e.serverId))}
            />
          </div>

          {/* ============ 本期发现 ============ */}
          {issue.discoveries.length > 0 && (
            <section aria-labelledby="issue-discoveries">
              <div className="section-head">
                <h2 id="issue-discoveries">{t('issue.discoveries')}</h2>
                {issue.discoveries[0]?.title && (
                  <button
                    className="more -my-3 py-3"
                    onClick={() => {
                      const first = issue.discoveries[0]
                      void startRadio({ kind: 'artist', id: first.id, name: first.title, serverId: first.serverId })
                    }}
                  >
                    {t('issue.startRadio')}
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-2.5">
                {issue.discoveries.map(d => (
                  <button
                    key={d.key}
                    onClick={() => d.id && navigate(detailPath('artists', d.id, d.serverId))}
                    className="inline-flex min-h-[44px] items-center rounded-pill bg-sheet px-4 text-[15px] font-medium shadow-press transition-[transform,color] duration-200 hover:text-primary motion-reduce:transition-none [@media(hover:hover)]:hover:-translate-y-px"
                  >
                    {spaceCJK(d.title)}
                  </button>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}

/**
 * 第零期。
 *
 * 数据不够时给一句「还没攒够」是最省事的做法，也是最不负责的做法——
 * 新用户第一次点进《本期》看到的就是一句拒绝。第零期把这一屏当成真正的创刊号来做：
 * 说清楚这本刊物是什么、数据在哪、你能改什么，然后给出下一步。
 *
 * 每一句都是关于这个软件如何运作的事实，没有一句是修辞。
 * 「第零期」三个字不再作标题上方的小标签，改成这张纸片的无障碍名称。
 */
function IssueZero({ plays, onStart }: { plays: number; onStart: () => void }) {
  const { t } = useT()
  return (
    <article
      aria-label={t('issue.zero.tag')}
      className="sheet mt-8 p-5 regular:p-8"
    >
      <h2 className="max-w-[16em] font-display text-[clamp(1.75rem,4vw,2.5rem)] font-semibold leading-[1.2] tracking-[-0.02em]">
        {spaceCJK(t('issue.zero.headline'))}
      </h2>

      <div className="mt-8 grid grid-cols-1 gap-x-12 gap-y-8 wide:grid-cols-[minmax(0,1fr)_minmax(0,320px)]">
        <div className="min-w-0 max-w-[34em] space-y-4 text-[16px] leading-[1.9] text-ink">
          <p>{spaceCJK(t('issue.zero.cadence'))}</p>
          <p>{spaceCJK(t('issue.zero.honesty'))}</p>
          <p>{spaceCJK(t('issue.zero.privacy'))}</p>
        </div>

        <aside className="min-w-0 rounded-md bg-paper-deep p-5">
          <h3 className="mb-4 text-[15px] font-semibold">
            {t('issue.zero.startHere')}
          </h3>
          <ol className="space-y-4">
            {[
              {
                id: 'threshold',
                title: t('issue.zero.stepThreshold', { count: MIN_PLAYS_FOR_ISSUE }),
                desc: t('issue.zero.stepThresholdDesc'),
              },
              {
                id: 'library',
                title: t('issue.zero.stepLibrary'),
                desc: t('issue.zero.stepLibraryDesc'),
              },
              {
                id: 'taste',
                title: t('issue.zero.stepTaste'),
                desc: t('issue.zero.stepTasteDesc'),
              },
            ].map((step, index) => (
              <li key={step.id} className="flex gap-3.5">
                <span className="num flex-none text-[13px] text-ink-faint">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span className="min-w-0">
                  <span className="block text-[15px] font-semibold">
                    {spaceCJK(step.title)}
                  </span>
                  <span className="mt-0.5 block text-[13px] text-ink-faint">
                    {spaceCJK(step.desc)}
                  </span>
                </span>
              </li>
            ))}
          </ol>

          <button
            onClick={onStart}
            className="act-primary mt-6 inline-flex items-center gap-2 text-[14px]"
          >
            <Play size={14} weight="fill" />
            {t('issue.zero.goToLibrary')}
          </button>

          {plays > 0 && (
            <p className="num mt-4 text-[13px] text-ink-faint">
              {t('issue.zero.progress', { plays, total: MIN_PLAYS_FOR_ISSUE })}
            </p>
          )}
        </aside>
      </div>
    </article>
  )
}

/** 排行表：一张纸片，编号 + 名称 + 次数，行间靠留白 */
function RankTable({
  title, idSuffix, entries, onOpen,
}: {
  title: string
  /** 只用作标题的 id 后缀（issue-rank-TRACKS 等），不显示 */
  idSuffix: string
  entries: IssueEntry[]
  onOpen: (entry: IssueEntry) => void
}) {
  if (!entries.length) return null
  return (
    <section className="sheet min-w-0 p-4 regular:p-5" aria-labelledby={`issue-rank-${idSuffix}`}>
      <h2
        id={`issue-rank-${idSuffix}`}
        className="mb-2 text-[21px] font-semibold leading-tight"
      >
        {title}
      </h2>
      <ol>
        {entries.map((entry, i) => (
          <li key={entry.key}>
            <button
              onClick={() => onOpen(entry)}
              className="group flex min-h-[56px] w-full items-center gap-3 rounded-sm px-2 py-2 text-left transition-colors duration-200 [@media(hover:hover)]:hover:bg-paper-deep"
            >
              <span className="num w-6 flex-none text-[13px] text-ink-faint">
                {String(i + 1).padStart(2, '0')}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-semibold">
                  {spaceCJK(entry.title)}
                </span>
                {entry.subtitle && (
                  <span className="mt-0.5 block truncate text-[13px] text-ink-faint">
                    {spaceCJK(entry.subtitle)}
                  </span>
                )}
              </span>
              <span className="num flex-none text-[13px] text-ink-faint">{entry.count}</span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  )
}
