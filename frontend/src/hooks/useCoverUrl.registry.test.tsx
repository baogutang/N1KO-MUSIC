/**
 * @vitest-environment happy-dom
 *
 * 冷启动时封面一直空白到换歌。
 *
 * 适配器注册表是模块级的普通 Map，不是 React 状态：冷启动时队列里的当前曲已经
 * 渲染出来了，而服务器还在后台连接（插件沙箱更是异步）——此刻 findAdapterFor
 * 返回 null，服务器封面为空。useCoverUrl 的 useMemo 依赖里没有任何「适配器注册了」
 * 的信号，之后适配器注册好了它也不重算，封面就空到换歌为止。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { useCoverUrl } from './useCoverUrl'
import { clearAdapter, registerAdapter, setPrimary, unregisterAdapter } from '@/api'
import type { MusicServerAdapter } from '@/api/types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** 只带 getCoverUrl 的适配器替身：注册表与 useCoverUrl 不关心别的 */
const stub = (host: string) =>
  ({ type: 'subsonic', getCoverUrl: (id: string) => `https://${host}/cover/${id}` }) as unknown as MusicServerAdapter

// 注意：target 必须是稳定引用（和真实场景一样，它来自 store 里持久化的当前曲）
const TARGET = { id: 's1', coverArt: 'ca1', serverId: 'srv' }
const TARGET_NO_SOURCE = { id: 's2', coverArt: 'ca2' }

let root: Root | null = null

function mount<T extends object>(target: T) {
  const result = { current: undefined as ReturnType<typeof useCoverUrl> | undefined }
  function Probe() {
    result.current = useCoverUrl(target)
    return null
  }
  root = createRoot(document.createElement('div'))
  act(() => root!.render(<Probe />))
  return result
}

beforeEach(() => clearAdapter())
afterEach(() => {
  act(() => root?.unmount())
  root = null
  clearAdapter()
})

describe('useCoverUrl 跟随适配器注册表', () => {
  it('冷启动：适配器晚于首次渲染注册，封面地址随之补上（此前一直是 undefined）', () => {
    const result = mount(TARGET)
    expect(result.current?.primary).toBeUndefined()

    act(() => registerAdapter('srv', stub('nas.local')))
    expect(result.current?.primary).toBe('https://nas.local/cover/ca1')
  })

  it('换适配器（比如换了服务器地址）后重算', () => {
    registerAdapter('srv', stub('old.local'))
    const result = mount(TARGET)
    expect(result.current?.primary).toBe('https://old.local/cover/ca1')

    act(() => {
      unregisterAdapter('srv')
      registerAdapter('srv', stub('new.local'))
    })
    expect(result.current?.primary).toBe('https://new.local/cover/ca1')
  })

  it('适配器断开后不再给出服务器封面', () => {
    registerAdapter('srv', stub('nas.local'))
    const result = mount(TARGET)
    expect(result.current?.primary).toBe('https://nas.local/cover/ca1')

    act(() => unregisterAdapter('srv'))
    expect(result.current?.primary).toBeUndefined()
  })

  it('没带来源的曲目跟着主库：主库设定好之后补上', () => {
    registerAdapter('srv', stub('nas.local'))
    const result = mount(TARGET_NO_SOURCE)
    expect(result.current?.primary).toBeUndefined()

    act(() => setPrimary('srv'))
    expect(result.current?.primary).toBe('https://nas.local/cover/ca2')
  })
})
