/**
 * @vitest-environment happy-dom
 *
 * 钉住的封面要真的反映到封面组件上：组件走的是 usePinnedCover，
 * 钉住 / 移除后 <img> 的地址要立刻跟着变（此前 store 更新后界面纹丝不动）。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CoverImage } from './CoverImage'
import { useCoverCacheStore } from '@/store/coverCacheStore'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const SERVER = 'https://server.test/cover.jpg'
const PINNED = 'https://pin.test/mine.jpg'

let root: Root | null = null
let host: HTMLElement

beforeEach(() => {
  useCoverCacheStore.setState({ cache: {} })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root?.unmount())
  root = null
  host.remove()
})

function mount(songServerId: string) {
  act(() => {
    root!.render(
      <QueryClientProvider client={new QueryClient()}>
        <CoverImage eager primary={SERVER} songId="s1" songServerId={songServerId} />
      </QueryClientProvider>
    )
  })
}
const imgSrc = () => host.querySelector('img')?.getAttribute('src')

describe('CoverImage 的钉住封面', () => {
  it('钉住后立刻换成钉住的封面，移除后回到服务器封面', () => {
    mount('B')
    expect(imgSrc()).toBe(SERVER)

    act(() => useCoverCacheStore.getState().saveCover('s1', PINNED, 'B'))
    expect(imgSrc()).toBe(PINNED)

    act(() => useCoverCacheStore.getState().removeCover('s1', 'B'))
    expect(imgSrc()).toBe(SERVER)
  })

  it('另一个音源上同 id 的歌被钉住，不影响这一张', () => {
    mount('B')
    act(() => useCoverCacheStore.getState().saveCover('s1', PINNED, 'A'))
    expect(imgSrc()).toBe(SERVER)
  })
})
