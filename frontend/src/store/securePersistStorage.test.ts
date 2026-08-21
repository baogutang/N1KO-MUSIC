import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * 用一个可预测的假密钥替掉 Web Crypto：这里要验的是「哪些字段被封起来、
 * 明文有没有被抹掉、解不开时怎么办」，不是 AES-GCM 本身。
 */
const sealed = new Map<string, string>()
let keyAvailable = true

vi.mock('@/services/deviceKey', () => ({
  sealText: vi.fn(async (plain: string) => {
    if (!keyAvailable) return null
    const id = `c${sealed.size}`
    sealed.set(id, plain)
    // iv 每次都不同，模拟真实密文「内容没变但字节不同」的性质
    return { iv: `iv-${id}-${Math.round(performance.now() * 1000)}`, data: id }
  }),
  openText: vi.fn(async (payload: { data: string }) => sealed.get(payload.data) ?? null),
}))

const store = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => { store.set(key, value) },
  removeItem: (key: string) => { store.delete(key) },
})

const { createSecurePersistStorage } = await import('./securePersistStorage')

interface Shape {
  servers: Array<{ id: string; token: string; salt?: string; name: string }>
  activeServerId: string | null
}

function makeStorage() {
  return createSecurePersistStorage<Shape>({
    collect: state => state.servers.flatMap(server => [
      ...(server.token ? [[`${server.id}:token`, server.token] as [string, string]] : []),
      ...(server.salt ? [[`${server.id}:salt`, server.salt] as [string, string]] : []),
    ]),
    apply: (state, values) => ({
      ...state,
      servers: state.servers.map(server => {
        const token = values.get(`${server.id}:token`)
        const salt = values.get(`${server.id}:salt`)
        return {
          ...server,
          ...(token !== undefined ? { token } : {}),
          ...(salt !== undefined ? { salt } : {}),
        }
      }),
    }),
  })
}

const state: Shape = {
  servers: [{ id: 's1', name: 'Home', token: 'secret-token', salt: 'pepper' }],
  activeServerId: 's1',
}

beforeEach(() => {
  sealed.clear()
  store.clear()
  keyAvailable = true
})

describe('createSecurePersistStorage', () => {
  it('落盘的是密文，明文一个字都不留在 localStorage 里', async () => {
    const storage = makeStorage()
    await storage.setItem('k', { state, version: 0 })

    const raw = store.get('k')!
    expect(raw).not.toContain('secret-token')
    expect(raw).not.toContain('pepper')
    expect(JSON.parse(raw).state.servers[0].token).toBe('')
    expect(Object.keys(JSON.parse(raw).state.__secure)).toEqual(['s1:token', 's1:salt'])
  })

  it('非敏感字段照常明文保存，不影响调试和迁移', async () => {
    const storage = makeStorage()
    await storage.setItem('k', { state, version: 0 })
    const parsed = JSON.parse(store.get('k')!)
    expect(parsed.state.servers[0].name).toBe('Home')
    expect(parsed.state.activeServerId).toBe('s1')
  })

  it('读回来能还原成原样', async () => {
    const storage = makeStorage()
    await storage.setItem('k', { state, version: 0 })
    const restored = await storage.getItem('k')
    expect(restored!.state.servers[0].token).toBe('secret-token')
    expect(restored!.state.servers[0].salt).toBe('pepper')
  })

  it('升级前写下的明文照样读得出来，不会把人踢下线', async () => {
    store.set('k', JSON.stringify({ state, version: 0 }))
    const restored = await makeStorage().getItem('k')
    expect(restored!.state.servers[0].token).toBe('secret-token')
  })

  it('解不开时当作没有凭据，而不是抛错白屏', async () => {
    const storage = makeStorage()
    await storage.setItem('k', { state, version: 0 })
    sealed.clear() // 模拟换了设备 / 清过 IndexedDB
    const restored = await storage.getItem('k')
    expect(restored!.state.servers[0].token).toBe('')
  })

  it('内容没变就复用上一次的密文，不会每次写盘都重新加密', async () => {
    const { sealText } = await import('@/services/deviceKey')
    const storage = makeStorage()
    await storage.setItem('k', { state, version: 0 })
    const callsAfterFirst = vi.mocked(sealText).mock.calls.length
    await storage.setItem('k', { state, version: 0 })
    expect(vi.mocked(sealText).mock.calls.length).toBe(callsAfterFirst)
  })

  it('凭据变了就重新加密', async () => {
    const { sealText } = await import('@/services/deviceKey')
    const storage = makeStorage()
    await storage.setItem('k', { state, version: 0 })
    const before = vi.mocked(sealText).mock.calls.length
    await storage.setItem('k', {
      state: { ...state, servers: [{ ...state.servers[0], token: 'rotated' }] },
      version: 0,
    })
    expect(vi.mocked(sealText).mock.calls.length).toBeGreaterThan(before)
    expect(store.get('k')).not.toContain('rotated')
  })

  it('设备密钥不可用时退回明文——连不上服务器比存明文更糟', async () => {
    keyAvailable = false
    const storage = makeStorage()
    await storage.setItem('k', { state, version: 0 })
    expect(JSON.parse(store.get('k')!).state.servers[0].token).toBe('secret-token')
  })

  it('没有凭据可封时不写出空的 __secure 之外的东西', async () => {
    const storage = makeStorage()
    await storage.setItem('k', {
      state: { servers: [{ id: 's1', name: 'Home', token: '' }], activeServerId: null },
      version: 0,
    })
    expect(JSON.parse(store.get('k')!).state.__secure).toEqual({})
  })

  it('没存过的键返回 null', async () => {
    expect(await makeStorage().getItem('nope')).toBeNull()
  })
})
