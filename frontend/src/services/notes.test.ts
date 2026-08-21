import { describe, expect, it, beforeEach, vi } from 'vitest'

const store = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => { store.set(key, value) },
  removeItem: (key: string) => { store.delete(key) },
})

/** 同步层被替换掉：这个文件验的是合并逻辑，不是 HTTP */
const remoteNotes: Array<Record<string, unknown>> = []
const pushed: Array<Record<string, unknown>> = []
const removed: string[] = []
/** fetchRemoteNotes 解析前先跑一次，用来模拟「请求在飞的时候用户动了手」 */
let duringFetch: (() => void) | null = null

vi.mock('@/api/syncClient', () => ({
  fetchRemoteNotes: vi.fn(async () => {
    duringFetch?.()
    duringFetch = null
    return remoteNotes
  }),
  pushNote: vi.fn(async (_url: string, _token: string, note: Record<string, unknown>) => {
    pushed.push(note)
  }),
  removeRemoteNote: vi.fn(async (
    _url: string, _token: string, type: string, id: string, serverId: string,
  ) => { removed.push(`${serverId}:${type}:${id}`) }),
}))

vi.mock('@/store/syncStore', () => ({
  useSyncStore: {
    getState: () => ({ enabled: true, baseUrl: 'https://sync.test', token: 'tok' }),
  },
}))

const { saveNote, deleteNote, readNote, syncNotes } = await import('./notes')

beforeEach(() => {
  store.clear()
  remoteNotes.length = 0
  pushed.length = 0
  removed.length = 0
  duringFetch = null
})

describe('时间戳粒度', () => {
  /**
   * 服务端的 updated_at 是整秒，拉回来乘 1000。本地若用毫秒精度，
   * 刚推上去的那条永远「比服务端新」，于是每轮同步都重推一次。
   */
  it('写入的时间戳对齐到整秒，和服务端同粒度', () => {
    const note = saveNote('song', 's1', 'srv', '一句话', 1_700_000_000_777)!
    expect(note.updatedAt).toBe(1_700_000_000_000)
    expect(note.createdAt).toBe(1_700_000_000_000)
  })

  it('删除的墓碑时间戳同样对齐', () => {
    saveNote('song', 's1', 'srv', '一句话', 1_700_000_000_000)
    deleteNote('song', 's1', 'srv', 1_700_000_009_999)
    const raw = JSON.parse(store.get('msp-notes')!)
    expect(raw['srv:song:s1'].updatedAt).toBe(1_700_000_009_000)
  })

  it('服务端回来的同一条不会被无限重推', async () => {
    saveNote('song', 's1', 'srv', '一句话', 1_700_000_000_500)
    pushed.length = 0
    // 服务端记的是同一秒
    remoteNotes.push({
      targetType: 'song', targetId: 's1', serverId: 'srv',
      body: '一句话', createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_000,
    })
    await syncNotes()
    expect(pushed).toHaveLength(0)
  })
})

describe('对账期间的并发写入', () => {
  it('请求在飞的时候写下的边注不会被旧快照抹掉', async () => {
    duringFetch = () => { saveNote('album', 'a1', 'srv', '刚写的', 1_700_000_100_000) }
    await syncNotes()
    expect(readNote('album', 'a1', 'srv')?.body).toBe('刚写的')
  })

  it('请求在飞的时候删掉的边注不会复活', async () => {
    saveNote('song', 's1', 'srv', '要删掉的', 1_700_000_000_000)
    duringFetch = () => { deleteNote('song', 's1', 'srv', 1_700_000_100_000) }
    // 服务端还持有删除前的那一版
    remoteNotes.push({
      targetType: 'song', targetId: 's1', serverId: 'srv',
      body: '要删掉的', createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_000,
    })
    await syncNotes()
    expect(readNote('song', 's1', 'srv')).toBeNull()
    // 而且这条删除要推出去，否则另一台设备下次又把它推回来
    expect(removed).toContain('srv:song:s1')
  })
})

describe('合并规则', () => {
  it('服务端更新的版本覆盖本地', async () => {
    saveNote('song', 's1', 'srv', '旧的', 1_700_000_000_000)
    remoteNotes.push({
      targetType: 'song', targetId: 's1', serverId: 'srv',
      body: '新的', createdAt: 1_700_000_000_000, updatedAt: 1_700_000_050_000,
    })
    await syncNotes()
    expect(readNote('song', 's1', 'srv')?.body).toBe('新的')
  })

  it('本地更新的推上去', async () => {
    saveNote('song', 's1', 'srv', '本地更新', 1_700_000_050_000)
    pushed.length = 0
    remoteNotes.push({
      targetType: 'song', targetId: 's1', serverId: 'srv',
      body: '服务端的旧版', createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_000,
    })
    await syncNotes()
    expect(pushed.map(n => n.body)).toEqual(['本地更新'])
  })

  it('本地没有的从服务端拉下来', async () => {
    remoteNotes.push({
      targetType: 'artist', targetId: 'x1', serverId: 'srv',
      body: '别的设备写的', createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_000,
    })
    await syncNotes()
    expect(readNote('artist', 'x1', 'srv')?.body).toBe('别的设备写的')
  })
})

describe('本地优先', () => {
  it('写入立刻落盘，不等服务端', () => {
    saveNote('song', 's1', 'srv', '立刻可读', 1_700_000_000_000)
    expect(readNote('song', 's1', 'srv')?.body).toBe('立刻可读')
  })

  it('空白内容不产生边注', () => {
    expect(saveNote('song', 's1', 'srv', '   ', 1_700_000_000_000)).toBeNull()
  })

  it('复活一条删掉的边注时，写作时间重置为这一次', () => {
    saveNote('song', 's1', 'srv', '第一版', 1_700_000_000_000)
    deleteNote('song', 's1', 'srv', 1_700_000_010_000)
    const revived = saveNote('song', 's1', 'srv', '重新写的', 1_700_000_020_000)!
    expect(revived.createdAt).toBe(1_700_000_020_000)
  })
})
