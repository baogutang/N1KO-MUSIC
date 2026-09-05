/**
 * 电台：从一首歌 / 一位歌手 / 一个流派起播，队列播完自动续上相似曲目。
 *
 * 这不是新建能力，而是把已经存在的东西接上播放路径：
 * getArtistSongs / getGenreSongs / getSimilarSongs 三个方法在两个 adapter 上
 * 都已实现（Emby 继承自 Jellyfin），但此前只有离线推荐引擎在用，
 * 播放侧根本够不着——队列播完就是停。
 */

import { getAdapter, getAdapterFor, hasAdapter, hasAdapterFor } from '@/api'
import { usePlayerStore } from '@/store/playerStore'
import { readListeningEvents } from '@/services/listeningHistory'
import { readMutedSets } from '@/store/tasteStore'
import { buildRecommendationProfile, recommendSongs } from '@/services/recommendationEngine'
import type { Song } from '@/api/types'

export type RadioSeed =
  | { kind: 'song'; id: string; name?: string; serverId?: string }
  | { kind: 'artist'; id?: string; name: string; serverId?: string }
  | { kind: 'genre'; name: string; serverId?: string }

/** 一次补给拉多少候选 */
const FETCH_SIZE = 60
/** 每次往队列里追加多少首 */
const APPEND_SIZE = 20
/** 未播曲目少于这个数就补给 */
export const REFILL_THRESHOLD = 8

/**
 * 这台电台是否可用：**只看种子自己那个音源**。
 *
 * 此前这里把主库也算进候选，于是「主库支持相似曲目」就足以让网易云那首歌
 * 的电台入口亮起来——回答的是「有没有某个源能起电台」，而用户问的是
 * 「这首歌能不能起」。真点下去 fetchSeedCandidates 只问种子那个源，空手而归。
 */
export function canStartRadio(seed: RadioSeed): boolean {
  const adapter = seedAdapter(seed)
  if (!adapter) return false
  if (seed.kind === 'song') return !!adapter.getSimilarSongs
  if (seed.kind === 'artist') return !!adapter.getArtistSongs
  return !!adapter.getGenreSongs
}

/**
 * 种子所属音源的适配器。
 *
 * 种子没带 serverId 才回落主库（旧的单源调用方，那时候「主库」就是唯一的源）；
 * 带了 serverId 但那个源已经断开时返回 null——拿主库去续一台别人的电台，
 * 放出来的是另一个库的歌，比停下来更让人困惑。
 */
function seedAdapter(seed: RadioSeed) {
  if (seed.serverId) return hasAdapterFor(seed.serverId) ? getAdapterFor(seed.serverId) : null
  return hasAdapter() ? getAdapter() : null
}

async function fetchSeedCandidates(seed: RadioSeed): Promise<Song[]> {
  const adapter = seedAdapter(seed)
  if (!adapter) return []
  try {
    if (seed.kind === 'song' && adapter.getSimilarSongs) {
      return await adapter.getSimilarSongs(seed.id, FETCH_SIZE)
    }
    if (seed.kind === 'artist' && adapter.getArtistSongs) {
      return await adapter.getArtistSongs({ id: seed.id, name: seed.name }, FETCH_SIZE)
    }
    if (seed.kind === 'genre' && adapter.getGenreSongs) {
      return await adapter.getGenreSongs(seed.name, FETCH_SIZE)
    }
  } catch {
    // 老服务器可能没实现这些接口，静默返回空由调用方降级
  }
  return []
}

/**
 * 按当前队列去重后排序候选。
 * 复用推荐引擎的打分与多样性重排，避免电台连着放同一位歌手。
 *
 * `fallbackServerId` **只是兜底**：候选自己没带来源时才补上它。
 * 此前这里是无条件覆盖，于是主库是 NAS 时，网易云那首歌续上来的候选
 * 全被打成 NAS 的 serverId 塞进队列——播到它时播放引擎拿 NAS 的适配器
 * 去取一个网易云的 id，必然失败，而队列里看起来一切正常。
 */
function rankForRadio(
  candidates: Song[],
  exclude: Set<string>,
  size: number,
  fallbackServerId?: string
): Song[] {
  const key = (s: Song) => `${s.serverId}:${s.id}`
  const fresh = candidates.filter(s => s?.id && !exclude.has(key(s)))
  if (!fresh.length) return []
  const events = fallbackServerId ? readListeningEvents(fallbackServerId) : []
  const profile = buildRecommendationProfile(events)
  return recommendSongs(
    fallbackServerId
      ? fresh.map(s => (s.serverId ? s : { ...s, serverId: fallbackServerId }))
      : fresh,
    events,
    Math.min(size, fresh.length),
    `radio:${Date.now()}`,
    Date.now(),
    profile,
    undefined,
    // 电台同样尊重「不再推荐」：那是一句关于口味的话，不是关于某个入口的
    readMutedSets()
  )
}

/**
 * 从种子起播一台电台。
 * `serverId` 只作候选缺来源时的兜底（旧的单源调用方），不会覆盖候选自带的来源。
 */
export async function startRadio(seed: RadioSeed, serverId?: string): Promise<boolean> {
  const candidates = await fetchSeedCandidates(seed)
  if (!candidates.length) return false
  const ranked = rankForRadio(candidates, new Set(), APPEND_SIZE * 2, serverId ?? seed.serverId)
  const queue = ranked.length ? ranked : candidates
  usePlayerStore.getState().playQueue(queue, 0, 'sequential')
  return true
}

/**
 * 队列快见底时补给。
 * 种子取当前曲，这样电台会随着播放内容缓慢漂移，而不是死守最初那一首。
 *
 * 兜底来源取**当前曲自己的源**，而不是主库：候选就是问那个源要来的，
 * 拿主库 id 去兜底等于给外源候选贴错标签（调用方此前传的正是主库 id）。
 */
export async function refillRadio(): Promise<number> {
  const st = usePlayerStore.getState()
  const current = st.currentSong
  if (!current) return 0

  const exclude = new Set(st.queue.map(s => `${s.serverId}:${s.id}`))
  let candidates = await fetchSeedCandidates({ kind: 'song', id: current.id, serverId: current.serverId })
  if (!candidates.length && current.artist) {
    candidates = await fetchSeedCandidates({
      kind: 'artist', id: current.artistId, name: current.artist, serverId: current.serverId,
    })
  }
  if (!candidates.length && current.genre) {
    candidates = await fetchSeedCandidates({ kind: 'genre', name: current.genre, serverId: current.serverId })
  }
  if (!candidates.length) return 0

  const next = rankForRadio(candidates, exclude, APPEND_SIZE, current.serverId)
  if (!next.length) return 0
  usePlayerStore.getState().addToQueue(next, 'last')
  return next.length
}

/** 当前队列里还有多少首没播过 */
export function remainingUnplayed(state = usePlayerStore.getState()): number {
  const { queue, queueIndex, shuffle, shuffledIndexes, shuffleCursor } = state
  if (!queue.length) return 0
  if (shuffle && shuffledIndexes.length === queue.length) {
    const cursor =
      shuffleCursor >= 0 && shuffledIndexes[shuffleCursor] === queueIndex
        ? shuffleCursor
        : shuffledIndexes.indexOf(queueIndex)
    return Math.max(0, shuffledIndexes.length - cursor - 1)
  }
  return Math.max(0, queue.length - queueIndex - 1)
}
