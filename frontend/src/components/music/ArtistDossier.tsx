/**
 * 歌手档案。
 *
 * 音乐服务器只知道标签里写了什么。成立于哪一年、来自哪里、当年是谁在乐队里——
 * 这些从来不在 ID3 里，但恰恰是「认识一支乐队」需要的。
 *
 * 版式是一张 sheet 纸片：左边是词条式的键值，右边是成员名单，底下一行外部链接。
 * 没有 MBID、功能没开、或者查不到，整块就不出现——不摆空盒子。
 */

import { useEffect, useState } from 'react'
import { ArrowSquareOut } from '@phosphor-icons/react'
import { useSettingsStore } from '@/store/settingsStore'
import { fetchArtistProfile, type ArtistProfile } from '@/services/musicbrainz'
import { spaceCJK } from '@/utils/cjkTypography'
import { t as translate, useT } from '@/i18n'
import { cn } from '@/lib/utils'

function lifeSpanLabel(profile: ArtistProfile): string | null {
  if (!profile.beginYear) return null
  if (profile.endYear) return `${profile.beginYear}-${profile.endYear}`
  return profile.type === 'Person'
    ? translate('artist.bornIn', { year: profile.beginYear })
    : translate('artist.foundedIn', { year: profile.beginYear })
}

export function ArtistDossier({
  musicBrainzId,
  className,
}: {
  musicBrainzId?: string
  className?: string
}) {
  const { t } = useT()
  const enabled = useSettingsStore(s => s.musicBrainzEnabled)
  const [profile, setProfile] = useState<ArtistProfile | null>(null)

  useEffect(() => {
    setProfile(null)
    if (!enabled || !musicBrainzId) return
    const controller = new AbortController()
    void fetchArtistProfile(musicBrainzId, { signal: controller.signal })
      .then(result => {
        if (!controller.signal.aborted) setProfile(result)
      })
    return () => controller.abort()
  }, [enabled, musicBrainzId])

  if (!profile) return null

  const span = lifeSpanLabel(profile)
  const origin = profile.beginArea || profile.area
  const facts = [
    span ? { label: t('artist.years'), value: span } : null,
    origin ? { label: t('artist.origin'), value: origin } : null,
    profile.type
      ? {
          label: t('artist.kind'),
          value: profile.type === 'Person' ? t('artist.kindPerson') : t('artist.kindGroup'),
        }
      : null,
  ].filter((fact): fact is { label: string; value: string } => fact !== null)

  /**
   * 外部链接要过 scheme 白名单再进 href。
   *
   * 这些 URL 来自 MusicBrainz——一个任何人都能编辑的公共数据库。
   * musicbrainz.ts 自己的注释强调「外部来的值不该直接拼进 URL」，
   * 那条纪律在这里同样适用：javascript: 和 data: 绝不能落到 href 上。
   */
  const safeLinks = profile.links.filter(link => {
    try {
      const scheme = new URL(link.url).protocol
      return scheme === 'https:' || scheme === 'http:'
    } catch {
      return false
    }
  })

  if (!facts.length && !profile.members.length && !safeLinks.length) return null

  return (
    <section className={cn('sheet p-5 regular:p-6', className)} aria-labelledby="artist-dossier">
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <h2 id="artist-dossier" className="font-display text-[21px] font-semibold leading-tight">
          {t('section.dossier')}
        </h2>
        {/* 数据来源署名：英文界面下同样该出现 */}
        <span className="text-xs text-ink-faint">MusicBrainz</span>
      </div>

      <div className="grid grid-cols-1 gap-x-12 gap-y-6 regular:grid-cols-[minmax(0,4fr)_minmax(0,6fr)]">
        {facts.length > 0 && (
          <dl className="min-w-0 space-y-3">
            {facts.map(fact => (
              <div key={fact.label}>
                <dt className="text-[13px] text-ink-faint">{fact.label}</dt>
                <dd className="mt-0.5 text-[15.5px] font-medium">{spaceCJK(fact.value)}</dd>
              </div>
            ))}
          </dl>
        )}

        {profile.members.length > 0 && (
          <div className="min-w-0">
            <p className="mb-1 text-[13px] text-ink-faint">
              {t('artist.members')}
            </p>
            <ul>
              {profile.members.map(member => (
                <li
                  key={`${member.name}-${member.from ?? ''}`}
                  className="flex items-baseline justify-between gap-4 rounded-sm px-2 py-1.5"
                >
                  <span className="min-w-0 truncate text-[14.5px] font-medium">
                    {spaceCJK(member.name)}
                  </span>
                  {(member.from || member.to) && (
                    <span className="num flex-none text-[13px] text-ink-faint">
                      {member.from ?? '?'}-{member.to ?? t('artist.present')}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {safeLinks.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-0">
          {safeLinks.map(link => (
            <a
              key={link.labelKey}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="inline-flex min-h-11 items-center gap-1.5 text-[13.5px] font-medium text-primary underline-offset-4 hover:underline"
            >
              {t(link.labelKey)}
              <ArrowSquareOut size={13} />
            </a>
          ))}
        </div>
      )}
    </section>
  )
}
