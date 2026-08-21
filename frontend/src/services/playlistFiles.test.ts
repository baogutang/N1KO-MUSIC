/**
 * XSPF 的解析走 DOMParser，所以这个文件需要一个 DOM 环境。
 * 只有这一个测试文件付这份代价，其余仍跑在 node 上。
 *
 * @vitest-environment happy-dom
 */
import { describe, it, expect } from 'vitest'
import {
  toM3U, toXSPF, parseM3U, parseXSPF, parsePlaylistFile,
  matchEntriesToLibrary, historyToCSV, historyToJSON, safeFileName,
  resolvePlaylistEntries, MAX_IMPORT_ENTRIES,
} from './playlistFiles'
import type { Song } from '@/api/types'
import type { ListeningEvent } from '@/services/listeningHistory'

function song(overrides: Partial<Song> = {}): Song {
  return {
    id: 's1',
    title: '晚安',
    artist: '陈粒',
    album: '小梦大半',
    duration: 213,
    path: 'Chen Li/Xiao Meng Da Ban/01 晚安.flac',
    ...overrides,
  } as Song
}

describe('M3U', () => {
  it('写路径而不是带 token 的流地址', () => {
    const text = toM3U([song()], '睡前')
    expect(text).toContain('#EXTM3U')
    expect(text).toContain('#PLAYLIST:睡前')
    expect(text).toContain('#EXTINF:213,陈粒 - 晚安')
    expect(text).toContain('Chen Li/Xiao Meng Da Ban/01 晚安.flac')
    expect(text).not.toMatch(/token|salt|[?&]u=/)
  })

  it('时长未知写 -1，不写 0（0 会被某些播放器当成空轨丢掉）', () => {
    expect(toM3U([song({ duration: undefined })])).toContain('#EXTINF:-1,')
  })

  it('往返：解析回来能拿到歌手和曲名', () => {
    const parsed = parseM3U(toM3U([song()], '睡前'))
    expect(parsed).toHaveLength(1)
    expect(parsed[0]).toMatchObject({
      artist: '陈粒',
      title: '晚安',
      durationSeconds: 213,
      location: 'Chen Li/Xiao Meng Da Ban/01 晚安.flac',
    })
  })

  it('没有 #EXTINF 的裸路径列表也能解析', () => {
    const parsed = parseM3U('a/b.mp3\n\n# 注释\nc/d.flac\n')
    expect(parsed.map(e => e.location)).toEqual(['a/b.mp3', 'c/d.flac'])
  })

  it('#EXTINF 的元数据不会串到下一条', () => {
    const parsed = parseM3U('#EXTINF:100,A - B\nfirst.mp3\nsecond.mp3\n')
    expect(parsed[0].artist).toBe('A')
    expect(parsed[1].artist).toBeUndefined()
    expect(parsed[1].title).toBeUndefined()
  })
})

describe('XSPF', () => {
  it('转义 XML 元字符，输出仍可解析', () => {
    const text = toXSPF([song({ title: 'Rock & <Roll>', artist: 'A"B' })], 'Mix & Match')
    const parsed = parseXSPF(text)
    expect(parsed[0].title).toBe('Rock & <Roll>')
    expect(parsed[0].artist).toBe('A"B')
  })

  it('时长按毫秒写，解析回秒', () => {
    const parsed = parseXSPF(toXSPF([song()]))
    expect(parsed[0].durationSeconds).toBe(213)
  })

  it('坏 XML 返回空数组而不是抛错', () => {
    expect(parseXSPF('<playlist><trackList>')).toEqual([])
  })
})

describe('parsePlaylistFile', () => {
  it('按扩展名挑解析器', () => {
    expect(parsePlaylistFile('a.xspf', toXSPF([song()]))).toHaveLength(1)
    expect(parsePlaylistFile('a.m3u8', toM3U([song()]))).toHaveLength(1)
  })

  it('扩展名不对但内容是 XML 时也认得出来', () => {
    expect(parsePlaylistFile('a.txt', toXSPF([song()]))).toHaveLength(1)
  })
})

describe('matchEntriesToLibrary', () => {
  const library = [
    song({ id: 'a', path: 'Music/A/01.flac', title: 'One', artist: 'X' }),
    song({ id: 'b', path: 'Music/B/02.flac', title: 'Two', artist: 'Y' }),
  ]

  it('优先按完整路径对上', () => {
    const { matched, missing } = matchEntriesToLibrary(
      [{ location: 'Music/B/02.flac' }], library
    )
    expect(matched.map(s => s.id)).toEqual(['b'])
    expect(missing).toHaveLength(0)
  })

  it('库根目录变了也能靠文件名对上', () => {
    const { matched } = matchEntriesToLibrary(
      [{ location: '/mnt/new-root/whatever/01.flac' }], library
    )
    expect(matched.map(s => s.id)).toEqual(['a'])
  })

  it('跨库导入退回歌手加曲名', () => {
    const { matched } = matchEntriesToLibrary(
      [{ location: 'no/such/file.mp3', artist: 'Y', title: 'Two' }], library
    )
    expect(matched.map(s => s.id)).toEqual(['b'])
  })

  it('大小写不同仍然算对上', () => {
    const { matched } = matchEntriesToLibrary(
      [{ location: 'MUSIC/A/01.FLAC' }], library
    )
    expect(matched.map(s => s.id)).toEqual(['a'])
  })

  it('对不上的原样留在 missing 里', () => {
    const { matched, missing } = matchEntriesToLibrary(
      [{ location: 'gone.mp3', title: '没有的歌' }], library
    )
    expect(matched).toHaveLength(0)
    expect(missing[0].title).toBe('没有的歌')
  })
})

describe('history export', () => {
  const events: ListeningEvent[] = [{
    version: 2,
    eventId: 'e1',
    serverId: 'srv',
    song: song({ title: 'A, with comma', artist: 'He said "hi"' }),
    startedAt: 1_700_000_000_000,
    endedAt: 1_700_000_200_000,
    listenedSeconds: 200.4,
    completionRate: 0.94,
    outcome: 'completed',
  }]

  it('CSV 转义逗号和引号', () => {
    const lines = historyToCSV(events).trim().split('\n')
    expect(lines[0]).toContain('endedAt')
    expect(lines[1]).toContain('"A, with comma"')
    expect(lines[1]).toContain('"He said ""hi"""')
  })

  it('CSV 的秒数取整，不带浮点尾巴', () => {
    expect(historyToCSV(events)).toContain(',200,')
  })

  it('JSON 带上格式标识，便于将来识别版本', () => {
    const parsed = JSON.parse(historyToJSON(events, '2026-08-21T00:00:00.000Z'))
    expect(parsed.format).toBe('n1ko-music/listening-history')
    expect(parsed.count).toBe(1)
    expect(parsed.events[0].eventId).toBe('e1')
  })
})

describe('safeFileName', () => {
  it('去掉文件系统不接受的字符，首尾不留连字符', () => {
    expect(safeFileName('我的/歌单: "最爱"?')).toBe('我的-歌单- -最爱')
  })

  it('全是非法字符时给个兜底名', () => {
    expect(safeFileName('///')).toBe('playlist')
  })
})

describe('resolvePlaylistEntries', () => {
  const found = song({ id: 'hit', title: 'Two', artist: 'Y', path: 'Music/B/02.flac' })

  it('每条去问服务端搜索，不下载整个曲库', async () => {
    const queries: string[] = []
    const result = await resolvePlaylistEntries(
      [{ location: 'Music/B/02.flac', title: 'Two', artist: 'Y' }],
      async q => { queries.push(q); return [found] }
    )
    expect(queries).toEqual(['Two Y'])
    expect(result.matched.map(s => s.id)).toEqual(['hit'])
    expect(result.missing).toHaveLength(0)
  })

  it('相同查询只发一次', async () => {
    let calls = 0
    await resolvePlaylistEntries(
      Array.from({ length: 5 }, () => ({ location: 'x', title: 'Two', artist: 'Y' })),
      async () => { calls++; return [found] }
    )
    expect(calls).toBe(1)
  })

  it('没有元数据时退回用文件名去搜', async () => {
    const queries: string[] = []
    await resolvePlaylistEntries(
      [{ location: '/music/Some Song.flac' }],
      async q => { queries.push(q); return [] }
    )
    expect(queries).toEqual(['Some Song'])
  })

  it('搜索到的候选对不上就算 missing，不硬塞第一个结果', async () => {
    const result = await resolvePlaylistEntries(
      [{ location: 'nope.flac', title: 'Nothing Like It', artist: 'Z' }],
      async () => [found]
    )
    expect(result.matched).toHaveLength(0)
    expect(result.missing).toHaveLength(1)
  })

  it('单条查询抛错不会让整次导入垮掉', async () => {
    const result = await resolvePlaylistEntries(
      [
        { location: 'a', title: 'Boom', artist: 'Q' },
        { location: 'Music/B/02.flac', title: 'Two', artist: 'Y' },
      ],
      async q => { if (q.startsWith('Boom')) throw new Error('offline'); return [found] }
    )
    expect(result.matched.map(s => s.id)).toEqual(['hit'])
    expect(result.missing).toHaveLength(1)
  })

  it('超过上限的部分被截断并如实报数', async () => {
    const entries = Array.from({ length: MAX_IMPORT_ENTRIES + 7 }, (_, i) => ({
      location: `f${i}.flac`, title: `T${i}`,
    }))
    const result = await resolvePlaylistEntries(entries, async () => [])
    expect(result.truncated).toBe(7)
    expect(result.missing).toHaveLength(MAX_IMPORT_ENTRIES)
  })
})
