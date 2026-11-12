/**
 * @vitest-environment happy-dom
 *
 * 流地址缓存要跟着服务器的地址 / 凭据走。走真实的 serverStore 动作与真实的适配器注册表：
 *  - 设置里改了服务器地址（updateServerUrl 保持 id 不变）；
 *  - 重新登录换了令牌（updateServerAuth + 重新连上）。
 * 之后再放刚放过的那首，必须按新地址 / 新令牌取流。原来缓存只认 (serverId, songId, quality)，
 * 命中的还是旧地址，播不出来，错误恢复重载的也是同一个死地址。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

vi.mock('@/services/listeningHistory', async importOriginal => {
  const real = await importOriginal<typeof import('@/services/listeningHistory')>()
  return { ...real, upsertListeningEvent: vi.fn(async () => 0), isQualifiedListeningEvent: () => true }
})
vi.mock('@/components/ui/use-toast', () => ({ toast: vi.fn() }))
vi.mock('@/lib/network', () => ({
  isMeteredConnection: () => false,
  onConnectionChange: () => () => undefined,
}))

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useAudioEngine } from './useAudioEngine'
import { clearAdapter, createAdapter, registerAdapter, setPrimary } from '@/api'
import { usePlayerStore } from '@/store/playerStore'
import { useServerStore } from '@/store/serverStore'
import type { ServerConfig, Song } from '@/api/types'

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
})

function Probe() {
  useAudioEngine()
  return null
}
function ProbeTree() {
  return <QueryClientProvider client={queryClient}><Probe /></QueryClientProvider>
}

const NAS = 'nas'
const OLD = 'http://192.168.1.3:4533'
const NEXT = 'http://192.168.1.150:4533'

const nasConfig = (): ServerConfig => ({
  id: NAS, name: 'NAS', type: 'subsonic', url: OLD, username: 'niko',
  token: 'tok-old', salt: 'salt-old', isActive: true, createdAt: 0,
})
const song = (id: string): Song => ({ id, title: `歌${id}`, artist: 'A', album: 'AL', duration: 200, serverId: NAS })

let root: Root | null = null
let audio: HTMLAudioElement | null = null
const realPlayRef = HTMLMediaElement.prototype.play
const realLoadRef = HTMLMediaElement.prototype.load

beforeEach(() => {
  audio = null
  HTMLMediaElement.prototype.play = function () { return Promise.resolve() }
  HTMLMediaElement.prototype.pause = function () { /* noop */ }
  // 引擎加载时 audio.load()：借此拿到模块级的 audioEl
  HTMLMediaElement.prototype.load = function (this: HTMLAudioElement) {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- 测试要捕获引擎内部的模块级元素
    audio = this
  }
  clearAdapter()
  const config = nasConfig()
  registerAdapter(NAS, createAdapter(config))
  setPrimary(NAS)
  useServerStore.setState({
    servers: [config],
    connectedServerIds: [NAS],
    compromisedServerIds: [],
    activeServerId: NAS,
    isConnected: true,
    startupConnectSettled: true,
  } as never)
  const queue = [song('a'), song('b')]
  usePlayerStore.setState({
    currentSong: queue[0], queue, queueIndex: 0, isPlaying: false,
    playVersion: 1, repeatMode: 'none', shuffle: false, shuffledIndexes: [0, 1], shuffleCursor: -1,
    currentTime: 0, duration: 200,
  } as never)
})
afterEach(() => {
  HTMLMediaElement.prototype.play = realPlayRef
  HTMLMediaElement.prototype.load = realLoadRef
  act(() => { root?.unmount() })
  root = null
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

async function settle() {
  // 等过 120ms 的切歌防抖窗口，再把取流的微任务跑完
  await act(async () => {
    await new Promise(r => setTimeout(r, 150))
    for (let i = 0; i < 50; i++) await Promise.resolve()
  })
}

async function playedSongAThenReplayIt(changeServer: () => void): Promise<string> {
  const host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root!.render(<ProbeTree />) })
  await settle()
  if (!audio) throw new Error('引擎没有加载音频')
  const el: HTMLAudioElement = audio
  expect(el.getAttribute('src')).toContain(OLD)
  expect(el.getAttribute('src')).toContain('tok-old')

  act(() => { changeServer() })
  // 再点一次刚放过的这首
  act(() => { usePlayerStore.getState().playSong(song('a'), [song('a'), song('b')]) })
  await settle()
  return el.getAttribute('src') ?? ''
}

describe('流地址缓存跟着服务器的地址 / 凭据走', () => {
  it('改了服务器地址：刚放过的歌按新地址取流', async () => {
    const src = await playedSongAThenReplayIt(() => {
      expect(useServerStore.getState().updateServerUrl(NAS, NEXT)).toBe(true)
    })

    expect(src.startsWith(NEXT)).toBe(true)
  })

  it('重新登录换了令牌：刚放过的歌按新令牌取流', async () => {
    const src = await playedSongAThenReplayIt(() => {
      useServerStore.getState().updateServerAuth(NAS, 'tok-new', 'salt-new')
      // 登录流程随后按新凭据重建适配器
      const updated = useServerStore.getState().servers.find(s => s.id === NAS)!
      registerAdapter(NAS, createAdapter(updated))
    })

    expect(src).toContain('tok-new')
    expect(src).not.toContain('tok-old')
  })
})
