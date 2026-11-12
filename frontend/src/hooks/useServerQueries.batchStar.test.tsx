/**
 * @vitest-environment happy-dom
 *
 * 批量收藏：网络限并发、结果一次性落缓存（失效按来源而不是按歌曲），部分失败如实返回。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Song } from '@/api/types'

const { adapters } = vi.hoisted(() => ({ adapters: {} as Record<string, { star: ReturnType<typeof vi.fn> }> }))
vi.mock('@/api', async importOriginal => ({
  ...(await importOriginal<typeof import('@/api')>()),
  adapterForSource: (id?: string) => adapters[id ?? 'nas'],
  getAdapter: () => adapters.nas,
}))
vi.mock('@/services/historySync', () => ({ mirrorFavorite: vi.fn() }))

import { useBatchStar, BATCH_STAR_CONCURRENCY } from './useServerQueries'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
afterEach(() => { act(() => root?.unmount()); root = null })

const song = (i: number, serverId = 'nas'): Song =>
  ({ id: `s${i}`, title: `t${i}`, artist: 'A', album: 'AL', serverId, duration: 1 }) as Song

function setup() {
  const client = new QueryClient()
  const result = { current: undefined as unknown as ReturnType<typeof useBatchStar> }
  function Probe() { result.current = useBatchStar(); return null }
  root = createRoot(document.createElement('div'))
  act(() => { root!.render(<QueryClientProvider client={client}><Probe /></QueryClientProvider>) })
  return { client, result }
}

describe('useBatchStar', () => {
  it('限并发，且失效 / 补丁次数只随来源数增长', async () => {
    let inflight = 0, peak = 0
    const star = vi.fn(async () => {
      inflight++; peak = Math.max(peak, inflight)
      await new Promise(r => setTimeout(r, 2))
      inflight--
    })
    adapters.nas = { star }
    adapters.nd = { star }
    const { client, result } = setup()
    client.setQueryData(['nas', 'songs'], [song(0), song(1)])
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const setQueries = vi.spyOn(client, 'setQueriesData')
    const songs = [...Array.from({ length: 30 }, (_, i) => song(i)), ...Array.from({ length: 30 }, (_, i) => song(100 + i, 'nd'))]

    let res!: Awaited<ReturnType<typeof result.current.mutateAsync>>
    await act(async () => { res = await result.current.mutateAsync({ songs }) })

    expect(star).toHaveBeenCalledTimes(60)
    expect(peak).toBeLessThanOrEqual(BATCH_STAR_CONCURRENCY)
    expect(res.succeeded).toHaveLength(60)
    // 2 个来源：每源 6 次失效、1 次缓存扫描，与 60 首无关
    expect(invalidate).toHaveBeenCalledTimes(12)
    expect(setQueries).toHaveBeenCalledTimes(2)
    expect((client.getQueryData(['nas', 'songs']) as Song[]).every(s => s.starred)).toBe(true)
  })

  it('部分失败：成功的被标记，失败的没有', async () => {
    adapters.nas = { star: vi.fn(async (id: string) => { if (id === 's1') throw new Error('boom') }) }
    const { client, result } = setup()
    client.setQueryData(['nas', 'songs'], [song(0), song(1)])
    let res!: Awaited<ReturnType<typeof result.current.mutateAsync>>
    await act(async () => { res = await result.current.mutateAsync({ songs: [song(0), song(1)] }) })
    expect(res.succeeded.map(s => s.id)).toEqual(['s0'])
    expect(res.failed.map(s => s.id)).toEqual(['s1'])
    const cached = client.getQueryData(['nas', 'songs']) as Song[]
    expect(cached[0].starred).toBe(true)
    expect(cached[1].starred).toBeFalsy()
  })
})
