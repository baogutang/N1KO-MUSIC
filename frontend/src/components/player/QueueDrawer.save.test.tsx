/**
 * @vitest-environment happy-dom
 *
 * 复核 F7 回归：队列「存为歌单」按主库能力分流。
 * 用户路径：队列里是外源歌 / 主库不可写 → 点「存为歌单」→ 起名 → 保存 →
 * 全部落本地混合歌单，且 toast 说明去处；不再把整队 id 发给一个
 * 没有歌单写入能力的主库。
 */
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const { serverCreatePlaylist, createLocal, toast } = vi.hoisted(() => ({
  serverCreatePlaylist: vi.fn(async () => ({})),
  createLocal: vi.fn(async () => ({ id: 'lp1', name: 'x', items: [], createdAt: 0 })),
  toast: vi.fn(),
}))

const { adapter } = vi.hoisted(() => ({ adapter: { as: 'mutable' } as unknown as Record<string, unknown> }))

vi.mock('@/api', () => ({
  createAdapter: vi.fn(),
  getAdapter: vi.fn(() => adapter),
  getAdapterFor: vi.fn(() => adapter),
  hasAdapter: vi.fn(() => true),
  hasAdapterFor: vi.fn(() => true),
  findAdapterFor: vi.fn(() => null),
  adapterForSource: vi.fn(() => adapter),
  setPrimary: vi.fn(),
  listAdapters: vi.fn(() => []),
}))

vi.mock('@/store/localPlaylistStore', () => ({
  useLocalPlaylistStore: Object.assign(
    vi.fn((selector?: (s: unknown) => unknown) => (selector ? selector({ create: createLocal }) : { create: createLocal })),
    { getState: () => ({ create: createLocal }) }
  ),
}))

vi.mock('@/components/ui/use-toast', () => ({ toast }))

import { QueueDrawer } from './QueueDrawer'
import { usePlayerStore } from '@/store/playerStore'
import { useServerStore } from '@/store/serverStore'
import type { Song } from '@/api/types'

const song = (id: string, serverId: string): Song => ({
  id, title: `歌${id}`, artist: '歌手', serverId, duration: 100, album: '', albumId: '',
})

let root: Root | null = null
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
})

function mountDrawer(queue: Song[]) {
  usePlayerStore.setState({
    queue, queueIndex: 0, isPlaying: false,
    isQueueOpen: true, currentSong: queue[0], shuffle: false, shuffledIndexes: [],
  } as never)
  const host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => {
    root!.render(
      <QueryClientProvider client={queryClient}>
        <QueueDrawer />
      </QueryClientProvider>
    )
  })
}

beforeEach(() => {
  useServerStore.setState({
    activeServerId: 'nas',
    connectedServerIds: ['nas', 'wy'],
    isConnected: true,
    servers: [
      { id: 'nas', name: 'NAS', type: 'subsonic' },
      { id: 'wy', name: '网易云', type: 'plugin', pluginId: 'netease' } as never,
    ],
  } as never)
})
afterEach(() => {
  act(() => { root?.unmount() })
  root = null
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

async function flush(times = 6) {
  for (let i = 0; i < times; i++) {
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
  }
}

/** 用户点「存为歌单」→ 输入名字 → 点保存 */
async function saveAs(name: string) {
  const entry = [...document.querySelectorAll('button')]
    .find(b => /存为歌单|Save as playlist/i.test(b.textContent ?? ''))
  expect(entry, '有「存为歌单」入口').toBeTruthy()
  act(() => { entry!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await flush(2)

  const input = document.querySelector('input[aria-label]') as HTMLInputElement
  expect(input, '命名输入框').toBeTruthy()
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  setter.call(input, name)
  act(() => { input.dispatchEvent(new Event('input', { bubbles: true }) as never) })
  await flush(2)

  const save = [...document.querySelectorAll('button')].find(b => /^保存$|^Save$/i.test((b.textContent ?? '').trim()))
  expect(save, '保存键可点').toBeTruthy()
  expect((save as HTMLButtonElement).disabled).toBe(false)
  act(() => { save!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await flush()
}

describe('队列存为歌单按 caps 分流（F7）', () => {
  it('主库不可写（无 createPlaylist 方法）：全部落本地，不发服务端', { timeout: 20_000 }, async () => {
    adapter.getStreamUrl = vi.fn()
    delete adapter.createPlaylist
    mountDrawer([song('a', 'nas'), song('b', 'wy')])

    await saveAs('我的队列')

    expect(serverCreatePlaylist, '不向主库发歌单写入').not.toHaveBeenCalled()
    expect(createLocal).toHaveBeenCalledTimes(1)
    const [name, songs] = createLocal.mock.calls[0] as [string, Song[]]
    expect(name).toBe('我的队列')
    expect(songs.map(s => s.id), '主库歌与外源歌都落本地').toEqual(['a', 'b'])
    // toast 说明了去处（不是只说「已保存」）
    expect(toast).toHaveBeenCalledTimes(1)
    expect(toast.mock.calls[0][0].description).toMatch(/2|two/i)
  })

  it('主库可写：主库歌进服务端、外源歌落本地，各自计数', { timeout: 20_000 }, async () => {
    adapter.createPlaylist = serverCreatePlaylist
    adapter.getStreamUrl = vi.fn()
    mountDrawer([song('a', 'nas'), song('b', 'wy')])

    await saveAs('混合队列')

    expect(serverCreatePlaylist).toHaveBeenCalledTimes(1)
    expect(createLocal).toHaveBeenCalledTimes(1)
    const [, localSongs] = createLocal.mock.calls[0] as [string, Song[]]
    expect(localSongs.map(s => s.id)).toEqual(['b'])
  })
})
