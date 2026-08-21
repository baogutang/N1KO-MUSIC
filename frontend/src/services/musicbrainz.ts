/**
 * 歌手档案：从 MusicBrainz 补上曲库里没有的那部分。
 *
 * 音乐服务器只知道标签里写了什么。成立于哪一年、来自哪个城市、当年是谁在乐队里、
 * 官网在哪——这些从来不在 ID3 里，但恰恰是「认识一个乐队」需要的东西。
 * MusicBrainz 是这类信息的公共来源，开放、可校验、没有商业推荐掺在里面。
 *
 * 两条必须讲清楚的纪律：
 *
 * 1. **默认关闭。** 请求 MusicBrainz 意味着把「你在看哪位歌手」告诉第三方。
 *    这台自托管服务器本来是为了不让任何人知道你在听什么，
 *    不能因为一个补充信息的功能把它破了。设置里说明白，由用户自己开。
 *
 * 2. **限速与缓存。** MusicBrainz 对匿名调用是每秒一次的软限制，
 *    而档案数据几乎不变。这里串行发请求、间隔不低于 1.1 秒，结果长期缓存。
 */

import { t } from '@/i18n'

const API_BASE = 'https://musicbrainz.org/ws/2'
/** MusicBrainz 的匿名限速是 1 req/s，留一点余量 */
const DEFAULT_MIN_INTERVAL_MS = 1_100
/**
 * 实际使用的最小间隔。
 *
 * 做成变量只为一件事：测试里把它设成 0。否则十几个用例每个都要真的睡一秒，
 * 一个纯逻辑的测试文件会跑十几秒——慢到没人愿意在改代码时顺手跑一遍的测试，
 * 等于没有测试。
 */
let minIntervalMs = DEFAULT_MIN_INTERVAL_MS
/** 档案数据几乎不变，缓存 30 天足够，也避免同一位歌手被反复查询 */
export const PROFILE_TTL_MS = 30 * 24 * 60 * 60 * 1000
const CACHE_KEY = 'msp-musicbrainz-cache'
/** 缓存条目上限：档案不大，但也不该无限长 */
const MAX_CACHED = 200

export interface ArtistProfile {
  mbid: string
  /** 「Group」「Person」等 */
  type?: string
  /** 成立 / 出生年份 */
  beginYear?: number
  /** 解散 / 逝世年份 */
  endYear?: number
  /** 来自哪里 */
  area?: string
  /** 更细的出生地 / 成立地 */
  beginArea?: string
  /** 乐队成员（含曾经的）*/
  members: Array<{ name: string; from?: number; to?: number }>
  /** 外部链接，只留几类明确有用的。存 key，渲染时才翻译。 */
  links: Array<{ labelKey: string; url: string }>
  fetchedAt: number
}

interface CacheShape { [mbid: string]: ArtistProfile }

function readCache(): CacheShape {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    return raw ? (JSON.parse(raw) as CacheShape) : {}
  } catch {
    return {}
  }
}

function writeCache(cache: CacheShape): void {
  try {
    const entries = Object.entries(cache)
    const bounded = entries.length <= MAX_CACHED
      ? cache
      : Object.fromEntries(
          entries.sort((a, b) => b[1].fetchedAt - a[1].fetchedAt).slice(0, MAX_CACHED)
        )
    localStorage.setItem(CACHE_KEY, JSON.stringify(bounded))
  } catch {
    // 配额满：档案是锦上添花，写不进去就算了
  }
}

/** 串行队列的尾巴。所有请求排在同一条链上，天然满足限速。 */
let queueTail: Promise<unknown> = Promise.resolve()
let lastRequestAt = 0

function schedule<T>(task: () => Promise<T>): Promise<T> {
  const run = queueTail.then(async () => {
    const wait = Math.max(0, minIntervalMs - (Date.now() - lastRequestAt))
    if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait))
    lastRequestAt = Date.now()
    return task()
  })
  // 队列不能被一次失败截断，因此尾巴永远接一个吞掉异常的分支
  queueTail = run.catch(() => undefined)
  return run
}

/**
 * 只留这几类链接：其余大多是数据库互链，对读者没有意义。
 * 值是文案 key 不是文案——档案会被缓存 30 天，存翻译好的字符串
 * 等于把语言一起腌进缓存里。
 */
const LINK_LABELS: Record<string, string> = {
  'official homepage': 'link.homepage',
  wikidata: 'link.wikidata',
  wikipedia: 'link.wikipedia',
  bandcamp: 'link.bandcamp',
  soundcloud: 'link.soundcloud',
  youtube: 'link.youtube',
  discogs: 'link.discogs',
}

function yearOf(value: unknown): number | undefined {
  const text = typeof value === 'string' ? value : ''
  const year = Number(text.slice(0, 4))
  return Number.isFinite(year) && year > 1000 ? year : undefined
}

interface MbRelation {
  type?: string
  direction?: string
  url?: { resource?: string }
  artist?: { name?: string }
  begin?: string
  end?: string
}

function mapProfile(mbid: string, data: Record<string, unknown>, now: number): ArtistProfile {
  const lifeSpan = (data['life-span'] ?? {}) as { begin?: string; end?: string }
  const relations = (data.relations ?? []) as MbRelation[]

  const members: ArtistProfile['members'] = []
  const links: ArtistProfile['links'] = []
  for (const relation of relations) {
    const type = relation.type?.toLowerCase()
    if (!type) continue
    if (type === 'member of band' && relation.artist?.name) {
      members.push({
        name: relation.artist.name,
        from: yearOf(relation.begin),
        to: yearOf(relation.end),
      })
      continue
    }
    const labelKey = LINK_LABELS[type]
    const url = relation.url?.resource
    if (labelKey && url && !links.some(link => link.labelKey === labelKey)) {
      links.push({ labelKey, url })
    }
  }

  return {
    mbid,
    type: typeof data.type === 'string' ? data.type : undefined,
    beginYear: yearOf(lifeSpan.begin),
    endYear: yearOf(lifeSpan.end),
    area: (data.area as { name?: string } | undefined)?.name,
    beginArea: (data['begin-area'] as { name?: string } | undefined)?.name,
    // 成员按加入时间排；没有年份的排在后面
    members: members.sort((a, b) => (a.from ?? 9999) - (b.from ?? 9999)).slice(0, 24),
    links,
    fetchedAt: now,
  }
}

/** MBID 形状固定，先挡一道再发请求——外部来的值不该直接拼进 URL */
const MBID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isValidMbid(value: string): boolean {
  return MBID_PATTERN.test(value.trim())
}

/**
 * 取一位歌手的档案。
 *
 * 命中未过期的缓存就直接返回，不发请求；失败返回 null 而不是抛错——
 * 这是补充信息，拿不到就不显示，不该让歌手页跟着报错。
 */
export async function fetchArtistProfile(
  mbid: string,
  options: { signal?: AbortSignal; now?: number } = {}
): Promise<ArtistProfile | null> {
  if (!isValidMbid(mbid)) return null
  const now = options.now ?? Date.now()

  const cache = readCache()
  const cached = cache[mbid]
  if (cached && now - cached.fetchedAt < PROFILE_TTL_MS) return cached

  try {
    const url = `${API_BASE}/artist/${encodeURIComponent(mbid)}`
      + '?inc=url-rels+artist-rels&fmt=json'
    const response = await schedule(() => fetch(url, {
      signal: options.signal,
      headers: { Accept: 'application/json' },
    }))
    if (!response.ok) return cached ?? null
    const data = await response.json() as Record<string, unknown>
    const profile = mapProfile(mbid, data, now)
    writeCache({ ...cache, [mbid]: profile })
    return profile
  } catch {
    // 网络失败 / 被取消：有旧缓存就先用旧的，没有就当作没有档案
    return cached ?? null
  }
}

/** 仅供测试：把限速间隔调成 0，别让纯逻辑用例真的去睡 */
export function setMinRequestIntervalForTests(ms: number): void {
  minIntervalMs = ms
}

/** 供设置页「清除已缓存的档案」用 */
export function clearProfileCache(): void {
  try {
    localStorage.removeItem(CACHE_KEY)
  } catch {
    // 清不掉也无所谓，条目会自然过期
  }
}
