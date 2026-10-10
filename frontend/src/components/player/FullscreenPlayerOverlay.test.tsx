/**
 * @vitest-environment happy-dom
 *
 * 阶段 1.7 回归：全屏播放器是一个真正的对话框。
 *
 * 用户真实路径：
 *  - 打开全屏播放器后按 Esc —— 必须关掉（原先 Esc 无效，F17）；
 *  - 打开后按 Tab —— 焦点必须留在浮层内（原先 Tab 穿透到底下页面）；
 *  - 浮层外的内容对读屏不可见（背景 inert / aria-hidden）。
 *
 * 重型内容（FullscreenPlayer 本体）mock 掉——这里考的是外壳的对话框语义。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

vi.mock('@/components/player/FullscreenPlayer', () => ({ FullscreenPlayer: () => null }))
vi.mock('@/components/player/CarMode', () => ({ CarMode: () => null }))

import { FullscreenPlayerOverlay } from './FullscreenPlayerOverlay'
import { usePlayerStore } from '@/store/playerStore'

let root: Root | null = null
const mount = async () => {
  const host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(<FullscreenPlayerOverlay />)
  })
}

afterEach(async () => {
  await act(async () => {
    root?.unmount()
  })
  root = null
  document.body.innerHTML = ''
  usePlayerStore.setState({ isFullscreen: false, isCarMode: false })
})

describe('FullscreenPlayerOverlay 对话框语义（阶段 1.7）', () => {
  it('打开时有 role=dialog 且带名称（Radix 以外部 aria-hidden 表达模态，不设 aria-modal）', async () => {
    usePlayerStore.setState({ isFullscreen: true })
    await mount()

    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog).not.toBeNull()
    expect(dialog?.getAttribute('data-state')).toBe('open')
    expect(dialog?.getAttribute('aria-label')).toBeTruthy()
  })

  it('按 Esc 关闭全屏播放器（原先 Esc 无效）', async () => {
    usePlayerStore.setState({ isFullscreen: true })
    await mount()

    expect(usePlayerStore.getState().isFullscreen).toBe(true)
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })

    expect(usePlayerStore.getState().isFullscreen).toBe(false)
  })

  it('打开时浮层外的内容被 aria-hidden（读屏不念底下的页面）', async () => {
    const underneath = document.createElement('main')
    underneath.setAttribute('data-testid', 'page-under')
    document.body.appendChild(underneath)

    usePlayerStore.setState({ isFullscreen: true })
    await mount()

    expect(underneath.getAttribute('aria-hidden')).toBe('true')
  })
})

describe('Radix Dialog Title（复审 B12）', () => {
  it('全屏播放器带视觉隐藏的 Title，不再触发 Missing Title 警告', async () => {
    usePlayerStore.setState({ isFullscreen: true })
    await mount()

    const dialog = document.querySelector('[role="dialog"]')!
    // Radix 会把 aria-labelledby 指向 Title 元素
    const labelledby = dialog.getAttribute('aria-labelledby')
    expect(labelledby).toBeTruthy()
    const title = document.getElementById(labelledby!)
    expect(title?.textContent).toBeTruthy()
    // Description 显式置空：不挂多余的 aria-describedby
    expect(dialog.getAttribute('aria-describedby')).toBeNull()
  })
})
