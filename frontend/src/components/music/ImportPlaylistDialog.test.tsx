/**
 * @vitest-environment happy-dom
 *
 * 复核 F3 回归：导入歌单对话框的两个丢数据路径。
 * 用户路径：选一个 m3u 文件 → 全部音源搜一遍 → review → 点导入。
 * - 「只命中外源」：主库一首没中、网易云中了两首 → 确认键可点，
 *   外源歌真的进本地混合歌单（旧代码整批丢失）。
 * - 「全未匹配」：哪里都没中 → 确认键可点，本地单里真的有那两条
 *   占位（旧代码 serverId:'' 被 toEntries 过滤，建出空单）。
 */
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const { searchAll, createLocal, getAdapter } = vi.hoisted(() => ({
  searchAll: vi.fn(),
  createLocal: vi.fn(async () => ({ id: 'lp1', name: 'x', items: [], createdAt: 0 })),
  getAdapter: vi.fn(() => ({ createPlaylist: vi.fn() })),
}))

vi.mock('@/api', () => ({
  createAdapter: vi.fn(),
  getAdapter,
  getAdapterFor: vi.fn(() => ({ searchAll })),
  hasAdapter: vi.fn(() => true),
  hasAdapterFor: vi.fn(() => true),
  findAdapterFor: vi.fn(() => null),
  adapterForSource: vi.fn(),
  setPrimary: vi.fn(),
  listAdapters: vi.fn(() => []),
}))

vi.mock('@/store/localPlaylistStore', () => ({
  useLocalPlaylistStore: Object.assign(
    vi.fn((selector?: (s: unknown) => unknown) => (selector ? selector({ create: createLocal }) : { create: createLocal })),
    { getState: () => ({ create: createLocal }) }
  ),
}))

import { ImportPlaylistDialog } from './ImportPlaylistDialog'
import { useServerStore } from '@/store/serverStore'
import type { Song } from '@/api/types'

const wySong = (id: string, title: string): Song => ({
  id, title, artist: '歌手', serverId: 'wy', duration: 200, album: '', albumId: '',
})

let root: Root | null = null
let queryClient: QueryClient

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
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => {
    root!.render(
      <QueryClientProvider client={queryClient}>
        <ImportPlaylistDialog open onOpenChange={() => undefined} />
      </QueryClientProvider>
    )
  })
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

/** 用户选文件：往 file input 上塞一个 m3u 并触发 change */
function pickFile(text: string) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement
  expect(input, '有文件入口').toBeTruthy()
  const file = new File([text], 'list.m3u', { type: 'audio/xmpegurl' })
  Object.defineProperty(input, 'files', { value: [file], configurable: true })
  act(() => { input.dispatchEvent(new Event('change', { bubbles: true })) })
}

function confirmButton(): HTMLButtonElement {
  return [...document.querySelectorAll('button')]
    .find(b => /创建歌单|Create playlist/i.test(b.textContent ?? '')) as HTMLButtonElement
}

describe('导入歌单对话框（F3）', () => {
  it('只命中外源：确认键可点，外源歌进本地混合歌单', async () => {
    // NAS 搜不到；网易云命中两首
    searchAll.mockImplementation(async () => ({ songs: [] }))
    let wyTurn = false
    const { getAdapterFor } = await import('@/api')
    ;(getAdapterFor as ReturnType<typeof vi.fn>).mockImplementation((id: string) =>
      id === 'wy' && !wyTurn
        ? (wyTurn = true, { searchAll: async () => ({ songs: [wySong('w1', '晴天'), wySong('w2', '七里香')] }) })
        : { searchAll }
    )

    pickFile('#EXTM3U\n#EXTINF:200,歌手 - 晴天\n晴天.mp3\n#EXTINF:200,歌手 - 七里香\n七里香.mp3\n')
    await flush()

    const btn = confirmButton()
    expect(btn, 'review 步有确认键').toBeTruthy()
    expect(btn.disabled, '只命中外源时确认键不再灰掉').toBe(false)

    act(() => { btn.click() })
    await flush()

    expect(createLocal, '外源歌进本地混合歌单').toHaveBeenCalledTimes(1)
    const [, songs] = createLocal.mock.calls[0] as [string, Song[]]
    expect(songs.map(s => s.title)).toEqual(['晴天', '七里香'])
    expect(getAdapter, '没有主库命中时不建服务端歌单').not.toHaveBeenCalled()
  })

  it('全未匹配：确认键可点，本地单含占位条目（不被 toEntries 清空）', async () => {
    searchAll.mockImplementation(async () => ({ songs: [] }))

    pickFile('#EXTM3U\n#EXTINF:200,A - Foo\nfoo.mp3\n#EXTINF:180,B - Bar\nbar.mp3\n')
    await flush()

    const btn = confirmButton()
    expect(btn.disabled, '全未匹配时确认键可点（建本地单）').toBe(false)

    act(() => { btn.click() })
    await flush()

    expect(createLocal).toHaveBeenCalledTimes(1)
    const [, songs] = createLocal.mock.calls[0] as [string, Song[]]
    expect(songs, '两条占位都在').toHaveLength(2)
    expect(songs.every(s => s.serverId === 'local'), '占位带哨兵 serverId，能活过 toEntries').toBe(true)
    expect(songs.map(s => s.title)).toEqual(['Foo', 'Bar'])
  })
})
