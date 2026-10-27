/**
 * 唱片说明 —— 专辑页的第二状态。
 *
 * 札记、制作人员、版本记录各是一张 sheet 纸片，靠纸片的高低和留白分区，不画线。
 * 制作人员是两栏定义列表：左侧角色（ink-faint），右侧姓名（可点，去歌手页或搜索）。
 * 这些数据（contributors / notes / isrc / musicBrainzId）服务器早就随响应返回，
 * 此前被整批丢弃；没有一个同类客户端把 credits 当作一个「页面」来做。
 */

import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import type { AlbumDetail, Contributor, Song } from '@/api/types'
import { buildSpecLine } from '@/utils/audioSpec'
import { useT } from '@/i18n'
import { detailPath } from '@/utils/detailPath'

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

/** 姓名链接：文字级，hover 才出下划线；触屏上命中区拉到 44px */
const NAME_LINK =
  'inline-flex min-h-8 items-center rounded-sm text-ink underline-offset-4 transition-colors hover:text-primary hover:underline [@media(pointer:coarse)]:min-h-11'

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
      <p className="rounded-lg bg-paper-deep px-6 py-10 text-center text-[14px] text-ink-soft">
        {t('album.linerNotes.emptyTitle')}
        <span className="mt-1 block text-[13px] text-ink-faint">
          {t('album.linerNotes.emptyHint')}
        </span>
      </p>
    )
  }

  return (
    <div className="space-y-4">
      {/* 札记：单栏正文，控制在 34em 以内 */}
      {album.notes && (
        <section className="sheet p-5 regular:p-6">
          <h3 className="mb-3 font-display text-[17px] font-semibold">
            {t('album.notes.title')}
          </h3>
          <p className="max-w-[34em] whitespace-pre-line text-[15px] leading-[1.85] text-ink-soft">
            {album.notes}
          </p>
          {album.externalUrl && (
            <a
              href={album.externalUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-2 inline-flex min-h-11 items-center text-[14px] font-medium text-primary underline-offset-4 hover:underline"
            >
              {t('album.linerNotes.sourceLink')}
            </a>
          )}
        </section>
      )}

      {/* 制作人员：左角色、右姓名 */}
      {credits.length > 0 && (
        <section className="sheet p-5 regular:p-6">
          <h3 className="mb-3 font-display text-[17px] font-semibold">
            {t('album.credits.title')}
          </h3>
          <dl>
            {credits.map(({ role, names, ids }) => (
              <div
                key={role}
                className="grid grid-cols-[minmax(5.5rem,9rem)_1fr] gap-x-6 rounded-sm px-2 py-1.5"
              >
                <dt className="flex min-h-8 items-center text-[13px] text-ink-faint [@media(pointer:coarse)]:min-h-11">
                  {roleLabel(role, t)}
                </dt>
                <dd className="m-0 flex flex-wrap items-center gap-x-4 gap-y-0 text-[14.5px]">
                  {names.map(name => {
                    const artistId = ids.get(name)
                    return artistId ? (
                      <button
                        key={name}
                        onClick={() => navigate(detailPath('artists', artistId, album.serverId))}
                        className={NAME_LINK}
                      >
                        {name}
                      </button>
                    ) : (
                      <button
                        key={name}
                        onClick={() => navigate(`/search?q=${encodeURIComponent(name)}`)}
                        className={NAME_LINK}
                      >
                        {name}
                      </button>
                    )
                  })}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {/* 版本记录：规格、ISRC、MusicBrainz */}
      {(spec.length > 0 || isrcs.length > 0 || album.musicBrainzId) && (
        <section className="sheet p-5 regular:p-6">
          <h3 className="mb-3 font-display text-[17px] font-semibold">
            {t('album.pressing.title')}
          </h3>
          <dl className="text-[13.5px]">
            {spec.length > 0 && (
              <SpecRow label={t('album.spec.format')}>
                <span className="num flex flex-wrap gap-x-3">
                  {spec.map(item => (
                    <span key={item}>{item}</span>
                  ))}
                </span>
              </SpecRow>
            )}
            {isrcs.length > 0 && (
              <SpecRow label="ISRC">
                <span className="num break-all">{isrcs.join('　')}</span>
              </SpecRow>
            )}
            {album.musicBrainzId && (
              <SpecRow label="MusicBrainz">
                <a
                  href={`https://musicbrainz.org/release/${album.musicBrainzId}`}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="num break-all text-primary underline-offset-4 hover:underline"
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
    <div className="grid grid-cols-[minmax(5.5rem,9rem)_1fr] items-baseline gap-x-6 rounded-sm px-2 py-2">
      <dt className="text-[13px] text-ink-faint">{label}</dt>
      <dd className="m-0 text-ink-soft">{children}</dd>
    </div>
  )
}

/** 单曲页用的紧凑制作人员块 */
export function SongCredits({
  contributors,
  composer,
  serverId,
}: {
  contributors?: Contributor[]
  composer?: string
  /** 制作人员归属的音源（跳歌手页带 src 用） */
  serverId?: string
}) {
  const { t } = useT()
  const navigate = useNavigate()
  const list = contributors ?? []
  if (!list.length && !composer) return null

  return (
    <dl className="text-[13.5px]">
      {composer && (
        <SpecRow label={t('song.role.composer')}>
          <span className="text-ink">{composer}</span>
        </SpecRow>
      )}
      {list.map((c, i) => (
        <div
          key={`${c.role}-${c.name}-${i}`}
          className="grid grid-cols-[minmax(5.5rem,9rem)_1fr] items-baseline gap-x-6 rounded-sm px-2 py-2"
        >
          <dt className="text-[13px] text-ink-faint">
            {roleLabel(c.role, t)}
            {c.subRole && (
              <span className="ml-1">
                {t('song.subRole', { value: c.subRole })}
              </span>
            )}
          </dt>
          <dd className="m-0">
            <button
              onClick={() =>
                c.artistId
                  ? navigate(detailPath('artists', c.artistId, serverId))
                  : navigate(`/search?q=${encodeURIComponent(c.name)}`)
              }
              className={NAME_LINK}
            >
              {c.name}
            </button>
          </dd>
        </div>
      ))}
    </dl>
  )
}
