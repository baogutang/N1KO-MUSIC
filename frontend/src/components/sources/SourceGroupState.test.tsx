/**
 * @vitest-environment happy-dom
 *
 * 复审 B11：频控倒计时行必须「活」——秒数每秒递减，退避到点自动
 * invalidate 该源查询并把自己卸掉（此前只渲染一次、文案写着自动恢复
 * 却永远不动）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RateLimitedRow } from './SourceGroupState'
import { rateBackoffUntil } from '@/plugins/host/PluginHost'

let root: Root | null = null
afterEach(() => {
  act(() => { root?.unmount() })
  root = null
  document.body.innerHTML = ''
  rateBackoffUntil.clear()
})

function mount(client: QueryClient, seconds: number) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => {
    root!.render(
      <QueryClientProvider client={client}>
        <RateLimitedRow serverId="srv-rate" initialSeconds={seconds} />
      </QueryClientProvider>
    )
  })
}

describe('RateLimitedRow（B11：倒计时 + 到点自动恢复）', () => {
  it('秒数递减；退避结束后 invalidate 该源全部查询', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const client = new QueryClient()
      const invalidateSpy = vi.fn()
      client.invalidateQueries = invalidateSpy

      rateBackoffUntil.set('srv-rate', Date.now() + 3_000)
      mount(client, 3)

      const row = () => document.querySelector('[role="status"]') as HTMLElement
      expect(row()).toBeTruthy()
      expect(row().textContent).toMatch(/3/)

      // 走 2 秒：秒数应变化
      act(() => { vi.advanceTimersByTime(2_000) })
      expect(row().textContent).not.toMatch(/3 秒/)

      // 退避到期：tick 里发现 remaining<=0 → invalidate
      rateBackoffUntil.set('srv-rate', Date.now() - 1)
      act(() => { vi.advanceTimersByTime(1_100) })
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['srv-rate'] })
    } finally {
      vi.useRealTimers()
    }
  })
})
