/**
 * 《本期》—— 把一段收听期读成一期刊物。
 *
 * 刊头、编者按、封面故事、排行表、超级数据、本期发现。
 * 编者按只由真实数据拼成的模板句组成（见 services/issue.ts），不虚构。
 */

import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CaretLeft, CaretRight, Play } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import { useServerStore } from '@/store/serverStore'
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
  const { t, locale } = useT()
  const navigate = useNavigate()
  const serverId = useServerStore(s => s.activeServerId)
  const [kind, setKind] = useState<'month' | 'year'>('month')
  const [offset, setOffset] = useState(0)

  const events = useMemo(
    () => (serverId ? readListeningEvents(serverId) : []),
    [serverId]
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
    <div className="animate-fade-in pb-8">
      {/* ============ 刊头 ============ */}
      <header className="pt-10">
        <div className="flex flex-wrap items-baseline justify-between gap-4 border-b-2 border-ink pb-3">
          <div className="flex items-baseline gap-4">
            <h1 className="font-serif text-3xl font-black tracking-tight">{t('nav.issue')}</h1>
            {/* 这个拉丁小标是给中文标题作注的排版装饰；英文界面下标题本身
                就是 "This Issue"，再跟一个 ISSUE 只是重复。 */}
            {locale === 'zh-CN' && (
              <span className="font-num text-[11px] tracking-[0.28em] text-ink-faint">ISSUE</span>
            )}
          </div>
          <div className="flex items-center gap-5">
            <div role="radiogroup" aria-label={t('issue.periodKind')} className="flex items-baseline gap-4">
              {(['month', 'year'] as const).map(k => (
                <button
                  key={k}
                  role="radio"
                  aria-checked={kind === k}
                  onClick={() => { setKind(k); setOffset(0) }}
                  className={cn(
                    'text-[13px] tracking-[0.18em] transition-colors duration-200',
                    kind === k ? 'font-semibold text-primary' : 'text-ink-soft hover:text-primary'
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
                className="act-icon grid h-7 w-7 place-items-center rounded-full border border-hair text-ink-soft transition-colors hover:border-ink hover:text-ink"
              >
                <CaretLeft size={12} />
              </button>
              <span className="font-num min-w-[4.5rem] text-center text-[12px] tracking-[0.14em]">
                {period.label}
              </span>
              <button
                onClick={() => setOffset(o => Math.min(0, o + 1))}
                disabled={offset >= 0}
                aria-label={t('issue.next')}
                className="act-icon grid h-7 w-7 place-items-center rounded-full border border-hair text-ink-soft transition-colors hover:border-ink hover:text-ink disabled:opacity-30"
              >
                <CaretRight size={12} />
              </button>
            </div>
          </div>
        </div>
      </header>

      {!issue.hasEnough ? (
        <IssueZero plays={issue.plays} onStart={() => navigate('/library')} />
      ) : (
        <>
          {/* ============ 编者按 + 封面故事 ============ */}
          <article className="grid grid-cols-1 items-start gap-10 border-b border-hair py-11 lg:grid-cols-[minmax(0,7fr)_minmax(0,4fr)] lg:gap-14">
            <div className="min-w-0">
              <p className="mb-5 flex items-center gap-3.5 text-[11px] tracking-[0.34em] text-primary">
                {t('issue.editorsNote')}
                <span aria-hidden className="h-px w-14 bg-primary" />
              </p>
              <p className="max-w-[34em] font-serif text-[17px] leading-[1.9] text-ink">
                {spaceCJK(issue.editorsNote)}
              </p>

              <dl className="mt-8 grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-4">
                {[
                  { id: 'plays', label: t('stats.plays'), value: String(issue.plays) },
                  { id: 'listened', label: t('stats.listenedTime'), value: formatHours(issue.listenedSeconds, t) },
                  { id: 'songs', label: t('stats.uniqueSongs'), value: String(issue.uniqueSongs) },
                  { id: 'days', label: t('stats.activeDays'), value: String(issue.activeDays) },
                ].map(stat => (
                  <div key={stat.id}>
                    <dt className="text-[10.5px] uppercase tracking-[0.2em] text-ink-faint">
                      {stat.label}
                    </dt>
                    <dd className="font-num mt-1 text-[22px] font-semibold">{stat.value}</dd>
                  </div>
                ))}
              </dl>
            </div>

            {issue.coverArtist && (
              <figure className="min-w-0">
                <div className="aspect-square w-full overflow-hidden rounded-md ring-1 ring-hair-soft">
                  <ImageWithFallback
                    src={coverUrl}
                    alt={issue.coverArtist.title}
                    fallbackType="artist"
                    className="h-full w-full"
                    eager
                  />
                </div>
                <figcaption className="mt-3 flex items-baseline justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block text-[10.5px] tracking-[0.24em] text-primary">
                      {t('issue.coverStar')}
                    </span>
                    <button
                      onClick={() => issue.coverArtist?.id && navigate(`/artists/${issue.coverArtist.id}?src=${encodeURIComponent(issue.coverArtist.serverId ?? '')}`)}
                      className="mt-1 block truncate font-serif text-[19px] font-bold transition-colors hover:text-primary"
                    >
                      {spaceCJK(issue.coverArtist.title)}
                    </button>
                  </span>
                  <span className="font-num flex-none text-[11px] text-ink-faint">
                    {t('stats.playCount', { count: issue.coverArtist.count })}
                  </span>
                </figcaption>
              </figure>
            )}
          </article>

          {/* ============ 超级数据 ============ */}
          {issue.superlatives.length > 0 && (
            <section className="border-b border-hair py-9" aria-labelledby="issue-superlatives">
              <h2 id="issue-superlatives" className="mb-5 text-[10.5px] uppercase tracking-[0.26em] text-ink-faint">
                {t('issue.superlatives')}
              </h2>
              <dl className="grid grid-cols-1 gap-x-10 gap-y-5 sm:grid-cols-2 lg:grid-cols-4">
                {issue.superlatives.map(item => (
                  <div key={item.label}>
                    <dt className="text-[10.5px] tracking-[0.16em] text-ink-faint">{item.label}</dt>
                    <dd className="mt-1 font-serif text-[17px] font-semibold leading-snug">
                      {spaceCJK(item.value)}
                      {item.detail && (
                        <span className="font-num ml-2 text-[11.5px] font-normal text-ink-faint">
                          {item.detail}
                        </span>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          {/* ============ 三张排行表 ============ */}
          <div className="grid grid-cols-1 gap-x-12 lg:grid-cols-3">
            <RankTable
              title={t('section.tracks')} tag="TRACKS" entries={issue.topSongs}
              onOpen={e => e.id && navigate(`/songs/${e.id}`)}
            />
            <RankTable
              title={t('nav.artists')} tag="ARTISTS" entries={issue.topArtists}
              onOpen={e => e.id && navigate(`/artists/${e.id}`)}
            />
            <RankTable
              title={t('section.albums')} tag="ALBUMS" entries={issue.topAlbums}
              onOpen={e => e.id && navigate(`/albums/${e.id}`)}
            />
          </div>

          {/* ============ 本期发现 ============ */}
          {issue.discoveries.length > 0 && (
            <section className="mt-10 border-t border-hair pt-8" aria-labelledby="issue-discoveries">
              <div className="section-head">
                <h2 id="issue-discoveries">
                  {t('issue.discoveries')}<small>FIRST HEARD</small>
                </h2>
                {issue.discoveries[0]?.title && (
                  <button
                    className="more"
                    onClick={() => {
                      const first = issue.discoveries[0]
                      void startRadio({ kind: 'artist', id: first.id, name: first.title, serverId: first.serverId })
                    }}
                  >
                    <Play size={12} className="mr-1.5 inline" />
                    {t('issue.startRadio')}
                  </button>
                )}
              </div>
              <p className="font-serif text-[20px] font-semibold leading-[2.1] lg:text-[24px]">
                {issue.discoveries.map((d, i) => (
                  <span key={d.key}>
                    {i > 0 && (
                      <span aria-hidden className="mx-2 align-middle text-[0.7em] font-normal text-ink-faint">
                        ·
                      </span>
                    )}
                    <button
                      onClick={() => d.id && navigate(`/artists/${d.id}`)}
                      className="border-b border-transparent transition-colors duration-200 hover:border-primary hover:text-primary"
                    >
                      {spaceCJK(d.title)}
                    </button>
                  </span>
                ))}
              </p>
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
 */
function IssueZero({ plays, onStart }: { plays: number; onStart: () => void }) {
  const { t } = useT()
  return (
    <article className="py-12">
      <p className="mb-5 flex items-center gap-3.5 text-[11px] tracking-[0.34em] text-primary">
        {t('issue.zero.tag')}
        <span aria-hidden className="h-px w-14 bg-primary" />
      </p>

      <h2 className="max-w-[16em] font-serif text-[clamp(1.75rem,4vw,2.75rem)] font-bold leading-[1.25]">
        {spaceCJK(t('issue.zero.headline'))}
      </h2>

      <div className="mt-9 grid grid-cols-1 gap-x-14 gap-y-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,4fr)]">
        <div className="min-w-0 max-w-[34em] space-y-4 font-serif text-[15.5px] leading-[1.95] text-ink">
          <p>{spaceCJK(t('issue.zero.cadence'))}</p>
          <p>{spaceCJK(t('issue.zero.honesty'))}</p>
          <p>{spaceCJK(t('issue.zero.privacy'))}</p>
        </div>

        <aside className="min-w-0 border-t border-hair pt-5 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
          <p className="mb-4 text-[10.5px] uppercase tracking-[0.24em] text-primary">
            {t('issue.zero.startHere')}
          </p>
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
                <span className="font-num flex-none text-[11px] text-ink-faint">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span className="min-w-0">
                  <span className="block font-serif text-[15px] font-semibold">
                    {spaceCJK(step.title)}
                  </span>
                  <span className="mt-0.5 block text-[12px] text-ink-faint">
                    {spaceCJK(step.desc)}
                  </span>
                </span>
              </li>
            ))}
          </ol>

          <button
            onClick={onStart}
            className="act-primary mt-7 inline-flex items-center gap-2 border-b border-ink pb-1.5 text-sm font-semibold tracking-[0.12em] transition-colors hover:border-primary hover:text-primary"
          >
            <Play size={12} weight="fill" />
            {t('issue.zero.goToLibrary')}
          </button>

          {plays > 0 && (
            <p className="font-num mt-5 text-[11px] text-ink-faint">
              {t('issue.zero.progress', { plays, total: MIN_PLAYS_FOR_ISSUE })}
            </p>
          )}
        </aside>
      </div>
    </article>
  )
}

/** 排行表：编号 + 名称 + 次数，纯发丝线，不用卡片 */
function RankTable({
  title, tag, entries, onOpen,
}: {
  title: string
  tag: string
  entries: IssueEntry[]
  onOpen: (entry: IssueEntry) => void
}) {
  if (!entries.length) return null
  return (
    <section className="py-9" aria-labelledby={`issue-rank-${tag}`}>
      <h2
        id={`issue-rank-${tag}`}
        className="mb-4 flex items-baseline gap-2.5 border-b border-hair pb-2 font-serif text-[19px] font-bold"
      >
        {title}
        <span className="latin-tag font-num text-[9.5px] tracking-[0.22em] text-ink-faint">{tag}</span>
      </h2>
      <ol>
        {entries.map((entry, i) => (
          <li key={entry.key}>
            <button
              onClick={() => onOpen(entry)}
              className="group flex w-full items-baseline gap-3 border-b border-hair-soft py-2.5 text-left transition-[background,transform] duration-200 hover:translate-x-1 hover:bg-paper-deep"
            >
              <span className="font-num w-6 flex-none text-[11px] text-ink-faint">
                {String(i + 1).padStart(2, '0')}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-serif text-[14.5px] font-semibold group-hover:text-primary">
                  {spaceCJK(entry.title)}
                </span>
                {entry.subtitle && (
                  <span className="mt-0.5 block truncate text-[11px] text-ink-faint">
                    {spaceCJK(entry.subtitle)}
                  </span>
                )}
              </span>
              <span className="font-num flex-none text-[11px] text-ink-faint">{entry.count}</span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  )
}
