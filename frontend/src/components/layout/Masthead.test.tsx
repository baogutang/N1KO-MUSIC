/**
 * @vitest-environment happy-dom
 *
 * 复核 F6 回归：报头服务器菜单的「设为主库」候选要滤掉插件行与当前主库。
 * 用户路径：点报头的服务器下拉 → 菜单里只有「可切过去的」NAS 服务器；
 * 点另一台 → 出确认框 → 确认后才真正切换。
 * （此前：插件行也提供「设为主库」、点当前主库也弹确认。）
 */
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'

// Radix 菜单在 happy-dom 里需要的指针 API
beforeEach(() => {
  window.HTMLElement.prototype.hasPointerCapture = () => false
  window.HTMLElement.prototype.setPointerCapture = () => undefined
  window.HTMLElement.prototype.releasePointerCapture = () => undefined
})

const { activateServer } = vi.hoisted(() => ({ activateServer: vi.fn(async () => true) }))

import { Masthead } from './Masthead'
import { useServerStore } from '@/store/serverStore'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

let root: Root | null = null
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
})
beforeEach(() => {
  useServerStore.setState({
    activeServerId: 'nas1',
    connectedServerIds: ['nas1', 'nas2', 'wy'],
    isConnected: true,
    servers: [
      { id: 'nas1', name: '客厅NAS', type: 'subsonic', url: 'http://a' },
      { id: 'nas2', name: '书房NAS', type: 'navidrome', url: 'http://b' },
      { id: 'wy', name: '网易云', type: 'plugin', pluginId: 'netease' } as never,
    ],
    activateServer,
  } as never)
  const host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => {
    root!.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter><Masthead /></MemoryRouter>
      </QueryClientProvider>
    )
  })
})
afterEach(() => {
  act(() => { root?.unmount() })
  root = null
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

async function flush(times = 6) {
  for (let i = 0; i < times; i++) {
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
  }
}

function openServerMenu() {
  const trigger = document.querySelector('button[aria-label]') as HTMLButtonElement
  expect(trigger, '报头有服务器菜单触发键').toBeTruthy()
  act(() => {
    trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    trigger.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

describe('报头服务器菜单（F6）', () => {
  it('插件行与当前主库不提供「设为主库」；点其它库先确认', { timeout: 20_000 }, async () => {
    openServerMenu()
    await flush()

    const menu = document.querySelector('[role="menu"]')
    expect(menu, '菜单已打开').toBeTruthy()
    const items = [...menu!.querySelectorAll('[role="menuitem"]')].map(i => i.textContent ?? '')
    const switchRows = items.filter(text => /书房NAS/.test(text))
    expect(switchRows, '另一台 NAS 在候选里').toHaveLength(1)
    expect(items.some(text => /网易云/.test(text)), '插件行不在「设为主库」候选里').toBe(false)
    expect(items.some(text => /客厅NAS/.test(text)), '当前主库不在候选里（点它不该弹确认）').toBe(false)

    // 点书房NAS → 确认框（不是直接切）
    const row = [...menu!.querySelectorAll('[role="menuitem"]')].find(i => /书房NAS/.test(i.textContent ?? ''))!
    act(() => { row.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await flush()
    expect(activateServer, '确认前不切换').not.toHaveBeenCalled()
    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog, '弹出确认框').toBeTruthy()
    expect(dialog!.textContent).toMatch(/书房NAS/)

    // 确认 → 才切换
    const confirmBtn = [...dialog!.querySelectorAll('button')].find(b => /切换|Switch/i.test(b.textContent ?? ''))
    expect(confirmBtn, '确认键存在').toBeTruthy()
    act(() => { confirmBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await flush()
    expect(activateServer).toHaveBeenCalledWith('nas2')
  })
})
