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

/** 这台电台是否可用：种子所属音源（缺省任一已连接音源）实现了对应可选能力 */
export function canStartRadio(seed: RadioSeed): boolean {
  const pick = (serverId?: string) => {
    if (serverId && hasAdapterFor(serverId)) return getAdapterFor(serverId)
    return null
  }
  const candidates = [pick(seed.serverId), ...(hasAdapter() ? [getAdapter()] : [])]
  if (seed.kind === 'song') return candidates.some(a => !!a?.getSimilarSongs)
  if (seed.kind === 'artist') return candidates.some(a => !!a?.getArtistSongs)
  return candidates.some(a => !!a?.getGenreSongs)
}

/** 种子所属音源的适配器：种子带 serverId 就按它解析，否则回落主库（旧调用方） */
function seedAdapter(seed: RadioSeed) {
  if (seed.serverId && hasAdapterFor(seed.serverId)) return getAdapterFor(seed.serverId)
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
 */
function rankForRadio(candidates: Song[], exclude: Set<string>, size: number, serverId?: string): Song[] {
  const key = (s: Song) => `${s.serverId}:${s.id}`
  const fresh = candidates.filter(s => s?.id && !exclude.has(key(s)))
  if (!fresh.length) return []
  const events = serverId ? readListeningEvents(serverId) : []
  const profile = buildRecommendationProfile(events)
  return recommendSongs(
    // serverId 现在必填：候选自带来源；显式传入时（主库电台）覆盖之
    serverId ? fresh.map(s => ({ ...s, serverId })) : fresh,
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

/** 从种子起播一台电台 */
export async function startRadio(seed: RadioSeed, serverId?: string): Promise<boolean> {
  const candidates = await fetchSeedCandidates(seed)
  if (!candidates.length) return false
  const ranked = rankForRadio(candidates, new Set(), APPEND_SIZE * 2, serverId)
  const queue = ranked.length ? ranked : candidates
  usePlayerStore.getState().playQueue(queue, 0, 'sequential')
  return true
}

/**
 * 队列快见底时补给。
 * 种子取当前曲，这样电台会随着播放内容缓慢漂移，而不是死守最初那一首。
 */
export async function refillRadio(serverId?: string): Promise<number> {
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

  const next = rankForRadio(candidates, exclude, APPEND_SIZE, serverId)
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
