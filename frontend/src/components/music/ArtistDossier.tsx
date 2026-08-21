/**
 * 歌手档案。
 *
 * 音乐服务器只知道标签里写了什么。成立于哪一年、来自哪里、当年是谁在乐队里——
 * 这些从来不在 ID3 里，但恰恰是「认识一支乐队」需要的。
 *
 * 版式按档案页来：左边是词条式的键值，右边是成员名单，底下一行外部链接。
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
  if (profile.endYear) return `${profile.beginYear}–${profile.endYear}`
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

  if (!facts.length && !profile.members.length && !profile.links.length) return null

  return (
    <section className={cn('border-t border-hair pt-5', className)} aria-labelledby="artist-dossier">
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <h2 id="artist-dossier" className="text-[10.5px] uppercase tracking-[0.24em] text-primary">
          {t('section.dossier')}
          <span className="latin-tag"> · DOSSIER</span>
        </h2>
        <span className="latin-tag text-[10px] tracking-[0.16em] text-ink-faint">MUSICBRAINZ</span>
      </div>

      <div className="grid grid-cols-1 gap-x-12 gap-y-6 md:grid-cols-[minmax(0,4fr)_minmax(0,6fr)]">
        {facts.length > 0 && (
          <dl className="min-w-0 space-y-3">
            {facts.map(fact => (
              <div key={fact.label}>
                <dt className="text-[10.5px] tracking-[0.14em] text-ink-faint">{fact.label}</dt>
                <dd className="mt-0.5 font-serif text-[15px]">{spaceCJK(fact.value)}</dd>
              </div>
            ))}
          </dl>
        )}

        {profile.members.length > 0 && (
          <div className="min-w-0">
            <p className="mb-2 text-[10.5px] tracking-[0.14em] text-ink-faint">
              {t('artist.members')}
            </p>
            <ul className="space-y-1">
              {profile.members.map(member => (
                <li
                  key={`${member.name}-${member.from ?? ''}`}
                  className="flex items-baseline justify-between gap-4 border-b border-hair-soft py-1.5"
                >
                  <span className="min-w-0 truncate font-serif text-[14px]">
                    {spaceCJK(member.name)}
                  </span>
                  {(member.from || member.to) && (
                    <span className="font-num flex-none text-[11px] text-ink-faint">
                      {member.from ?? '?'}–{member.to ?? t('artist.present')}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {profile.links.length > 0 && (
        <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2">
          {profile.links.map(link => (
            <a
              key={link.labelKey}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="inline-flex items-center gap-1.5 text-[12px] text-ink-soft transition-colors hover:text-primary"
            >
              {t(link.labelKey)}
              <ArrowSquareOut size={11} />
            </a>
          ))}
        </div>
      )}
    </section>
  )
}
