/**
 * @vitest-environment happy-dom
 *
 * 断开 / 移除音源时播放队列的归属（B2）。
 *
 * 钉的是一条：**断开一个音源只带走它自己的歌**。
 * 原来这里两头都错——断开插件源什么都不做（它的歌卡在队列里，播到就静默停住），
 * 断开主库却 resetForServerChange（把别的源的歌一起清掉）。
 */

import { beforeEach, describe, expect, it } from 'vitest'
import type { MusicServerAdapter, ServerConfig, Song } from '@/api/types'
import { clearAdapter, findAdapterFor, hasAdapter, hasAdapterFor, registerAdapter, setPrimary } from '@/api'
import { usePlayerStore } from '@/store/playerStore'
import { useServerStore } from '@/store/serverStore'

const NAS = 'nas'
const WY = 'wy'

function server(id: string, type: ServerConfig['type'] = 'subsonic'): ServerConfig {
  return { id, name: id, type, url: '', username: '', token: '', isActive: false, createdAt: 0 }
}

function song(id: string, serverId: string): Song {
  return { id, title: `Song ${id}`, artist: 'Artist', album: 'Album', duration: 200, serverId }
}

function stubAdapter(): MusicServerAdapter {
  return { type: 'subsonic' } as unknown as MusicServerAdapter
}

/** 两个源都连着，主库是 NAS；队列交替混源 */
function connectBothWithMixedQueue(currentIndex: number) {
  registerAdapter(NAS, stubAdapter())
  registerAdapter(WY, stubAdapter())
  setPrimary(NAS)
  useServerStore.setState({
    servers: [server(NAS), server(WY, 'plugin')],
    connectedServerIds: [NAS, WY],
    compromisedServerIds: [],
    activeServerId: NAS,
    isConnected: true,
    username: 'niko',
    avatarUrl: null,
  })
  const queue = [song('a', NAS), song('b', WY), song('c', NAS), song('d', WY)]
  usePlayerStore.setState({
    queue,
    queueIndex: currentIndex,
    currentSong: queue[currentIndex],
    isPlaying: true,
    shuffle: false,
    shuffledIndexes: queue.map((_, i) => i),
    shuffleCursor: -1,
    history: [song('h', WY)],
  })
}

beforeEach(() => {
  clearAdapter()
  usePlayerStore.setState({
    queue: [], queueIndex: -1, currentSong: null, isPlaying: false,
    shuffle: false, shuffledIndexes: [], shuffleCursor: -1, history: [],
  })
})

describe('disconnectServer', () => {
  it('只把被断源的歌从队列里摘掉，别的源继续放', () => {
    connectBothWithMixedQueue(0)

    useServerStore.getState().disconnectServer(WY)

    expect(usePlayerStore.getState().queue.map(s => s.id)).toEqual(['a', 'c'])
    expect(usePlayerStore.getState().currentSong?.id).toBe('a')
    expect(usePlayerStore.getState().isPlaying).toBe(true)
    expect(hasAdapterFor(WY)).toBe(false)
    expect(useServerStore.getState().connectedServerIds).toEqual([NAS])
  })

  it('正在放被断源的歌时前进到下一首，而不是把队列卡在那儿', () => {
    connectBothWithMixedQueue(1) // 当前是 b（网易云）

    useServerStore.getState().disconnectServer(WY)

    expect(usePlayerStore.getState().currentSong?.id).toBe('c')
    expect(usePlayerStore.getState().isPlaying).toBe(true)
  })

  it('断开主库不清空别的源的歌——混源队列不该被连坐', () => {
    connectBothWithMixedQueue(1)

    useServerStore.getState().disconnectServer(NAS)

    expect(usePlayerStore.getState().queue.map(s => s.id)).toEqual(['b', 'd'])
    // 主库让位，但插件源的队列还在放
    expect(useServerStore.getState().activeServerId).toBeNull()
    expect(useServerStore.getState().isConnected).toBe(false)
    expect(usePlayerStore.getState().currentSong?.id).toBe('b')
  })

  it('历史里被断源的曲目一并清掉', () => {
    connectBothWithMixedQueue(0)

    useServerStore.getState().disconnectServer(WY)

    expect(usePlayerStore.getState().history).toEqual([])
  })
})

describe('removeServer', () => {
  /* removeServer 异步化（复核 F9）：先让平台登出 settle（≤500ms）再拆沙箱 */
  it('删掉一个音源时它的歌离开队列，配置也一并移除', async () => {
    connectBothWithMixedQueue(0)

    await useServerStore.getState().removeServer(WY)

    expect(usePlayerStore.getState().queue.map(s => s.id)).toEqual(['a', 'c'])
    expect(useServerStore.getState().servers.map(s => s.id)).toEqual([NAS])
    expect(useServerStore.getState().connectedServerIds).toEqual([NAS])
  })

  it('删掉主库时别的源的歌留着，主库让位', async () => {
    connectBothWithMixedQueue(1)

    await useServerStore.getState().removeServer(NAS)

    expect(usePlayerStore.getState().queue.map(s => s.id)).toEqual(['b', 'd'])
    expect(useServerStore.getState().activeServerId).toBeNull()
  })
})

describe('updateServerUrl', () => {
  const OLD = 'http://192.168.1.3:5005'
  const NEXT = 'http://192.168.1.150:5005'
  // WebDAV 的 id 是文件路径（保持服务器给的编码），不带主机
  const FILE = '/sata/%E9%9F%B3%E4%B9%90/a.flac'
  const COVER = '/sata/cover.jpg'

  function webdavReady() {
    const config = server(NAS, 'webdav')
    config.url = OLD
    config.name = 'WebDAV - 192.168.1.3'
    config.token = 'secret'
    registerAdapter(NAS, stubAdapter())
    registerAdapter(WY, stubAdapter())
    setPrimary(NAS)
    useServerStore.setState({
      servers: [config, server(WY, 'plugin')],
      connectedServerIds: [NAS, WY],
      compromisedServerIds: [],
      activeServerId: NAS,
      isConnected: true,
    })
    usePlayerStore.setState({
      queue: [
        { ...song(FILE, NAS), path: '/sata/音乐/a.flac', coverArt: COVER },
        song('b', WY),
      ],
      queueIndex: 0,
      currentSong: { ...song(FILE, NAS), path: '/sata/音乐/a.flac', coverArt: COVER },
      history: [song('/old.mp3', NAS)],
      isPlaying: true,
    })
  }

  it('改 WebDAV 地址时队列原样不动，新适配器按新地址取文件，主库保持连着', () => {
    webdavReady()

    expect(useServerStore.getState().updateServerUrl(NAS, `${NEXT}/`)).toBe(true)

    const saved = useServerStore.getState().servers.find(item => item.id === NAS)
    expect(saved?.url).toBe(NEXT)
    expect(saved?.name).toBe('WebDAV - 192.168.1.150')
    expect(usePlayerStore.getState().currentSong?.id).toBe(FILE)
    expect(usePlayerStore.getState().queue.map(item => item.id)).toEqual([FILE, 'b'])
    expect(usePlayerStore.getState().history[0]?.id).toBe('/old.mp3')
    expect(findAdapterFor(NAS)?.getStreamUrl(FILE, 0, 'raw')).toBe(`${NEXT}${FILE}`)
    expect(findAdapterFor(NAS)?.getCoverUrl(COVER)).toBe(`${NEXT}${COVER}`)
    // 合并前的测试版把整条地址当 id，也能接着播
    expect(findAdapterFor(NAS)?.getStreamUrl(`${OLD}${FILE}`, 0, 'raw')).toBe(`${NEXT}${FILE}`)
    expect(useServerStore.getState().activeServerId).toBe(NAS)
    expect(hasAdapter()).toBe(true)
    expect(hasAdapterFor(WY)).toBe(true)
  })

  it('自己起的名字不跟着主机名改', () => {
    webdavReady()
    useServerStore.setState({
      servers: useServerStore.getState().servers.map(item => (
        item.id === NAS ? { ...item, name: '家里的盘' } : item
      )),
    })

    useServerStore.getState().updateServerUrl(NAS, NEXT)

    expect(useServerStore.getState().servers.find(item => item.id === NAS)?.name).toBe('家里的盘')
  })

  it('Subsonic 的曲目 id 不是地址，改服务器地址时不动它', () => {
    connectBothWithMixedQueue(0)
    useServerStore.setState({
      servers: useServerStore.getState().servers.map(item => (
        item.id === NAS ? { ...item, url: 'http://nas.local', name: 'Subsonic - nas.local' } : item
      )),
    })

    expect(useServerStore.getState().updateServerUrl(NAS, 'http://nas.home')).toBe(true)

    expect(usePlayerStore.getState().queue.map(item => item.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(useServerStore.getState().servers.find(item => item.id === NAS)?.name).toBe('Subsonic - nas.home')
  })

  it('无效地址和插件音源不改任何东西', () => {
    webdavReady()

    expect(useServerStore.getState().updateServerUrl(NAS, 'ftp://192.168.1.150')).toBe(false)
    expect(useServerStore.getState().updateServerUrl(WY, NEXT)).toBe(false)
    expect(useServerStore.getState().servers.find(item => item.id === NAS)?.url).toBe(OLD)
    expect(usePlayerStore.getState().currentSong?.id).toBe(FILE)
  })
})

describe('markServerCompromised', () => {
  it('复用 disconnectServer：队列同样按来源裁剪，并留下停用标记', () => {
    connectBothWithMixedQueue(1)

    useServerStore.getState().markServerCompromised(WY, '沙箱自导航')

    expect(usePlayerStore.getState().queue.map(s => s.id)).toEqual(['a', 'c'])
    expect(useServerStore.getState().compromisedServerIds).toContain(WY)
    expect(hasAdapterFor(WY)).toBe(false)
  })
})
