/**
 * WebDAV 扫描走真实的 scan / walk / readTags 路径，只把 fetch 换成一台假的 NAS。
 * 测试环境里没有原生插件，适配器走网页那条 fetch 路；没有 IndexedDB，曲库不落盘。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/components/ui/use-toast', () => ({ toast: vi.fn() }))

import { toast } from '@/components/ui/use-toast'
import { t } from '@/i18n'
import { WebDavAdapter } from './webdav'

const ORIGIN = 'http://nas.test'
const ROOT = `${ORIGIN}/music`

function u32le(value: number): number[] {
  return [value & 255, (value >> 8) & 255, (value >> 16) & 255, (value >>> 24) & 255]
}

/** 只有 VORBIS_COMMENT 一个块的 FLAC 文件头 */
function flacWithTitle(title: string): Uint8Array {
  const encoder = new TextEncoder()
  const vendor = encoder.encode('test')
  const comment = encoder.encode(`TITLE=${title}`)
  const body = [...u32le(vendor.length), ...vendor, ...u32le(1), ...u32le(comment.length), ...comment]
  return Uint8Array.from([
    0x66, 0x4c, 0x61, 0x43,
    0x84, (body.length >> 16) & 255, (body.length >> 8) & 255, body.length & 255,
    ...body,
  ])
}

type FileReply = number | (() => Response)

/** 一台假的 NAS：路径都是解码后的，回给客户端的 href 按段编码 */
class FakeNas {
  readonly files = new Map<string, { bytes?: Uint8Array; replies: FileReply[]; size?: number }>()
  readonly dirStatus = new Map<string, number | 'network'>()
  readonly gets = new Map<string, number>()
  infinity = false
  /** 打乱目录里条目的顺序、给每次 PROPFIND 随机延迟，模拟并发下回来的先后不定 */
  random: (() => number) | null = null

  /** replies：前几次 GET 依次回的状态（或整个 Response）；size：PROPFIND 里报的文件大小 */
  add(path: string, bytes?: Uint8Array, replies: FileReply[] = [], size?: number): void {
    this.files.set(path, { bytes, replies, size })
  }

  readonly fetch = async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input))
    const path = decodePath(url.pathname)
    if (init?.method === 'PROPFIND') {
      if (this.random) await new Promise(resolve => setTimeout(resolve, Math.floor(this.random!() * 3)))
      const depth = (init.headers as Record<string, string>).Depth
      const status = this.dirStatus.get(path)
      if (status === 'network') throw new TypeError('Failed to fetch')
      if (status) return new Response('', { status })
      if (depth === 'infinity' && !this.infinity) return new Response('', { status: 403 })
      return new Response(this.multistatus(path, depth === 'infinity'), { status: 207 })
    }
    this.gets.set(path, (this.gets.get(path) ?? 0) + 1)
    const file = this.files.get(path)
    if (!file) return new Response('', { status: 404 })
    const reply = file.replies.shift() ?? (file.bytes ? 206 : 404)
    if (typeof reply === 'function') return reply()
    if (reply < 200 || reply >= 300) return new Response('', { status: reply })
    return new Response(file.bytes ? file.bytes.slice() : null, { status: reply })
  }

  private sizeOf(path: string): number {
    const file = this.files.get(path)
    return file?.size ?? file?.bytes?.length ?? 1000
  }

  private multistatus(dir: string, deep: boolean): string {
    const children = new Map<string, boolean>()
    for (const path of this.files.keys()) {
      if (!path.startsWith(dir)) continue
      const rest = path.slice(dir.length).split('/')
      if (deep) {
        for (let i = 1; i < rest.length; i++) children.set(`${dir}${rest.slice(0, i).join('/')}/`, true)
        children.set(path, false)
      } else {
        children.set(rest.length > 1 ? `${dir}${rest[0]}/` : path, rest.length > 1)
      }
    }
    const entries = [...children]
    if (this.random) {
      for (let i = entries.length - 1; i > 0; i--) {
        const j = Math.floor(this.random() * (i + 1))
        ;[entries[i], entries[j]] = [entries[j], entries[i]]
      }
    }
    const response = (path: string, collection: boolean) => {
      const name = path.replace(/\/$/, '').split('/').pop() ?? ''
      const props = collection
        ? '<d:resourcetype><d:collection/></d:resourcetype>'
        : `<d:resourcetype/><d:getcontentlength>${this.sizeOf(path)}</d:getcontentlength><d:getetag>"${path.length}"</d:getetag>`
      return `<d:response><d:href>${encodePath(path)}</d:href><d:propstat><d:prop><d:displayname>${escapeXml(name)}</d:displayname>${props}</d:prop></d:propstat></d:response>`
    }
    return `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">${response(dir, true)}${entries.map(([path, collection]) => response(path, collection)).join('')}</d:multistatus>`
  }
}

function decodePath(pathname: string): string {
  return pathname.split('/').map(part => decodeURIComponent(part)).join('/')
}

function encodePath(path: string): string {
  return path.split('/').map(part => encodeURIComponent(part)).join('/')
}

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** 可复现的伪随机数（mulberry32） */
function seeded(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let x = state
    x = Math.imul(x ^ (x >>> 15), x | 1)
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61)
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}

function adapterFor(nas: FakeNas, serverId = 'dav'): WebDavAdapter {
  vi.stubGlobal('fetch', nas.fetch)
  return new WebDavAdapter({ url: ROOT, username: 'u', password: 'p', serverId })
}

/** 私有的 scan：扫描根失败时 getSongs 那条路会留下一个没人接的 rejection，测试里直接调它 */
function scan(adapter: WebDavAdapter): Promise<unknown> {
  return (adapter as unknown as { scan(previous: null): Promise<unknown> }).scan(null)
}

/** 设置页的「扫描曲库」：重扫并等后台补读标签结束 */
async function rescan(adapter: WebDavAdapter): Promise<void> {
  await adapter.startScan()
  await vi.waitFor(async () => expect((await adapter.getScanStatus())?.scanning).toBe(false))
}

async function titles(adapter: WebDavAdapter): Promise<string[]> {
  return (await adapter.getSongs()).items.map(song => song.title).sort()
}

let warn: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.mocked(toast).mockClear()
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  warn.mockRestore()
  vi.unstubAllGlobals()
})

describe('子文件夹出错不拖垮整次扫描', () => {
  function library(): FakeNas {
    const nas = new FakeNas()
    nas.add('/music/A/a.flac', flacWithTitle('Alpha'))
    nas.add('/music/B/b.flac', flacWithTitle('Bravo'))
    nas.add('/music/Locked/x.flac', flacWithTitle('Locked'))
    nas.add('/music/Broken/y.flac', flacWithTitle('Broken'))
    return nas
  }

  it('没权限（403）和服务器出错（500）的子文件夹跳过并记数，其余照常', async () => {
    const nas = library()
    nas.dirStatus.set('/music/Locked/', 403)
    nas.dirStatus.set('/music/Broken/', 500)
    const adapter = adapterFor(nas)
    expect(await titles(adapter)).toEqual(['Alpha', 'Bravo'])
    expect(warn).toHaveBeenCalledWith('[webdav]', expect.stringContaining('2 个子文件夹'))
  })

  it('扫描根鉴权失败仍然上抛，让用户看到账号不对', async () => {
    const nas = library()
    nas.dirStatus.set('/music/', 401)
    await expect(scan(adapterFor(nas))).rejects.toThrow(t('webdav.error.auth'))
  })

  it('扫描根服务器出错仍然上抛', async () => {
    const nas = library()
    nas.dirStatus.set('/music/', 500)
    await expect(scan(adapterFor(nas))).rejects.toThrow(t('webdav.error.status', { status: 500 }))
  })

  it('子文件夹连不上（NAS 掉线）仍然整次失败，不拿残缺的曲库覆盖上次的', async () => {
    const nas = library()
    nas.dirStatus.set('/music/B/', 'network')
    await expect(scan(adapterFor(nas))).rejects.toThrow()
  })
})

describe('读标签的临时错误不记成「无标签」', () => {
  it.each([503, 500, 429, 408, 401, 403])('第一次读到 %i 的歌，下次扫描重读', async status => {
    const nas = new FakeNas()
    nas.add('/music/A/a.flac', flacWithTitle('Alpha'), [status])
    const adapter = adapterFor(nas)
    expect(await titles(adapter)).toEqual(['a'])
    await rescan(adapter)
    expect(await titles(adapter)).toEqual(['Alpha'])
    expect(nas.gets.get('/music/A/a.flac')).toBe(2)
  })

  it.each([404, 410, 415, 416])('服务器明确说读不了（%i）的歌记成已读，文件没变就不再读', async status => {
    const nas = new FakeNas()
    nas.add('/music/A/a.flac', flacWithTitle('Alpha'), [status])
    const adapter = adapterFor(nas)
    expect(await titles(adapter)).toEqual(['a'])
    await rescan(adapter)
    expect(await titles(adapter)).toEqual(['a'])
    expect(nas.gets.get('/music/A/a.flac')).toBe(1)
  })

  it('补读第二段时碰上临时错误：先用第一段的标签，下次扫描再补', async () => {
    const nas = new FakeNas()
    // 声明了 300KB 的 ID3 标签，第一次读 64KB 不够，会再要一段；那一段回 503
    const header = new Uint8Array(65536)
    header.set([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x12, 0x00, 0x00])
    const title = [0x54, 0x49, 0x54, 0x32, 0, 0, 0, 6, 0, 0, 0x03, ...new TextEncoder().encode('Alpha')]
    header.set(title, 10)
    nas.add('/music/A/a.mp3', header, [206, 503, 206, 206], 5_000_000)
    const adapter = adapterFor(nas)
    expect(await titles(adapter)).toEqual(['Alpha'])
    await rescan(adapter)
    // 第一次扫描两次请求，重扫没有沿用「已读」而是又读了两次
    expect(nas.gets.get('/music/A/a.mp3')).toBe(4)
  })

  it('服务器不认 Range、回 200 和整首歌时，只读开头那一段就断开', async () => {
    const nas = new FakeNas()
    const head = flacWithTitle('Alpha')
    const chunk = 64 * 1024
    let pulled = 0
    let cancelled = false
    nas.add('/music/A/a.flac', head, [() => new Response(new ReadableStream<Uint8Array>({
      pull(controller) {
        // 一首 12MB 的歌：开头是标签，后面全是音频
        const bytes = new Uint8Array(chunk)
        if (pulled === 0) bytes.set(head)
        pulled += 1
        if (pulled > 200) controller.close()
        else controller.enqueue(bytes)
      },
      cancel() {
        cancelled = true
      },
    }), { status: 200 })])
    const adapter = adapterFor(nas)
    expect(await titles(adapter)).toEqual(['Alpha'])
    expect(cancelled).toBe(true)
    expect(pulled).toBeLessThan(5)
  })
})

describe('回收站和系统目录不进曲库', () => {
  function library(): FakeNas {
    const nas = new FakeNas()
    nas.add('/music/歌手/专辑/1 好歌.flac')
    nas.add('/music/#recycle/歌手/删掉的.mp3')
    nas.add('/music/.Trash/t.mp3')
    nas.add('/music/@eaDir/1 好歌.flac/SYNOAUDIO.mp3')
    nas.add('/music/歌手/@eaDir/e.mp3')
    nas.add('/music/@Recycle/r.mp3')
    nas.add('/music/$RECYCLE.BIN/$R1A2B.mp3')
    nas.add('/music/1/2/3/4/5/6/7/8/第八层.mp3')
    nas.add('/music/1/2/3/4/5/6/7/8/9/第九层.mp3')
    return nas
  }

  async function songIds(infinity: boolean): Promise<string[]> {
    const nas = library()
    nas.infinity = infinity
    const page = await adapterFor(nas).getSongs()
    return page.items.map(song => decodePath(song.id)).sort()
  }

  it('一次列全库（Depth: infinity）和逐层走收到的一样', async () => {
    const expected = ['/music/1/2/3/4/5/6/7/8/第八层.mp3', '/music/歌手/专辑/1 好歌.flac']
    expect(await songIds(false)).toEqual(expected)
    expect(await songIds(true)).toEqual(expected)
  })
})

describe('超过上限时截断要稳定，并提示一次', () => {
  const FOLDERS = 205
  const PER_FOLDER = 49
  const total = FOLDERS * PER_FOLDER

  function library(seed: number, infinity = false): FakeNas {
    const nas = new FakeNas()
    for (let f = 0; f < FOLDERS; f++) {
      for (let n = 0; n < PER_FOLDER; n++) {
        nas.add(`/music/f${String(f).padStart(3, '0')}/t${String(n).padStart(2, '0')}.mp3`)
      }
    }
    nas.random = seeded(seed)
    nas.infinity = infinity
    return nas
  }

  it('两次扫描（含一次列全库）留下同一批：按路径排在前面的一万首', async () => {
    const all = [...library(0).files.keys()].sort()
    const expected = all.slice(0, 10000)
    const runs: string[][] = []
    for (const [seed, infinity] of [[1, false], [2, false], [3, true]] as const) {
      const page = await adapterFor(library(seed, infinity), `dav-${seed}`).getSongs()
      runs.push(page.items.map(song => decodePath(song.id)).sort())
    }
    expect(runs[0]).toEqual(expected)
    expect(runs[1]).toEqual(expected)
    expect(runs[2]).toEqual(expected)
    // 每次扫描提示一次，说清找到多少、收了多少、上限多少
    expect(toast).toHaveBeenCalledTimes(3)
    expect(toast).toHaveBeenLastCalledWith({
      title: t('webdav.scan.truncated', { found: total, count: 10000, limit: 10000 }),
    })
  }, 30000)

  it('没超上限时不提示', async () => {
    const nas = new FakeNas()
    nas.add('/music/A/a.mp3')
    await adapterFor(nas).getSongs()
    expect(toast).not.toHaveBeenCalled()
  })
})
