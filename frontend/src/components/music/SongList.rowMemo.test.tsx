/**
 * @vitest-environment happy-dom
 *
 * 歌单详情页传 onRemove 时，行回调引用必须稳定：切歌只该重渲染前后两行，
 * 而不是所有可见行（此前 `() => onRemove(index)` 每次渲染都是新函数，memo 失效）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Song } from '@/api/types'

const { durationCalls } = vi.hoisted(() => ({ durationCalls: [] as number[] }))
// 每行渲染一次就会调一次 formatDuration，以曲目时长（唯一）计每行渲染数
vi.mock('@/utils/formatters', async importOriginal => {
  const real = await importOriginal<typeof import('@/utils/formatters')>()
  return { ...real, formatDuration: (d: number) => { durationCalls.push(d); return real.formatDuration(d) } }
})
vi.mock('@/hooks/useSourceQueries', async importOriginal => ({
  ...(await importOriginal<typeof import('@/hooks/useSourceQueries')>()),
  useSourceCapabilities: vi.fn(() => ({})),
}))

import { SongList } from './SongList'
import { usePlayerStore } from '@/store/playerStore'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let host: HTMLDivElement
afterEach(() => { act(() => root?.unmount()); root = null; host?.remove(); durationCalls.length = 0 })

const songs: Song[] = Array.from({ length: 5 }, (_, i) => (
  { id: `s${i}`, title: `歌${i}`, artist: 'A', album: 'AL', serverId: 'nas', duration: 100 + i } as Song
))

function mount(onRemove: (i: number) => void) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  const el = (
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter><SongList songs={songs} onRemove={onRemove} selectable={false} /></MemoryRouter>
    </QueryClientProvider>
  )
  act(() => { root!.render(el) })
}

describe('SongList 行 memo', () => {
  it('切歌只重渲染前后两行，不牵连无关行', () => {
    mount(vi.fn())
    durationCalls.length = 0
    act(() => { usePlayerStore.setState({ currentSong: songs[0] }) })
    // 100 是 s0 自己（唯一该重渲染的），其余行不该被重渲染
    const rerendered = new Set(durationCalls)
    expect([...rerendered].every(d => d === 100)).toBe(true)
    expect(rerendered.has(103)).toBe(false)
  })

  it('点某一行的「移除」回调的是这一行的 index', async () => {
    const onRemove = vi.fn()
    mount(onRemove)
    const triggers = host.querySelectorAll<HTMLElement>('[aria-haspopup="menu"]')
    expect(triggers.length).toBe(5)
    await act(async () => {
      triggers[3].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }))
    })
    const item = [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')]
      .find(el => el.textContent?.includes('移除') || el.textContent?.toLowerCase().includes('remove'))
    expect(item).toBeTruthy()
    await act(async () => { item!.click() })
    expect(onRemove).toHaveBeenCalledWith(3)
  })
})
