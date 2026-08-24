import { describe, it, expect, vi } from 'vitest'

// 让 useSyncExternalStore 直接返回当前快照，从而在非 React 环境里跑 useT()
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react')
  return {
    ...actual,
    useSyncExternalStore: (_sub: unknown, getSnapshot: () => unknown) => getSnapshot(),
  }
})

const { t, useT, setLocale } = await import('./index')

describe('hook 路径 vs 模块路径', () => {
  it('en-US count=1', () => {
    setLocale('en-US')
    const hookT = useT().t
    const rows = [
      'song.count', 'album.count', 'playlist.count', 'artist.albumCount',
      'artist.discographyCount', 'album.trackCount', 'playlist.songCount', 'song.trackCount',
    ].map(k => ({ key: k, module: t(k, { count: 1 }), hook: hookT(k, { count: 1 }) }))
    console.log(JSON.stringify(rows, null, 2))
    for (const r of rows) expect(r.hook, `${r.key}`).toBe(r.module)
  })
})
