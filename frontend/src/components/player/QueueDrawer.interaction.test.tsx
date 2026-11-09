/**
 * @vitest-environment happy-dom
 *
 * 队列抽屉的两组交互：
 *  - 排序控件按「输入方式」选，而不是按窗口宽度：iPad 竖屏（宽 ≥ 600 但手指操作）
 *    原先既没有上移 / 下移键、HTML5 拖拽又不触发，根本没法排序；
 *  - 窄屏的底部弹层是一个对话框（role=dialog、aria-modal、有名字），
 *    打开时焦点进去、Esc 关闭、关闭后焦点回到打开它的按钮；顶上的把手真的能往下拖收起。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const { adapter } = vi.hoisted(() => ({ adapter: { as: 'mutable' } as unknown as Record<string, unknown> }))

vi.mock('@/api', () => ({
  createAdapter: vi.fn(),
  getAdapter: vi.fn(() => adapter),
  getAdapterFor: vi.fn(() => adapter),
  hasAdapter: vi.fn(() => true),
  hasAdapterFor: vi.fn(() => true),
  findAdapterFor: vi.fn(() => null),
  adapterForSource: vi.fn(() => adapter),
  setPrimary: vi.fn(),
  listAdapters: vi.fn(() => []),
}))

import { QueueDrawer } from './QueueDrawer'
import { usePlayerStore } from '@/store/playerStore'
import { useServerStore } from '@/store/serverStore'
import type { Song } from '@/api/types'

const song = (id: string): Song => ({
  id, title: `歌${id}`, artist: '歌手', serverId: 'nas', duration: 100, album: '', albumId: '',
})

let root: Root | null = null
let width = 1024
let coarse = false
let reduceMotion = false
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
})

/** 按「窗口宽度 + 有没有手指」伪造 matchMedia（happy-dom 自带的不认指针类查询） */
function fakeMedia() {
  vi.spyOn(window, 'matchMedia').mockImplementation(q => {
    const minWidth = /min-width:\s*(\d+)px/.exec(q)
    let matches = false
    if (minWidth) matches = width >= Number(minWidth[1])
    else if (q.includes('prefers-reduced-motion')) matches = reduceMotion
    else if (q.includes('pointer: coarse')) matches = coarse
    else if (q.includes('pointer: fine')) matches = !coarse
    else if (q.includes('hover: hover')) matches = !coarse
    return {
      matches, media: q, onchange: null,
      addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
    } as unknown as MediaQueryList
  })
}

/** 一个「打开队列」的按钮 + 抽屉；按钮就是焦点该回去的地方 */
function Harness() {
  const setQueueOpen = usePlayerStore(s => s.setQueueOpen)
  return (
    <QueryClientProvider client={queryClient}>
      <button id="trigger" onClick={() => setQueueOpen(true)}>打开队列</button>
      <QueueDrawer />
    </QueryClientProvider>
  )
}

function mountDrawer(queue: Song[], open = true) {
  usePlayerStore.setState({
    queue, queueIndex: 0, isPlaying: false,
    isQueueOpen: open, currentSong: queue[0], shuffle: false, shuffledIndexes: [],
  } as never)
  const host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root!.render(<Harness />) })
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  width = 1024
  coarse = false
  reduceMotion = false
  fakeMedia()
  useServerStore.setState({
    activeServerId: 'nas', connectedServerIds: ['nas'], isConnected: true,
    servers: [{ id: 'nas', name: 'NAS', type: 'subsonic' }],
  } as never)
})
afterEach(() => {
  act(() => { root?.unmount() })
  root = null
  document.body.innerHTML = ''
  document.body.removeAttribute('style')
  usePlayerStore.setState({ isQueueOpen: false })
  vi.restoreAllMocks()
})

async function flush(times = 4) {
  for (let i = 0; i < times; i++) {
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
  }
}

/** 上移 / 下移键（测试环境的界面语言可能是中文也可能是英文） */
const moveBtns = (kind: '上移' | '下移') => {
  const re = kind === '上移' ? /上移|Move .* up/ : /下移|Move .* down/
  return [...document.querySelectorAll<HTMLButtonElement>('button')].filter(b => re.test(b.getAttribute('aria-label') ?? ''))
}
const order = () => usePlayerStore.getState().queue.map(s => s.id)

describe('排序控件按输入方式选，不是按窗口宽度', () => {
  it('iPad 竖屏（宽 ≥ 600、手指操作）：每行有上移 / 下移键，点得动', async () => {
    width = 820
    coarse = true
    mountDrawer([song('a'), song('b'), song('c')])
    await flush()

    expect(moveBtns('下移'), '三行三个下移键').toHaveLength(3)
    expect(moveBtns('上移')).toHaveLength(3)
    act(() => { moveBtns('下移')[0].click() })
    expect(order(), '第一首被下移').toEqual(['b', 'a', 'c'])
    act(() => { moveBtns('上移')[2].click() })
    expect(order()).toEqual(['b', 'c', 'a'])
  })

  it('iPad 横屏（宽 ≥ 1024、手指操作）同样有', async () => {
    width = 1180
    coarse = true
    mountDrawer([song('a'), song('b')])
    await flush()
    expect(moveBtns('下移')).toHaveLength(2)
  })

  it('桌面（宽窗口、鼠标）：走拖拽，不多出上移 / 下移键', async () => {
    width = 1280
    coarse = false
    mountDrawer([song('a'), song('b')])
    await flush()
    expect(moveBtns('下移')).toHaveLength(0)
    expect(document.querySelector('li[draggable="true"]'), '鼠标仍可拖拽排序').not.toBeNull()
  })

  it('手机窄屏照旧有上移 / 下移键', async () => {
    width = 390
    coarse = true
    mountDrawer([song('a'), song('b')])
    await flush()
    expect(moveBtns('下移')).toHaveLength(2)
  })
})

describe('窄屏底部弹层是一个对话框', () => {
  const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')

  it('有 role=dialog、aria-modal，并且有读得出来的名字', async () => {
    width = 390
    coarse = true
    mountDrawer([song('a')])
    await flush()

    const d = dialog()
    expect(d, '弹层是个对话框').not.toBeNull()
    expect(d!.getAttribute('aria-modal')).toBe('true')
    const labelledBy = d!.getAttribute('aria-labelledby')
    const name = d!.getAttribute('aria-label') ?? (labelledBy ? document.getElementById(labelledBy)?.textContent : '')
    expect(name, '名字里有「队列」').toMatch(/播放队列|Queue/)
  })

  it('打开时焦点进到对话框里', async () => {
    width = 390
    coarse = true
    mountDrawer([song('a')], false)
    const trigger = document.getElementById('trigger') as HTMLButtonElement
    trigger.focus()
    act(() => { trigger.click() })
    await flush()

    expect(dialog()).not.toBeNull()
    expect(dialog()!.contains(document.activeElement), '焦点在对话框内').toBe(true)
  })

  it('Esc 关闭，焦点回到打开它的按钮', async () => {
    width = 390
    coarse = true
    mountDrawer([song('a')], false)
    const trigger = document.getElementById('trigger') as HTMLButtonElement
    trigger.focus()
    act(() => { trigger.click() })
    await flush()
    expect(usePlayerStore.getState().isQueueOpen).toBe(true)

    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    await flush()

    expect(usePlayerStore.getState().isQueueOpen, 'Esc 关掉了队列').toBe(false)
    expect(dialog()).toBeNull()
    expect(document.activeElement, '焦点回到「打开队列」').toBe(trigger)
  })

  it('点遮罩关闭', async () => {
    width = 390
    coarse = true
    mountDrawer([song('a')])
    await flush()

    const overlay = document.querySelector<HTMLElement>('[data-state="open"]:not([role="dialog"])')
    expect(overlay, '有遮罩').not.toBeNull()
    await act(async () => {
      overlay!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse', button: 0 }))
      overlay!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await flush()
    expect(usePlayerStore.getState().isQueueOpen).toBe(false)
  })

  it('宽窗口的浮动面板不是模态：没有 role=dialog，全局快捷键不会因它让位', async () => {
    width = 1280
    mountDrawer([song('a')])
    await flush()
    expect(dialog()).toBeNull()

    // 宽窗口仍然是 Esc 关闭（原有的 window 监听）
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
    expect(usePlayerStore.getState().isQueueOpen).toBe(false)
  })
})

describe('顶上的把手真能往下拖收起', () => {
  const handle = () => document.querySelector<HTMLElement>('[data-sheet-handle]')
  const sheet = () => document.querySelector<HTMLElement>('[role="dialog"]')
  const ptr = (type: string, clientY: number) =>
    new PointerEvent(type, { bubbles: true, pointerId: 1, pointerType: 'touch', button: 0, clientY })

  it('拖过阈值松手：收起', async () => {
    width = 390
    coarse = true
    reduceMotion = true // 收起动画跳过，直接看结果
    mountDrawer([song('a')])
    await flush()
    const h = handle()
    expect(h, '窄屏弹层顶上有把手').not.toBeNull()

    await act(async () => {
      h!.dispatchEvent(ptr('pointerdown', 100))
      h!.dispatchEvent(ptr('pointermove', 160))
      h!.dispatchEvent(ptr('pointermove', 260))
      h!.dispatchEvent(ptr('pointerup', 260))
    })
    await flush()
    expect(usePlayerStore.getState().isQueueOpen, '拖了 160px，过了 120px').toBe(false)
  })

  it('手指按住往下拖：弹层跟手位移，入场动画让位（否则它的 fill 会一直压着 transform）', async () => {
    width = 390
    coarse = true
    mountDrawer([song('a')])
    await flush()
    const h = handle()!

    await act(async () => {
      h.dispatchEvent(ptr('pointerdown', 100))
      h.dispatchEvent(ptr('pointermove', 160))
    })
    await act(async () => { await new Promise(r => setTimeout(r, 80)) }) // 等 motion 的下一帧把位移写上去
    expect(sheet()!.style.animation).toBe('none')
    expect(sheet()!.style.transform).toContain('translateY(60px)')

    // 往上拖不动：弹层贴着屏幕下沿，上提只会露出一条缝
    await act(async () => { h.dispatchEvent(ptr('pointermove', 40)) })
    await act(async () => { await new Promise(r => setTimeout(r, 80)) })
    expect(sheet()!.style.transform).not.toContain('translateY(-')
  })

  it('没开减弱动态：先滑出去再收起（不是位移到一半突然消失）', async () => {
    width = 390
    coarse = true
    mountDrawer([song('a')])
    await flush()
    const h = handle()!

    await act(async () => {
      h.dispatchEvent(ptr('pointerdown', 100))
      h.dispatchEvent(ptr('pointermove', 300))
      h.dispatchEvent(ptr('pointerup', 300))
    })
    expect(usePlayerStore.getState().isQueueOpen, '动画还在播，没收').toBe(true)
    await act(async () => { await new Promise(r => setTimeout(r, 600)) })
    expect(usePlayerStore.getState().isQueueOpen, '滑出去之后收起').toBe(false)
  })

  it('不够远松手：弹回，队列还开着', async () => {
    width = 390
    coarse = true
    reduceMotion = true
    mountDrawer([song('a')])
    await flush()
    const h = handle()!

    // 按下到松手隔着一段时间，免得被当成「甩」
    const now = vi.spyOn(performance, 'now')
    now.mockReturnValue(0)
    await act(async () => { h.dispatchEvent(ptr('pointerdown', 100)) })
    now.mockReturnValue(1500)
    await act(async () => {
      h.dispatchEvent(ptr('pointermove', 150))
      h.dispatchEvent(ptr('pointerup', 150))
    })
    await flush()
    expect(usePlayerStore.getState().isQueueOpen, '只拖了 50px，慢').toBe(true)
    expect(sheet(), '弹层还在').not.toBeNull()
  })

  it('指针被系统打断（pointercancel）：弹回而不是收起', async () => {
    width = 390
    coarse = true
    reduceMotion = true
    mountDrawer([song('a')])
    await flush()
    const h = handle()!

    await act(async () => {
      h.dispatchEvent(ptr('pointerdown', 100))
      h.dispatchEvent(ptr('pointermove', 400))
      h.dispatchEvent(ptr('pointercancel', 400))
    })
    await flush()
    expect(usePlayerStore.getState().isQueueOpen).toBe(true)
  })

  it('宽窗口的浮动面板没有把手', async () => {
    width = 1280
    mountDrawer([song('a')])
    await flush()
    expect(handle()).toBeNull()
  })
})
