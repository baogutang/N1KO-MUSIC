/**
 * @vitest-environment happy-dom
 *
 * 远程封面 / 歌词接口（自定义 API）与歌词 query 的失败语义，以及模板占位符。
 *
 * 要钉住的是两件会「悄悄留下坏缓存」的事：
 * - 429 / 5xx / 断网被当成「没有」缓存（封面整个会话、歌词 30 分钟）；
 * - 模板里 `{album}` 遇到空专辑原样发给服务器，拿回的错误封面被永久缓存。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const { getLyrics } = vi.hoisted(() => ({ getLyrics: vi.fn() }))
vi.mock('@/api', async importOriginal => {
  const real = await importOriginal<typeof import('@/api')>()
  return { ...real, adapterForSource: () => ({ getLyrics }), getAdapter: () => ({ getLyrics }) }
})

import { buildCoverUrl, buildLyricsUrl, useCustomCoverUrl, useLyricsQuery } from './useServerQueries'
import { useSettingsStore } from '@/store/settingsStore'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let client: QueryClient
let fetchMock: ReturnType<typeof vi.fn>

/** 渲染一个只调用 hook 的探针组件，result.current 始终是最新返回值 */
function renderHook<T>(use: () => T) {
  const result = { current: undefined as T }
  function Probe() {
    result.current = use()
    return null
  }
  const host = document.createElement('div')
  root = createRoot(host)
  act(() => {
    root!.render(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>
    )
  })
  return {
    result,
    unmount: () => { act(() => root?.unmount()); root = null },
  }
}

/** 等到条件成立（异步 query 落定），最多 ~1s */
async function until(cond: () => boolean) {
  for (let i = 0; i < 100 && !cond(); i++) {
    await act(async () => { await new Promise(r => setTimeout(r, 10)) })
  }
  if (!cond()) throw new Error('等待超时')
}

const respond = (status: number, body = '', headers: Record<string, string> = {}) =>
  new Response(body, { status, headers })
const image = () =>
  new Response(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }), { status: 200 })

beforeEach(() => {
  client = new QueryClient({
    // retryDelay 压到 1ms：让「重试一次」在测试里立刻发生；各 hook 自己的 retry 仍然生效
    defaultOptions: { queries: { retry: false, retryDelay: 1 } },
  })
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  getLyrics.mockReset()
  useSettingsStore.setState({
    coverRemoteTemplate: 'https://cover.test/api',
    coverLoadAlbum: true,
    coverLoadArtist: true,
    apiAuthToken: '',
    lyricsUseRemote: false,
    lyricsRemoteTemplate: '',
    lyricsPreferRemote: false,
  })
})
afterEach(() => {
  act(() => root?.unmount())
  root = null
  client.clear()
  vi.unstubAllGlobals()
})

describe('buildCoverUrl：模板占位符', () => {
  const TEMPLATE = 'https://api.example.com/cover?artist={artist}&album={album}'

  it('空专辑时 {album} 换成空串，不把占位符原样发给服务器', () => {
    const url = buildCoverUrl(TEMPLATE, { type: 'song', title: '晴天', artist: '周杰伦' })
    expect(url).not.toMatch(/[{}]|%7B|%7D/i)
    const q = new URL(url).searchParams
    expect(q.get('artist')).toBe('周杰伦')
    expect(q.get('album')).toBe('')
  })

  it('有值时照常填入（编码），title 仍按旧规则追加', () => {
    const url = buildCoverUrl(TEMPLATE, { type: 'song', title: '晴天', artist: '周杰伦', album: '叶惠美' })
    const q = new URL(url).searchParams
    expect(q.get('artist')).toBe('周杰伦')
    expect(q.get('album')).toBe('叶惠美')
    expect(q.get('title')).toBe('晴天')
  })

  it('占位符不在查询串里（路径里）也能填，不再被编码成 %7B', () => {
    const url = buildCoverUrl('https://api.example.com/{artist}/{album}.jpg', { type: 'album', artist: 'A' })
    // 查询串里的 artist 是 buildCoverUrl 一贯会追加的，这里只钉路径里没有残留占位符
    expect(url).toBe('https://api.example.com/A/.jpg?artist=A')
  })

  it('按类型取值：专辑查询不带 title，歌手查询只带 artist', () => {
    const album = buildCoverUrl('https://x.test/c?t={title}&a={artist}&al={album}', {
      type: 'album', title: 'T', artist: 'A', album: 'AL',
    })
    expect(new URL(album).searchParams.get('t')).toBe('')
    const artist = buildCoverUrl('https://x.test/c?a={artist}&al={album}', {
      type: 'artist', artist: 'A', album: 'AL',
    })
    expect(new URL(artist).searchParams.get('al')).toBe('')
  })

  it('不含占位符的基地址行为不变（LrcApi 式）', () => {
    const url = buildCoverUrl('https://api.lrc.cx/cover', { type: 'song', title: '成都', artist: '赵雷' })
    expect(url).toBe('https://api.lrc.cx/cover?title=%E6%88%90%E9%83%BD&artist=%E8%B5%B5%E9%9B%B7')
  })
})

describe('buildLyricsUrl：模板占位符', () => {
  it('空专辑时 {album} 换成空串；offset / limit 照旧', () => {
    const url = buildLyricsUrl('https://l.test/api?title={title}&artist={artist}&album={album}', {
      title: '晴天', artist: '周杰伦',
    })
    expect(url).not.toMatch(/[{}]|%7B|%7D/i)
    const q = new URL(url).searchParams
    expect(q.get('title')).toBe('晴天')
    expect(q.get('album')).toBe('')
    expect(q.get('limit')).toBe('10')
  })

  it('{id} 也替换', () => {
    const url = buildLyricsUrl('https://l.test/api?id={id}', { id: 's-1' })
    expect(new URL(url).searchParams.get('id')).toBe('s-1')
  })
})

describe('useCustomCoverUrl：失败不当成「没有」缓存', () => {
  const params = { type: 'song' as const, title: '晴天', artist: '周杰伦' }
  const stateOf = () => client.getQueryCache().getAll()[0]?.state

  it('429：进 error 态，不是缓存成功的 null；且不重试（只发一次）', async () => {
    fetchMock.mockImplementation(async () => respond(429))
    const { result } = renderHook(() => useCustomCoverUrl(params))
    await until(() => result.current.isError)

    expect(stateOf()?.status).toBe('error')
    expect(result.current.data).toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('5xx：只重试一次（共两次），仍是 error 态', async () => {
    fetchMock.mockImplementation(async () => respond(503))
    const { result } = renderHook(() => useCustomCoverUrl(params))
    await until(() => result.current.isError)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.current.data).toBeUndefined()
  })

  it('断网：error 态', async () => {
    fetchMock.mockImplementation(async () => { throw new TypeError('Failed to fetch') })
    const { result } = renderHook(() => useCustomCoverUrl(params))
    await until(() => result.current.isError)
    expect(result.current.data).toBeUndefined()
  })

  it('404 才是明确的「没有」：成功态、data 为 null，不重试', async () => {
    fetchMock.mockImplementation(async () => respond(404))
    const { result } = renderHook(() => useCustomCoverUrl(params))
    await until(() => result.current.isSuccess)

    expect(result.current.data).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('失败后重新挂载还能再试，恢复后拿到封面（错误没被永久缓存）', async () => {
    fetchMock.mockImplementation(async () => respond(429))
    const first = renderHook(() => useCustomCoverUrl(params))
    await until(() => first.result.current.isError)
    first.unmount()

    fetchMock.mockImplementation(async () => image())
    const second = renderHook(() => useCustomCoverUrl(params))
    await until(() => second.result.current.isSuccess)
    expect(second.result.current.data).toMatch(/^blob:/)
  })

  it('空专辑时发出去的地址不含占位符', async () => {
    useSettingsStore.setState({
      coverRemoteTemplate: 'https://api.example.com/cover?artist={artist}&album={album}',
    })
    fetchMock.mockImplementation(async () => image())
    const { result } = renderHook(() => useCustomCoverUrl(params))
    await until(() => result.current.isSuccess)

    const requested = String(fetchMock.mock.calls[0][0])
    expect(requested).not.toMatch(/[{}]|%7B|%7D/i)
  })
})

describe('useLyricsQuery：失败不当成「没有」', () => {
  const useLyrics = () =>
    useLyricsQuery('s1', '晴天', '周杰伦', undefined, undefined, undefined, true, 'srv')

  function withRemote(preferRemote: boolean, template = 'https://l.test/api') {
    useSettingsStore.setState({
      lyricsUseRemote: true,
      lyricsRemoteTemplate: template,
      lyricsPreferRemote: preferRemote,
    })
  }

  it('服务器歌词断网：error 态（界面显示「歌词加载失败」，而不是「暂无歌词」）', async () => {
    getLyrics.mockRejectedValue(new Error('Network Error'))
    const { result } = renderHook(useLyrics)
    await until(() => result.current.isError)
    expect(result.current.data).toBeUndefined()
  })

  it('服务器明确没有歌词（null）：成功态，data 为 null', async () => {
    getLyrics.mockResolvedValue(null)
    const { result } = renderHook(useLyrics)
    await until(() => result.current.isSuccess)
    expect(result.current.isError).toBe(false)
    expect(result.current.data).toBeNull()
  })

  it('远程接口 503（服务器无歌词）：整体是 error 态，不是「暂无歌词」', async () => {
    getLyrics.mockResolvedValue(null)
    fetchMock.mockImplementation(async () => respond(503))
    withRemote(false)
    const { result } = renderHook(useLyrics)
    await until(() => result.current.isError)
    expect(result.current.data == null).toBe(true)
  })

  it('远程优先时同理：远程 429 + 服务器无歌词 → error 态', async () => {
    getLyrics.mockResolvedValue(null)
    fetchMock.mockImplementation(async () => respond(429))
    withRemote(true)
    const { result } = renderHook(useLyrics)
    await until(() => result.current.isError)
  })

  it('远程接口 404 是明确的「没有」：不报错', async () => {
    getLyrics.mockResolvedValue(null)
    fetchMock.mockImplementation(async () => respond(404))
    withRemote(false)
    const { result } = renderHook(useLyrics)
    await until(() => result.current.isSuccess)
    expect(result.current.isError).toBe(false)
    expect(result.current.data == null).toBe(true)
  })

  it('一路出错但另一路有词：有词就显示，不被错误盖掉', async () => {
    getLyrics.mockRejectedValue(new Error('Network Error'))
    fetchMock.mockImplementation(async () =>
      respond(200, '[00:01.00]远程的词', { 'content-type': 'text/plain' }))
    withRemote(false)
    const { result } = renderHook(useLyrics)
    await until(() => !!result.current.data)
    expect(result.current.data?.lines[0].text).toBe('远程的词')
  })

  it('歌词模板里空专辑的 {album} 不原样发出去', async () => {
    getLyrics.mockResolvedValue(null)
    fetchMock.mockImplementation(async () => respond(404))
    withRemote(false, 'https://l.test/api?title={title}&artist={artist}&album={album}')
    const { result } = renderHook(useLyrics)
    await until(() => result.current.isSuccess)

    const requested = String(fetchMock.mock.calls[0][0])
    expect(requested).not.toMatch(/[{}]|%7B|%7D/i)
  })
})
