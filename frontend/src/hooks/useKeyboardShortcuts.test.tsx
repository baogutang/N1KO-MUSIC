/**
 * @vitest-environment happy-dom
 *
 * 复审 A1 回归：全屏播放器改成 role=dialog 后被全局快捷键的
 * 「模态对话框让位」判定命中——全屏时空格、方向键全部失效。
 *
 * 用户真实路径：打开全屏播放器，按空格 → 必须仍然切换播放/暂停；
 * 打开真正的模态卡片（如清空确认）→ 快捷键让位。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { useKeyboardShortcuts, isDialogOpen } from './useKeyboardShortcuts'
import { usePlayerStore } from '@/store/playerStore'

const isNative = await import('@/lib/platform').then(m => m.isNativePlatform)

function Probe() {
  useKeyboardShortcuts()
  return null
}

let root: Root | null = null
afterEach(() => {
  document.body.innerHTML = ''
  root = null
})

function mountProbe() {
  const host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root!.render(<Probe />) })
}

function pressSpace() {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true }))
  })
}

describe('isDialogOpen（A1：全屏播放器不算模态）', () => {
  it('裸 role=dialog 命中；带 data-fullscreen-player 的不命中', () => {
    const modal = document.createElement('div')
    modal.setAttribute('role', 'dialog')
    document.body.appendChild(modal)
    expect(isDialogOpen()).toBe(true)
    modal.remove()

    const fullscreen = document.createElement('div')
    fullscreen.setAttribute('role', 'dialog')
    fullscreen.setAttribute('data-fullscreen-player', '')
    document.body.appendChild(fullscreen)
    expect(isDialogOpen()).toBe(false)
  })
})

describe('全屏播放器下空格仍切播放（A1）', () => {
  it.skipIf(isNative)('role=dialog[data-fullscreen-player] 打开时 Space 调 togglePlay', () => {
    const togglePlay = vi.fn()
    usePlayerStore.setState({
      currentSong: { id: 's1', title: 'T', artist: 'A', album: 'AL', duration: 200, serverId: 'srv' },
      togglePlay,
    } as never)
    mountProbe()

    const fullscreen = document.createElement('div')
    fullscreen.setAttribute('role', 'dialog')
    fullscreen.setAttribute('data-fullscreen-player', '')
    document.body.appendChild(fullscreen)

    pressSpace()
    expect(togglePlay).toHaveBeenCalledTimes(1)
  })

  it.skipIf(isNative)('普通模态 dialog 打开时 Space 不触发（原有行为不回归）', () => {
    const togglePlay = vi.fn()
    usePlayerStore.setState({
      currentSong: { id: 's1', title: 'T', artist: 'A', album: 'AL', duration: 200, serverId: 'srv' },
      togglePlay,
    } as never)
    mountProbe()

    const modal = document.createElement('div')
    modal.setAttribute('role', 'alertdialog')
    document.body.appendChild(modal)

    pressSpace()
    expect(togglePlay).not.toHaveBeenCalled()
  })
})
