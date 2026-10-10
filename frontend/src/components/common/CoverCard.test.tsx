/**
 * @vitest-environment happy-dom
 *
 * 复审 A6 回归：封面卡根节点监听 Enter/Space，但内层控件（播放键、
 * 菜单项）按键冒泡上来时不能被卡片截走——否则按的是播放键，
 * 发生的却是「跳转详情页」。
 */
import { describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { CoverCard } from '@/components/common/CoverCard'

function mount(card: React.ReactElement): HTMLDivElement {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => { root.render(card) })
  return host
}

function keyDown(el: Element, key: string) {
  act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
  })
}

describe('CoverCard 键盘（A6：内层控件不冒泡接管）', () => {
  it('根节点聚焦时 Enter 激活卡片', () => {
    const onClick = vi.fn()
    const host = mount(
      <CoverCard onClick={onClick} tile={<img alt="" />} title="T" />
    )
    const card = host.querySelector('[role="button"]')!
    keyDown(card, 'Enter')
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('内层按钮的 Enter/Space 不触发卡片跳转（也不被 preventDefault 吞掉）', () => {
    const onClick = vi.fn()
    const host = mount(
      <CoverCard
        onClick={onClick}
        tile={<img alt="" />}
        title="T"
        overlay={<button type="button">播放</button>}
      />
    )
    const inner = host.querySelector('button')!
    keyDown(inner, 'Enter')
    keyDown(inner, ' ')
    expect(onClick).not.toHaveBeenCalled()
  })
})
