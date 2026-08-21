/**
 * 唱片说明 —— 专辑页的第二状态。
 *
 * 黑胶背封的角色表本来就是两栏定义列表的排版：左侧角色用宽字距等宽，
 * 右侧姓名用衬线。这些数据（contributors / notes / isrc / musicBrainzId）
 * 服务器早就随响应返回，此前被整批丢弃；没有一个同类客户端把 credits
 * 当作一个「页面」来做，最多塞进一个折叠面板。
 */

import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import type { AlbumDetail, Contributor, Song } from '@/api/types'
import { buildSpecLine } from '@/utils/audioSpec'
import { useT } from '@/i18n'

/** 角色的展示顺序与中文名。未列出的角色排在后面，按原名显示。 */
const ROLE_LABELS: Record<string, string> = {
  composer: 'song.role.composer',
  lyricist: 'song.role.lyricist',
  arranger: 'song.role.arranger',
  producer: 'song.role.producer',
  performer: 'song.role.performer',
  conductor: 'song.role.conductor',
  engineer: 'song.role.engineer',
  mixer: 'song.role.mixer',
  remixer: 'song.role.remixer',
  djmixer: 'song.role.djmixer',
  publisher: 'song.role.publisher',
  director: 'song.role.director',
  writer: 'song.role.writer',
  albumartist: 'song.role.albumArtist',
}

const ROLE_ORDER = Object.keys(ROLE_LABELS)

function roleLabel(role: string, translate: (key: string) => string): string {
  const key = ROLE_LABELS[role.toLowerCase()]
  return key ? translate(key) : role
}

/** 把整张专辑所有曲目的制作人员合并去重 */
function collectContributors(songs: Song[]): Array<{ role: string; names: string[]; ids: Map<string, string | undefined> }> {
  const byRole = new Map<string, { names: Set<string>; ids: Map<string, string | undefined> }>()
  for (const song of songs) {
    for (const c of song.ext?.contributors ?? []) {
      if (!c.name) continue
      const key = (c.role || 'other').toLowerCase()
      let entry = byRole.get(key)
      if (!entry) {
        entry = { names: new Set(), ids: new Map() }
        byRole.set(key, entry)
      }
      entry.names.add(c.name)
      // 同名人员可能只在部分曲目上带 artistId，取第一个真正有 id 的
      if (!entry.ids.get(c.name)) entry.ids.set(c.name, c.artistId)
    }
  }
  return Array.from(byRole.entries())
    .map(([role, entry]) => ({ role, names: Array.from(entry.names), ids: entry.ids }))
    .sort((a, b) => {
      const ai = ROLE_ORDER.indexOf(a.role)
      const bi = ROLE_ORDER.indexOf(b.role)
      if (ai === -1 && bi === -1) return a.role.localeCompare(b.role)
      if (ai === -1) return 1
      if (bi === -1) return -1
      return ai - bi
    })
}

export function LinerNotes({ album }: { album: AlbumDetail }) {
  const { t } = useT()
  const navigate = useNavigate()
  const credits = useMemo(() => collectContributors(album.songs), [album.songs])

  // 整张专辑的技术规格取第一首有数据的曲目：同一张专辑通常同源同规格
  const specSong = useMemo(
    () => album.songs.find(s => s.ext?.bitDepth || s.ext?.samplingRate) ?? album.songs[0] ?? null,
    [album.songs]
  )
  const spec = buildSpecLine(specSong)
  const isrcs = useMemo(
    () => Array.from(new Set(album.songs.flatMap(s => s.ext?.isrc ?? []))).slice(0, 6),
    [album.songs]
  )

  const hasAnything = !!album.notes || credits.length > 0 || spec.length > 0 || isrcs.length > 0
  if (!hasAnything) {
    return (
      <p className="py-10 text-center text-[13.5px] text-ink-faint">
        {t('album.linerNotes.emptyTitle')}
        <span className="mt-1 block text-[12px]">
          {t('album.linerNotes.emptyHint')}
        </span>
      </p>
    )
  }

  return (
    <div className="pt-2">
      {/* 札记：单栏衬线，控制在 34em 以内 */}
      {album.notes && (
        <section className="mb-11">
          <h3 className="mb-3 text-[10.5px] font-semibold uppercase tracking-[0.26em] text-ink-faint">
            {t('album.linerNotes.notes')}
          </h3>
          <p className="max-w-[34em] whitespace-pre-line text-justify font-serif text-[15px] leading-[1.85] text-ink-soft">
            {album.notes}
          </p>
          {album.externalUrl && (
            <a
              href={album.externalUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-3 inline-block border-b border-hair pb-px text-[12px] text-ink-faint transition-colors hover:border-primary hover:text-primary"
            >
              {t('album.linerNotes.viewSource')}
            </a>
          )}
        </section>
      )}

      {/* 制作人员：左角色（等宽宽字距）右姓名（衬线） */}
      {credits.length > 0 && (
        <section className="mb-11">
          <h3 className="mb-3 text-[10.5px] font-semibold uppercase tracking-[0.26em] text-ink-faint">
            {t('album.linerNotes.credits')}
          </h3>
          <dl className="border-t border-hair">
            {credits.map(({ role, names, ids }) => (
              <div
                key={role}
                className="grid grid-cols-[minmax(5.5rem,9rem)_1fr] gap-x-6 border-b border-hair-soft py-2.5"
              >
                <dt className="font-num pt-[3px] text-[10.5px] uppercase tracking-[0.16em] text-ink-faint">
                  {roleLabel(role, t)}
                </dt>
                <dd className="m-0 font-serif text-[14.5px] leading-relaxed">
                  {names.map((name, i) => {
                    const artistId = ids.get(name)
                    return (
                      <span key={name}>
                        {i > 0 && <span className="mx-2 text-ink-faint">·</span>}
                        {artistId ? (
                          <button
                            onClick={() => navigate(`/artists/${artistId}`)}
                            className="border-b border-transparent transition-colors hover:border-primary hover:text-primary"
                          >
                            {name}
                          </button>
                        ) : (
                          <button
                            onClick={() => navigate(`/search?q=${encodeURIComponent(name)}`)}
                            className="border-b border-transparent transition-colors hover:border-primary hover:text-primary"
                          >
                            {name}
                          </button>
                        )}
                      </span>
                    )
                  })}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {/* 版本记录：目录式的一块 */}
      {(spec.length > 0 || isrcs.length > 0 || album.musicBrainzId) && (
        <section>
          <h3 className="mb-3 text-[10.5px] font-semibold uppercase tracking-[0.26em] text-ink-faint">
            {t('album.linerNotes.pressing')}
          </h3>
          <dl className="border-t border-hair text-[12.5px]">
            {spec.length > 0 && (
              <SpecRow label={t('album.spec.format')}>
                <span className="font-num">{spec.join(' · ')}</span>
              </SpecRow>
            )}
            {isrcs.length > 0 && (
              <SpecRow label="ISRC">
                <span className="font-num break-all">{isrcs.join('　')}</span>
              </SpecRow>
            )}
            {album.musicBrainzId && (
              <SpecRow label="MusicBrainz">
                <a
                  href={`https://musicbrainz.org/release/${album.musicBrainzId}`}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="font-num break-all border-b border-hair pb-px transition-colors hover:border-primary hover:text-primary"
                >
                  {album.musicBrainzId}
                </a>
              </SpecRow>
            )}
          </dl>
        </section>
      )}
    </div>
  )
}

function SpecRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(5.5rem,9rem)_1fr] gap-x-6 border-b border-hair-soft py-2.5">
      <dt className="font-num text-[10.5px] uppercase tracking-[0.16em] text-ink-faint">{label}</dt>
      <dd className="m-0 text-ink-soft">{children}</dd>
    </div>
  )
}

/** 单曲页用的紧凑制作人员块 */
export function SongCredits({ contributors, composer }: { contributors?: Contributor[]; composer?: string }) {
  const { t } = useT()
  const navigate = useNavigate()
  const list = contributors ?? []
  if (!list.length && !composer) return null

  return (
    <dl className="border-t border-hair text-[13px]">
      {composer && (
        <SpecRow label={t('song.role.composer')}>
          <span className="font-serif">{composer}</span>
        </SpecRow>
      )}
      {list.map((c, i) => (
        <div
          key={`${c.role}-${c.name}-${i}`}
          className="grid grid-cols-[minmax(5.5rem,9rem)_1fr] gap-x-6 border-b border-hair-soft py-2.5"
        >
          <dt className="font-num text-[10.5px] uppercase tracking-[0.16em] text-ink-faint">
            {roleLabel(c.role, t)}
            {c.subRole && (
              <span className="ml-1 normal-case tracking-normal">
                {t('song.subRole', { value: c.subRole })}
              </span>
            )}
          </dt>
          <dd className="m-0 font-serif">
            <button
              onClick={() =>
                c.artistId
                  ? navigate(`/artists/${c.artistId}`)
                  : navigate(`/search?q=${encodeURIComponent(c.name)}`)
              }
              className="border-b border-transparent transition-colors hover:border-primary hover:text-primary"
            >
              {c.name}
            </button>
          </dd>
        </div>
      ))}
    </dl>
  )
}
