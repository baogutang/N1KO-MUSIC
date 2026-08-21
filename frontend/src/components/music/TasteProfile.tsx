/**
 * 口味画像：把推荐引擎心里那本账摊开给你看，并且允许你改。
 *
 * 推荐系统最让人不舒服的地方不是推错，而是推错了你也不知道它为什么这么想、
 * 更没法纠正。这一栏做两件事：
 *
 *   1. 把画像里排在前面的歌手 / 曲风 / 年代原样列出来，附上归一化后的权重条。
 *      数字不是「匹配度 87%」这种编出来的东西——它就是引擎打分时真正在用的值。
 *   2. 每一行都能点「不再推荐」。这是硬过滤：说了不要，就不该再从探索项里冒出来。
 *
 * 行为会撒谎——陪人听完一整张不喜欢的专辑、睡着时循环了一夜、给孩子放过儿歌，
 * 都会变成「你喜欢」。没有一个说「不是」的地方，画像只会越错越深。
 */

import { useMemo } from 'react'
import { Prohibit, ArrowCounterClockwise } from '@phosphor-icons/react'
import { useServerStore } from '@/store/serverStore'
import { useTasteStore } from '@/store/tasteStore'
import { readListeningEvents } from '@/services/listeningHistory'
import { buildRecommendationProfile } from '@/services/recommendationEngine'
import { spaceCJK } from '@/utils/cjkTypography'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'

/** 每一栏最多列这么多——这是一份画像，不是一张全量报表 */
const TOP_N = 8

interface Row {
  /** 归一化后的键，静音按它存 */
  key: string
  /** 展示名 */
  label: string
  /** 归一化到 [-1, 1] 的权重，就是打分时真正用的那个值 */
  weight: number
}

function topRows(
  map: Map<string, number>,
  labelOf: (key: string) => string
): Row[] {
  return Array.from(map.entries())
    .filter(([, weight]) => weight > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_N)
    .map(([key, weight]) => ({ key, label: labelOf(key), weight }))
}

export function TasteProfile() {
  const { t } = useT()
  const serverId = useServerStore(s => s.activeServerId)
  const { mutedArtists, mutedGenres, toggleArtist, toggleGenre, clearAll } = useTasteStore()

  const profile = useMemo(
    () => buildRecommendationProfile(serverId ? readListeningEvents(serverId) : []),
    [serverId]
  )

  const artists = useMemo(
    () => topRows(profile.artistAffinity, key => profile.artistIdentity.get(key)?.name ?? key),
    [profile]
  )
  const genres = useMemo(
    () => topRows(profile.genreAffinity, key => profile.genreIdentity?.get(key) ?? key),
    [profile]
  )
  const decades = useMemo(
    () => Array.from(profile.decadeAffinity.entries())
      .filter(([, weight]) => weight > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([decade, weight]) => ({ key: String(decade), label: `${decade}s`, weight })),
    [profile]
  )

  const mutedCount = mutedArtists.length + mutedGenres.length
  const hasProfile = artists.length > 0 || genres.length > 0

  return (
    <section aria-labelledby="taste-profile" className="pt-12">
      <div className="section-head">
        <h2 id="taste-profile">
          {t('section.tasteProfile')}<small>WHAT THE ENGINE THINKS</small>
        </h2>
        {mutedCount > 0 && (
          <button className="more" onClick={clearAll}>
            <ArrowCounterClockwise size={12} className="mr-1.5 inline" />
            {t('stats.restoreMuted', { count: mutedCount })}
          </button>
        )}
      </div>

      {!hasProfile ? (
        <p className="py-12 text-center font-serif text-[15px] text-ink-faint">
          {t('empty.taste.title')}
          <span className="mt-2 block text-[13px]">{t('empty.taste.description')}</span>
        </p>
      ) : (
        <>
          <p className="mb-7 max-w-[46em] text-[13px] leading-[1.9] text-ink-soft">
            {spaceCJK(t('stats.tasteIntro'))}
          </p>

          <div className="grid grid-cols-1 gap-x-12 gap-y-9 md:grid-cols-3">
            <ProfileColumn
              title={t('nav.artists')} tag="ARTISTS" rows={artists}
              muted={mutedArtists} onToggle={toggleArtist}
            />
            <ProfileColumn
              title={t('stats.genres')} tag="GENRES" rows={genres}
              muted={mutedGenres} onToggle={toggleGenre}
            />
            <ProfileColumn
              title={t('stats.decades')} tag="DECADES" rows={decades}
              muted={[]} onToggle={undefined}
            />
          </div>
        </>
      )}
    </section>
  )
}

function ProfileColumn({
  title, tag, rows, muted, onToggle,
}: {
  title: string
  tag: string
  rows: Row[]
  muted: string[]
  onToggle?: (key: string) => void
}) {
  const { t } = useT()
  if (!rows.length) return null
  return (
    <div className="min-w-0">
      <h3 className="mb-3 flex items-baseline gap-2.5 border-b border-hair pb-2 font-serif text-[17px] font-bold">
        {title}
        <span className="latin-tag font-num text-[9.5px] tracking-[0.22em] text-ink-faint">{tag}</span>
      </h3>
      <ul>
        {rows.map(row => {
          const isMuted = muted.includes(row.key)
          return (
            <li key={row.key} className="group border-b border-hair-soft py-2.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className={cn(
                  'min-w-0 truncate text-[13.5px]',
                  isMuted ? 'text-ink-faint line-through' : 'text-ink'
                )}>
                  {spaceCJK(row.label)}
                </span>
                <span className="flex flex-none items-center gap-2">
                  <span className="font-num text-[11px] text-ink-faint">
                    {row.weight.toFixed(2)}
                  </span>
                  {onToggle && (
                    <button
                      onClick={() => onToggle(row.key)}
                      aria-label={isMuted
                        ? t('stats.unmute', { name: row.label })
                        : t('stats.mute', { name: row.label })}
                      aria-pressed={isMuted}
                      className={cn(
                        'transition-opacity duration-200',
                        isMuted
                          ? 'text-primary opacity-100'
                          : 'text-ink-faint opacity-0 hover:text-primary group-hover:opacity-100 focus-visible:opacity-100'
                      )}
                    >
                      <Prohibit size={13} />
                    </button>
                  )}
                </span>
              </div>
              {/* 权重条：一根发丝线上的一段朱色，不引入图表也不引入新色 */}
              <div className="mt-1.5 h-[2px] w-full bg-hair-soft">
                <div
                  className={cn('h-full', isMuted ? 'bg-hair' : 'bg-primary')}
                  style={{ width: `${Math.max(2, Math.min(100, row.weight * 100))}%` }}
                />
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
