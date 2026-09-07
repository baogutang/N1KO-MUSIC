/** Audit reproduction probes. Assertions describe current defects, not acceptance criteria.
 * All adapters and media are isolated mocks; no user accounts or network are accessed.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const registry = vi.hoisted(() => new Map<string, any>())
vi.mock('@/api', () => ({
  getAdapter: () => registry.get('nas'),
  getAdapterFor: (id: string) => { if (!registry.has(id)) throw new Error('missing adapter'); return registry.get(id) },
  findAdapterFor: (id: string) => registry.get(id),
  hasAdapter: () => registry.has('nas'),
  hasAdapterFor: (id: string) => registry.has(id),
}))
vi.mock('@/services/historySync', () => ({ mirrorFavorite: vi.fn(async () => {}) }))
vi.mock('@/components/ui/use-toast', () => ({ toast: vi.fn() }))
vi.mock('@/lib/network', () => ({ isMeteredConnection: () => false, onConnectionChange: () => () => {} }))

import { parseLrcText } from '@/api/adapters/subsonic'
import { parseLrc } from '@/hooks/useLyrics'
import { interleaveRecommendations, useTopListDetail } from '@/hooks/useSourceQueries'
import { buildRecommendationProfile, deriveRecommendationSeeds } from '@/services/recommendationEngine'
import { useToggleStar } from '@/hooks/useServerQueries'
import { useAudioEngine } from '@/hooks/useAudioEngine'
import { usePersonalizedRecommendations } from '@/hooks/usePersonalizedRecommendations'
import { useTasteStore } from '@/store/tasteStore'
import { usePlayerStore } from '@/store/playerStore'
import { useServerStore } from '@/store/serverStore'
import { useSettingsStore } from '@/store/settingsStore'
import type { Song } from '@/api/types'

const makeSong = (id: string, serverId = 'nas', title = id): Song => ({ id, serverId, title, artist: 'Singer', album: 'Album', duration: 180 }) as Song
let root: Root | undefined
let client: QueryClient | undefined
const tick = () => new Promise(resolve => setTimeout(resolve, 30))
async function mount(probe: () => unknown) {
  const el = document.createElement('div'); document.body.append(el)
  root = createRoot(el)
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } })
  function Probe() { probe(); return null }
  await act(async () => { root!.render(React.createElement(QueryClientProvider, { client: client! }, React.createElement(Probe))); await tick() })
}

beforeEach(async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  registry.clear()
  localStorage.clear()
  useTasteStore.setState({ mutedArtists: [], mutedGenres: [] })
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  await tick()
  useServerStore.setState({ activeServerId: 'nas', isConnected: true, startupConnectSettled: true, connectedServerIds: ['nas', 'qq'], servers: [
    { id: 'nas', name: 'NAS fixture', type: 'navidrome', url: 'https://example.invalid' },
    { id: 'qq', name: 'QQ fixture', type: 'plugin', pluginId: 'qqmusic' },
  ] } as any)
  useSettingsStore.setState({ audioQuality: 'high', preloadNext: false, smoothTransitions: false, replayGainMode: 'off' })
  usePlayerStore.setState({ currentSong: null, queue: [], queueIndex: -1, isPlaying: false, shuffle: false })
})
afterEach(async () => {
  if (root) await act(async () => root!.unmount())
  root = undefined; client?.clear(); client = undefined
  document.body.innerHTML = ''; vi.restoreAllMocks()
})

it('reproduces: adapter parser turns whole-second LRC into unsynced timestamp text', () => {
  expect(parseLrcText('[00:12]fixture line')).toEqual([{ time: 0, text: '[00:12]fixture line' }])
  expect(parseLrc('[00:12]fixture line')).toEqual([{ time: 12000, text: '[00:12]fixture line' }])
})

it('reproduces: NetEase JSON credit metadata is rendered as a lyric line', () => {
  const raw = '{"t":0,"c":[{"tx":"作词: "},{"tx":"Fixture"}]}\n[00:01.00]fixture line'
  expect(parseLrcText(raw)[0].text).toBe(raw.split('\n')[0])
})

it('reproduces: daily mix dedup drops distinct Live recording without checking duration', () => {
  const studio = { ...makeSong('studio'), title: 'Test song', duration: 180 }
  const live = { ...makeSong('live', 'qq'), title: 'Test song (Live)', duration: 320 }
  expect(interleaveRecommendations([{ songs: [studio] }, { songs: [live] }], 20)).toEqual([studio])
})

it('reproduces: directed song seeds lose their source namespace', () => {
  const event = { version: 2, eventId: 'fixture', serverId: 'qq', song: makeSong('qq-only-id', 'qq'), startedAt: Date.now()-180000, endedAt: Date.now(), listenedSeconds: 180, completionRate: 1, outcome: 'completed' } as any
  const seeds = deriveRecommendationSeeds(buildRecommendationProfile([event]), [event])
  expect(seeds.songIds).toEqual(['qq-only-id'])
  expect(seeds).not.toHaveProperty('serverId')
})

it('reproduces: favorite on disconnected source writes its ID to the primary NAS adapter', async () => {
  const star = vi.fn(async () => {})
  registry.set('nas', { star })
  let mutation: ReturnType<typeof useToggleStar>
  await mount(() => { mutation = useToggleStar() })
  await act(async () => { await mutation!.mutateAsync({ id: 'foreign-id', type: 'song', isStarred: false, song: makeSong('foreign-id', 'disconnected') }) })
  expect(star).toHaveBeenCalledWith('foreign-id', 'song')
})

it('reproduces: toplist drops isEnd=false and never loads the remaining page', async () => {
  const first = [makeSong('first')]
  const getTopListDetail = vi.fn(async () => ({ songs: first, isEnd: false }))
  registry.set('nas', { getTopListDetail })
  let result: ReturnType<typeof useTopListDetail>
  await mount(() => { result = useTopListDetail('nas', 'chart') })
  await act(async () => { await tick() })
  expect(result!.data).toEqual(first)
  expect(getTopListDetail).toHaveBeenCalledTimes(1)
  expect(getTopListDetail).toHaveBeenCalledWith('chart', 0)
})

it('reproduces: cached recommendations bypass a newly muted artist even after remount', async () => {
  registry.set('nas', { getRandomSongs: async () => [makeSong('cached')], getStarred: async () => ({ songs: [] }) })
  let result: ReturnType<typeof usePersonalizedRecommendations>
  await mount(() => { result = usePersonalizedRecommendations(20) })
  await act(async () => { await tick() })
  expect(result!.data?.map(s => s.id)).toContain('cached')
  await act(async () => root!.unmount()); root = undefined; client!.clear()
  useTasteStore.getState().toggleArtist('singer')
  await mount(() => { result = usePersonalizedRecommendations(20) })
  await act(async () => { await tick() })
  expect(result!.data?.map(s => s.id)).toContain('cached')
})

it('reproduces: non-VIP account receives a VIP favorite via local recommendation pool', async () => {
  const vip = { ...makeSong('vip-track', 'netease'), vip: true }
  registry.set('nas', { getRandomSongs: async () => [], getStarred: async () => ({ songs: [] }) })
  registry.set('netease', { getRandomSongs: async () => [], getStarred: async () => ({ songs: [vip] }) })
  useServerStore.setState({ connectedServerIds: ['nas', 'netease'], servers: [
    { id: 'nas', name: 'NAS', type: 'navidrome' },
    { id: 'netease', name: 'NetEase fixture', type: 'plugin', pluginId: 'netease', accountVip: false },
  ] } as any)
  let result: ReturnType<typeof usePersonalizedRecommendations>
  await mount(() => { result = usePersonalizedRecommendations(20) })
  await act(async () => { await tick() })
  expect(result!.data).toContainEqual(vip)
})

it('reproduces: late failure of track A replaces manually selected track B with fallback A', async () => {
  let rejectA!: (error: Error) => void
  const deferredA = new Promise<any>((_, reject) => { rejectA = reject })
  const a = makeSong('A', 'qq', 'Track A')
  const b = makeSong('B', 'nas', 'Track B')
  const altA = makeSong('A-on-NAS', 'nas', 'Track A')
  registry.set('qq', { resolveStreamUrl: vi.fn(() => deferredA) })
  registry.set('nas', {
    getStreamUrl: vi.fn(() => 'data:audio/wav;base64,fixture'),
    searchAll: vi.fn(async () => ({ songs: [altA], albums: [], artists: [] })),
  })
  await mount(() => useAudioEngine())
  await act(async () => { usePlayerStore.getState().playQueue([a, b], 0, 'sequential'); await tick() })
  expect(registry.get('qq').resolveStreamUrl).toHaveBeenCalled()
  await act(async () => { usePlayerStore.getState().playQueue([b], 0, 'sequential'); await tick() })
  expect(usePlayerStore.getState().currentSong?.id).toBe('B')
  await act(async () => { rejectA(Object.assign(new Error('fixture denied'), { code: 'forbidden' })); await tick() })
  expect(usePlayerStore.getState().currentSong?.id).toBe('A-on-NAS')
})
