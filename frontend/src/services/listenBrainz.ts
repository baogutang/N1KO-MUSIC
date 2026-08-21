/**
 * 直连打卡（ListenBrainz 及兼容端点）。
 *
 * 服务端转发打卡是一条依赖：Navidrome 挂了、或者你根本不想让它拿着你的
 * Last.fm 密码，收听记录就断了。这里由客户端直接提交，和服务端那条路并行，
 * 两边都记也不冲突——ListenBrainz 自己按「同一秒同一首」去重。
 *
 * 为什么只做 ListenBrainz 及兼容端点，不做 Last.fm 直连：Last.fm 的写接口
 * 要求用 app 级 api_secret 对每次请求签名，而纯前端应用没有任何地方能安全
 * 放这个 secret——打包进去等于公开。Last.fm 用户可以走服务端转发，
 * 或者用 ListenBrainz 官方的 Last.fm 桥接。
 */

import type { Song } from '@/api/types'
import { t } from '@/i18n'

export const LISTENBRAINZ_DEFAULT_URL = 'https://api.listenbrainz.org'

/** 播放到这个比例（或这么多秒）才算一次收听，与 ListenBrainz 的口径一致 */
export const LISTEN_MIN_RATIO = 0.5
export const LISTEN_MIN_SECONDS = 240

/** 失败队列上限。攒太多既没意义，也会把 localStorage 撑爆 */
export const MAX_PENDING_LISTENS = 200

export interface ListenPayload {
  listened_at: number
  track_metadata: {
    artist_name: string
    track_name: string
    release_name?: string
    additional_info?: Record<string, unknown>
  }
}

/** ListenBrainz 的口径：过半或满 4 分钟 */
export function qualifiesAsListen(listenedSeconds: number, durationSeconds: number): boolean {
  if (durationSeconds <= 0) return listenedSeconds >= LISTEN_MIN_SECONDS
  return listenedSeconds >= Math.min(durationSeconds * LISTEN_MIN_RATIO, LISTEN_MIN_SECONDS)
}

/**
 * 组装一条 listen。
 *
 * listened_at 用秒级 Unix 时间戳，且必须是**开始播放**的时间——
 * ListenBrainz 的去重和时间轴都按这个字段来，传结束时间会让同一首歌在
 * 不同客户端上错开成两条。
 */
export function buildListen(song: Song, startedAtMs: number): ListenPayload | null {
  const artist = song.artist?.trim()
  const track = song.title?.trim()
  if (!artist || !track) return null

  const additional: Record<string, unknown> = {
    media_player: 'N1KO MUSIC',
    submission_client: 'N1KO MUSIC',
  }
  if (song.duration && song.duration > 0) additional.duration_ms = Math.round(song.duration * 1000)
  if (song.track) additional.tracknumber = song.track
  // MBID 在 SongExtras 上，只有走过详情接口的歌才有；有就带上，能让
  // ListenBrainz 精确匹配到录音而不是靠字符串猜。
  const mbid = (song as Song & { musicBrainzId?: string }).musicBrainzId
  if (mbid) additional.recording_mbid = mbid

  return {
    listened_at: Math.floor(startedAtMs / 1000),
    track_metadata: {
      artist_name: artist,
      track_name: track,
      release_name: song.album?.trim() || undefined,
      additional_info: additional,
    },
  }
}

/** playing_now 不带 listened_at——带了会被服务端拒收 */
export function buildPlayingNow(song: Song): ListenPayload | null {
  const listen = buildListen(song, Date.now())
  if (!listen) return null
  const { listened_at: _ignored, ...rest } = listen
  return rest as ListenPayload
}

export type SubmitOutcome =
  | { ok: true }
  /** 凭据或请求本身有问题，重试没有意义 */
  | { ok: false; retryable: false; message: string }
  /** 网络或服务端临时故障，值得放进队列稍后再来 */
  | { ok: false; retryable: true; message: string }

function normalizeBaseUrl(apiUrl: string): string {
  return apiUrl.trim().replace(/\/+$/, '')
}

/**
 * 提交。
 *
 * 4xx 一律不重试（401 是 token 错了，400 是数据不合法，重试只会一直撞墙）；
 * 429 和 5xx、以及网络层失败才进重试队列。
 */
export async function submitListens(
  apiUrl: string,
  token: string,
  listens: ListenPayload[],
  listenType: 'single' | 'import' | 'playing_now',
  signal?: AbortSignal
): Promise<SubmitOutcome> {
  if (!token.trim()) return { ok: false, retryable: false, message: t('scrobble.error.noToken') }
  if (!listens.length) return { ok: true }

  try {
    const response = await fetch(`${normalizeBaseUrl(apiUrl)}/1/submit-listens`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Token ${token.trim()}`,
      },
      body: JSON.stringify({ listen_type: listenType, payload: listens }),
      signal,
    })
    if (response.ok) return { ok: true }

    const text = await response.text().catch(() => '')
    const message = `${response.status} ${text.slice(0, 200)}`.trim()
    if (response.status === 429 || response.status >= 500) {
      return { ok: false, retryable: true, message }
    }
    return { ok: false, retryable: false, message }
  } catch (error) {
    return {
      ok: false,
      retryable: true,
      message: error instanceof Error ? error.message : t('scrobble.error.network'),
    }
  }
}

/** 验证 token：ListenBrainz 提供了专门的校验接口，不必靠提交一条假记录来试 */
export async function validateToken(
  apiUrl: string,
  token: string
): Promise<{ valid: boolean; userName?: string; message?: string }> {
  try {
    const response = await fetch(`${normalizeBaseUrl(apiUrl)}/1/validate-token`, {
      headers: { Authorization: `Token ${token.trim()}` },
    })
    if (!response.ok) return { valid: false, message: `HTTP ${response.status}` }
    const data = await response.json() as { valid?: boolean; user_name?: string; message?: string }
    return { valid: !!data.valid, userName: data.user_name, message: data.message }
  } catch (error) {
    return { valid: false, message: error instanceof Error ? error.message : t('scrobble.error.network') }
  }
}

/**
 * 失败队列的裁剪。
 *
 * 满了丢**最旧**的：新的收听更可能还在服务端的接收窗口内，
 * 而且用户更在意最近听了什么。
 */
export function trimPending(pending: ListenPayload[]): ListenPayload[] {
  return pending.length <= MAX_PENDING_LISTENS
    ? pending
    : pending.slice(pending.length - MAX_PENDING_LISTENS)
}
