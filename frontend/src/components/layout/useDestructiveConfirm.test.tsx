/**
 * @vitest-environment happy-dom
 *
 * 阶段 1.7 回归：报头菜单的破坏性动作（切主库 / 断开）必须先过确认框。
 * 用户路径：点菜单项 → 出确认框（带后果说明）→ 确认后才执行。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { useDestructiveConfirm } from './useDestructiveConfirm'

let root: Root | null = null
const handleRef: { current: ReturnType<typeof useDestructiveConfirm> | null } = { current: null }
afterEach(() => {
  handleRef.current = null
  act(() => { root?.unmount() })
  root = null
  document.body.innerHTML = ''
})

import { useRef } from 'react'

/** 把 confirm 句柄经 ref 递出来（render 期赋值，测试立即可用） */
function Probe({ handleRef }: { handleRef: { current: ReturnType<typeof useDestructiveConfirm> | null } }) {
  const confirm = useDestructiveConfirm()
  handleRef.current = confirm
  return <div>{confirm.dialog}</div>
}

function mount() {
  const host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root!.render(<Probe handleRef={handleRef} />) })
}

describe('useDestructiveConfirm（1.7：报头动作先确认）', () => {
  it('request 后弹确认框；确认才执行动作', () => {
    const onConfirm = vi.fn()
    mount()
    const handle = handleRef.current!

    act(() => {
      handle.request({ title: '换成这个主库？', description: '后果说明', onConfirm })
    })
    // 对话框出现且带说明（Radix Portal 挂到 body 下）
    const dialog = document.querySelector('[role="dialog"]')!
    expect(dialog.textContent).toContain('换成这个主库？')
    expect(dialog.textContent).toContain('后果说明')
    expect(onConfirm).not.toHaveBeenCalled()

    // 点确认键（最后一个按钮）
    // [Cancel, 确认键, 自带 Close]——确认键是第 2 个
    const buttons = [...dialog.querySelectorAll('button')]
    act(() => { buttons[1].click() })
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('取消不执行动作', () => {
    const onConfirm = vi.fn()
    mount()
    act(() => { handleRef.current!.request({ title: '确认断开', onConfirm }) })
    const dialog = document.querySelector('[role="dialog"]')!
    const buttons = [...dialog.querySelectorAll('button')]
    act(() => { buttons[0].click() })
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
