import { describe, expect, it } from 'vitest'
import {
  parseHistoryFile, splitCsvLine, syntheticSongId, capImport, MAX_IMPORT_EVENTS,
} from './historyImport'

const SERVER = 'srv'
/** 2024-06-01T12:00:00Z */
const TS_MS = 1_717_243_200_000
const TS_S = TS_MS / 1000

describe('syntheticSongId', () => {
  it('同一首歌总是得到同一个 id——否则统计里会全是「只听过一次」', () => {
    expect(syntheticSongId('陈粒', '晚安')).toBe(syntheticSongId('陈粒', '晚安'))
  })

  it('大小写和首尾空白不影响归并', () => {
    expect(syntheticSongId(' The Beatles ', 'Help!')).toBe(syntheticSongId('the beatles', 'help!'))
  })

  it('不同歌得到不同 id', () => {
    expect(syntheticSongId('A', 'X')).not.toBe(syntheticSongId('A', 'Y'))
  })

  it('带前缀，永远不会和服务端 id 撞上', () => {
    expect(syntheticSongId('A', 'X').startsWith('import:')).toBe(true)
  })
})

describe('splitCsvLine', () => {
  it('认引号包裹的逗号', () => {
    expect(splitCsvLine('a,"b, still b",c')).toEqual(['a', 'b, still b', 'c'])
  })

  it('认字段内的转义引号', () => {
    expect(splitCsvLine('a,"he said ""hi""",c')).toEqual(['a', 'he said "hi"', 'c'])
  })

  it('空字段保留位置', () => {
    expect(splitCsvLine('a,,c')).toEqual(['a', '', 'c'])
  })
})

describe('本应用导出的 JSON', () => {
  const own = {
    format: 'n1ko-music/listening-history',
    version: 2,
    events: [{
      version: 2, eventId: 'e1', serverId: 'other',
      song: { id: 's1', title: '晚安', artist: '陈粒', duration: 213 },
      startedAt: TS_MS - 213_000, endedAt: TS_MS,
      listenedSeconds: 200, completionRate: 0.94, outcome: 'completed',
    }],
  }

  it('原样收下，不重算时长', () => {
    const result = parseHistoryFile(JSON.stringify(own), SERVER)!
    expect(result.source).toBe('n1ko')
    expect(result.events).toHaveLength(1)
    expect(result.events[0].listenedSeconds).toBe(200)
    expect(result.events[0].song.id).toBe('s1')
  })

  it('缺歌手或时间的条目被跳过并计数', () => {
    const broken = {
      ...own,
      events: [...own.events, { eventId: 'e2', song: { title: 'x' }, endedAt: TS_MS }],
    }
    const result = parseHistoryFile(JSON.stringify(broken), SERVER)!
    expect(result.events).toHaveLength(1)
    expect(result.skipped).toBe(1)
  })
})

describe('ListenBrainz 导出', () => {
  const listens = [{
    listened_at: TS_S,
    track_metadata: {
      artist_name: 'Marconi Union',
      track_name: 'Weightless',
      release_name: 'Ambient',
      additional_info: { duration_ms: 480_000 },
    },
  }]

  it('顶层数组认得出来', () => {
    const result = parseHistoryFile(JSON.stringify(listens), SERVER)!
    expect(result.source).toBe('listenbrainz')
    expect(result.events[0].song.artist).toBe('Marconi Union')
    expect(result.events[0].endedAt).toBe(TS_MS)
  })

  it('{ listens: [...] } 也认得出来', () => {
    const result = parseHistoryFile(JSON.stringify({ listens }), SERVER)!
    expect(result.source).toBe('listenbrainz')
  })

  it('带了时长就用真实时长', () => {
    expect(parseHistoryFile(JSON.stringify(listens), SERVER)!.events[0].song.duration).toBe(480)
  })

  it('没带时长时用默认值，而不是 0', () => {
    const bare = [{ listened_at: TS_S, track_metadata: { artist_name: 'A', track_name: 'B' } }]
    expect(parseHistoryFile(JSON.stringify(bare), SERVER)!.events[0].song.duration).toBeGreaterThan(0)
  })

  it('同一首歌的两次收听是两条，不会互相覆盖', () => {
    const twice = [
      { listened_at: TS_S, track_metadata: { artist_name: 'A', track_name: 'B' } },
      { listened_at: TS_S + 3600, track_metadata: { artist_name: 'A', track_name: 'B' } },
    ]
    const result = parseHistoryFile(JSON.stringify(twice), SERVER)!
    expect(new Set(result.events.map(e => e.eventId)).size).toBe(2)
    expect(new Set(result.events.map(e => e.song.id)).size).toBe(1)
  })
})

describe('CSV', () => {
  it('认本应用导出的表头', () => {
    const csv = [
      'endedAt,isoTime,title,artist,album,listenedSeconds,durationSeconds,outcome',
      `${TS_MS},2024-06-01T12:00:00.000Z,晚安,陈粒,小梦大半,200,213,completed`,
    ].join('\n')
    const result = parseHistoryFile(csv, SERVER)!
    expect(result.source).toBe('csv')
    expect(result.events[0].song.title).toBe('晚安')
    expect(result.events[0].song.duration).toBe(213)
  })

  it('认 Last.fm 导出工具常见的列名', () => {
    const csv = ['artist,album,track,utc_time', `A,Alb,B,${TS_S}`].join('\n')
    const result = parseHistoryFile(csv, SERVER)!
    expect(result.events[0].song.artist).toBe('A')
    expect(result.events[0].endedAt).toBe(TS_MS)
  })

  it('没有表头时按 artist,album,track,time 的常见列序猜，且不吞掉第一行', () => {
    const csv = [`A,Alb,B,${TS_S}`, `C,Alb2,D,${TS_S + 60}`].join('\n')
    const result = parseHistoryFile(csv, SERVER)!
    expect(result.events).toHaveLength(2)
  })

  it('ISO 时间串也解析', () => {
    const csv = ['artist,track,date', 'A,B,2024-06-01T12:00:00.000Z'].join('\n')
    expect(parseHistoryFile(csv, SERVER)!.events[0].endedAt).toBe(TS_MS)
  })

  it('时间不合理的行被跳过而不是产生 1970 年的记录', () => {
    const csv = ['artist,track,utc_time', 'A,B,0', 'C,D,not-a-date', `E,F,${TS_S}`].join('\n')
    const result = parseHistoryFile(csv, SERVER)!
    expect(result.events).toHaveLength(1)
    expect(result.skipped).toBe(2)
  })

  it('未来的时间戳也被跳过', () => {
    const future = Math.floor(Date.now() / 1000) + 30 * 86_400
    const csv = ['artist,track,utc_time', `A,B,${future}`].join('\n')
    expect(parseHistoryFile(csv, SERVER)).toBeNull()
  })
})

describe('识别失败', () => {
  it('认不出来的文件返回 null，不去硬解析', () => {
    expect(parseHistoryFile('这不是任何一种历史文件', SERVER)).toBeNull()
    expect(parseHistoryFile('{"nope": 1}', SERVER)).toBeNull()
    expect(parseHistoryFile('', SERVER)).toBeNull()
  })

  it('坏 JSON 不抛错', () => {
    expect(parseHistoryFile('{ broken', SERVER)).toBeNull()
  })
})

describe('capImport', () => {
  it('未超上限原样返回', () => {
    const result = { events: [], source: 'csv' as const, skipped: 0, truncated: 0 }
    expect(capImport(result)).toBe(result)
  })

  it('超上限时留最近的，并如实报出截断数', () => {
    const events = Array.from({ length: MAX_IMPORT_EVENTS + 3 }, (_, i) => ({
      endedAt: i,
    })) as never[]
    const capped = capImport({ events, source: 'csv', skipped: 0, truncated: 0 })
    expect(capped.events).toHaveLength(MAX_IMPORT_EVENTS)
    expect(capped.truncated).toBe(3)
    expect((capped.events[0] as unknown as { endedAt: number }).endedAt)
      .toBe(MAX_IMPORT_EVENTS + 2)
  })
})
