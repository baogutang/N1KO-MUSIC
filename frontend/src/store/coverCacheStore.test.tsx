/**
 * @vitest-environment happy-dom
 *
 * 钉住的封面（用户在歌曲详情页手动选定的本地封面）。
 *
 * 两个要钉住的点：
 * - 钉住 / 移除后，所有用到它的封面要立刻刷新（此前订阅的是引用永不变的 getCover，
 *   store 更新时 useMemo 不重算，界面纹丝不动）；
 * - 键要带歌曲自己的音源：多音源下两个源可能有相同的歌曲 id，
 *   不能互相串封面；旧版（裸 songId / 主库前缀）的数据照旧能读。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { useCoverCacheStore } from './coverCacheStore'
import { useServerStore } from './serverStore'
import { usePinnedCover } from '@/hooks/useCoverUrl'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const store = () => useCoverCacheStore.getState()

beforeEach(() => {
  useCoverCacheStore.setState({ cache: {} })
  useServerStore.setState({ activeServerId: 'A' } as never)
})

describe('coverCacheStore：键带音源', () => {
  it('新钉住的封面用 `${serverId}:${songId}` 作键，serverId 取歌曲自己的音源', () => {
    store().saveCover('s1', 'https://pin/b.jpg', 'B')
    expect(Object.keys(store().cache)).toEqual(['B:s1'])
  })

  it('不传音源时回落当前主库（旧调用兼容）', () => {
    store().saveCover('s1', 'https://pin/a.jpg')
    expect(Object.keys(store().cache)).toEqual(['A:s1'])
  })

  it('两个音源同 id 的歌互不串封面', () => {
    store().saveCover('s1', 'https://pin/a.jpg', 'A')
    store().saveCover('s1', 'https://pin/b.jpg', 'B')
    expect(store().getCover('s1', 'A')).toBe('https://pin/a.jpg')
    expect(store().getCover('s1', 'B')).toBe('https://pin/b.jpg')
    expect(store().getCover('s1', 'C')).toBeNull()
  })

  it('非主库音源的歌钉住后，主库同 id 的歌不会看到它', () => {
    // 主库是 A；B 源的 s1 钉住时此前会落在 `A:s1` 名下，与 A 自己的 s1 撞键
    store().saveCover('s1', 'https://pin/b.jpg', 'B')
    expect(store().getCover('s1', 'A')).toBeNull()
    expect(store().getCover('s1')).toBeNull()
  })

  it('旧版裸 songId 键照旧能读（不迁移、不删旧数据）', () => {
    useCoverCacheStore.setState({
      cache: { s1: { url: 'https://pin/legacy.jpg', savedAt: 1 } },
    })
    expect(store().getCover('s1', 'B')).toBe('https://pin/legacy.jpg')
    // 读取不改动盘上的数据
    expect(Object.keys(store().cache)).toEqual(['s1'])
  })

  it('带音源的键优先于旧版裸键', () => {
    useCoverCacheStore.setState({
      cache: {
        s1: { url: 'https://pin/legacy.jpg', savedAt: 1 },
        'B:s1': { url: 'https://pin/new.jpg', savedAt: 2 },
      },
    })
    expect(store().getCover('s1', 'B')).toBe('https://pin/new.jpg')
  })

  it('移除时带音源的键与旧版裸键一起清（否则旧键会让封面「移除不掉」）', () => {
    useCoverCacheStore.setState({
      cache: {
        s1: { url: 'https://pin/legacy.jpg', savedAt: 1 },
        'B:s1': { url: 'https://pin/new.jpg', savedAt: 2 },
        'B:s2': { url: 'https://pin/other.jpg', savedAt: 3 },
      },
    })
    store().removeCover('s1', 'B')
    expect(store().getCover('s1', 'B')).toBeNull()
    expect(store().getCover('s2', 'B')).toBe('https://pin/other.jpg')
  })
})

describe('usePinnedCover：钉住 / 移除后界面立刻刷新', () => {
  let root: Root | null = null
  afterEach(() => {
    act(() => root?.unmount())
    root = null
  })

  function mount(songId: string | undefined, serverId?: string) {
    const result = { current: undefined as string | null | undefined, renders: 0 }
    function Probe() {
      result.current = usePinnedCover(songId, serverId)
      result.renders++
      return null
    }
    root = createRoot(document.createElement('div'))
    act(() => root!.render(<Probe />))
    return result
  }

  it('钉住后马上读到新封面', () => {
    const result = mount('s1', 'B')
    expect(result.current).toBeNull()

    act(() => store().saveCover('s1', 'https://pin/b.jpg', 'B'))
    expect(result.current).toBe('https://pin/b.jpg')
  })

  it('移除后马上回到 null', () => {
    store().saveCover('s1', 'https://pin/b.jpg', 'B')
    const result = mount('s1', 'B')
    expect(result.current).toBe('https://pin/b.jpg')

    act(() => store().removeCover('s1', 'B'))
    expect(result.current).toBeNull()
  })

  it('换了封面（再次钉住）也立刻更新', () => {
    store().saveCover('s1', 'https://pin/old.jpg', 'B')
    const result = mount('s1', 'B')

    act(() => store().saveCover('s1', 'https://pin/new.jpg', 'B'))
    expect(result.current).toBe('https://pin/new.jpg')
  })

  it('别的歌被钉住 / 移除时，这一张不重渲染', () => {
    const result = mount('s1', 'B')
    const before = result.renders

    act(() => store().saveCover('other', 'https://pin/x.jpg', 'B'))
    act(() => store().removeCover('other', 'B'))
    expect(result.renders).toBe(before)
  })

  it('读取兼容旧版裸 id 键', () => {
    useCoverCacheStore.setState({ cache: { s1: { url: 'https://pin/legacy.jpg', savedAt: 1 } } })
    expect(mount('s1', 'B').current).toBe('https://pin/legacy.jpg')
  })

  it('未传 songId 时恒为 null', () => {
    expect(mount(undefined).current).toBeNull()
  })
})
