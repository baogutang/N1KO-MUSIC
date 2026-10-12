/**
 * @vitest-environment happy-dom
 *
 * 阶段 2.1 回归：query 失败时看到的是带重试的错误态，
 * 不是「创建第一个歌单 / 没有名字相符的歌手」这类空态文案。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { ErrorState } from '@/components/common/ErrorState'
import { EmptyState } from '@/components/common/EmptyState'

let root: Root | null = null
afterEach(() => {
  act(() => { root?.unmount() })
  root = null
  document.body.innerHTML = ''
})

function mount(node: React.ReactElement) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root!.render(node) })
}

describe('错误态与空态可辨（阶段 2.1）', () => {
  it('ErrorState 渲染重试按钮（locale 无关：按钮一定存在）', () => {
    mount(<ErrorState retry={() => undefined} />)
    // 错误态一定有重试按钮（en: Retry / zh: 重试）
    const retry = [...document.querySelectorAll('button')]
      .find(b => /重试|Retry/i.test(b.textContent ?? ''))
    expect(retry).toBeTruthy()
  })

  it('ErrorState 的标题与 EmptyState 的标题是两套词', () => {
    const titles: string[] = []
    mount(<EmptyState title="SENTINEL_EMPTY" ruled />)
    titles.push(document.body.textContent ?? '')
    document.body.innerHTML = ''
    mount(<ErrorState />)
    titles.push(document.body.textContent ?? '')
    // ErrorState 用的词条（error.load.title）不包含空态的自定义标题
    expect(titles[1]).not.toContain('SENTINEL_EMPTY')
    // 两个态的渲染结果不同（不是同一个词条）
    expect(titles[0]).not.toBe(titles[1])
  })
})
