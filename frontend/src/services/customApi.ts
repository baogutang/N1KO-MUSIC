/**
 * 自定义远程接口（歌词/封面模板）的唯一实现（阶段 4.3）。
 *
 * 此前两处各写一份且已漂移（歌词一份 `‖` 取字段、另一份 `??`；
 * 封面 `.replace` 只换第一个占位符——占位符出现两次时第二次漏掉）。
 * 全局替换 + 占位符仅支持 `{name}` 形态。
 */

type TemplateSong = {
  artist?: string
  album?: string
  title?: string
  id?: string
}

function fillTemplate(template: string, song: TemplateSong, keys: Array<keyof TemplateSong>): string {
  if (!template) return ''
  let out = template
  for (const key of keys) {
    // 全局替换（g）：占位符在模板里出现多次时全部替换（阶段 4.3 修正）
    out = out.split(`{${key}}`).join(encodeURIComponent((song[key] ?? '') as string))
  }
  return out
}

/** 远程歌词模板 → URL（占位符 {artist} {title} {album} {id}） */
export function buildRemoteLyricsUrl(template: string, song: TemplateSong): string {
  return fillTemplate(template, song, ['artist', 'title', 'album', 'id'])
}

/** 远程封面模板 → URL（占位符 {artist} {album} {title} {id}） */
export function buildRemoteCoverUrl(template: string, song: TemplateSong): string {
  return fillTemplate(template, song, ['artist', 'album', 'title', 'id'])
}

/** LrcApi 公开实例。没自建接口时用它补歌词和封面。 */
export const LRCAPI_LYRICS_URL = 'https://api.lrc.cx/lyrics'
export const LRCAPI_COVER_URL = 'https://api.lrc.cx/cover'

/**
 * 封面地址。模板里有 {artist} 这类占位符就按占位符替换；
 * 否则当成 LrcApi 这种基地址，把歌手、专辑、歌名补进查询参数。
 */
export function coverUrlFromTemplate(template: string, song: TemplateSong & { path?: string }): string {
  if (!template) return ''
  if (template.includes('{')) return buildRemoteCoverUrl(template, song)
  const url = new URL(template)
  if (song.title) url.searchParams.set('title', song.title)
  if (song.artist) url.searchParams.set('artist', song.artist)
  if (song.album) url.searchParams.set('album', song.album)
  if (song.path) url.searchParams.set('path', song.path)
  return url.toString()
}
