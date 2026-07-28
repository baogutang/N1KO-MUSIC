import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePlayerStore } from '@/store/playerStore'
import type { Song } from '@/api/types'

type PlayerSnapshot = ReturnType<typeof usePlayerStore.getState>

function song(id: string): Song {
  return { id, title: `Song ${id}`, artist: 'Artist', album: 'Album', duration: 200 }
}

/** 队列曲目的 id 与下标一一对应（s0 在下标 0），下标断言因此可以直接读懂 */
function makeSongs(count: number): Song[] {
  return Array.from({ length: count }, (_, i) => song(`s${i}`))
}

const state = () => usePlayerStore.getState()

function queueIds(): string[] {
  return state().queue.map(item => item.id)
}

/**
 * 随机顺序实际指向的曲目序列。
 * 增删/重排后用它断言「无损」：下标会变，但随机播放顺序必须保持原样。
 */
function shuffleOrderIds(): string[] {
  const { queue, shuffledIndexes } = state()
  return shuffledIndexes.map(i => queue[i]?.id ?? `<missing:${i}>`)
}

function currentId(): string | null {
  return state().currentSong?.id ?? null
}

function resetStore() {
  usePlayerStore.setState({
    currentSong: null,
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    buffered: 0,
    playVersion: 0,
    queue: [],
    queueIndex: -1,
    history: [],
    volume: 0.8,
    muted: false,
    repeatMode: 'none',
    shuffle: false,
    shuffledIndexes: [],
    isFullscreen: false,
    isQueueOpen: false,
    streamBuffering: false,
  })
}

function seedQueue(count: number, index: number, patch: Partial<PlayerSnapshot> = {}): Song[] {
  const queue = makeSongs(count)
  usePlayerStore.setState({
    queue,
    queueIndex: index,
    currentSong: queue[index] ?? null,
    isPlaying: true,
    shuffledIndexes: queue.map((_, i) => i),
    ...patch,
  })
  return queue
}

/** 切歌防抖窗口是 50ms 的模块级状态，切歌前必须把时钟推出窗口 */
function passSwitchDebounce() {
  vi.advanceTimersByTime(60)
}

const BASE_TIME = new Date('2030-01-01T00:00:00Z').getTime()
let clockOffset = 0

beforeEach(() => {
  vi.useFakeTimers()
  // 防抖状态跨用例保留，时钟必须单调前进，否则下个用例的首次切歌会被上个用例吞掉
  clockOffset += 1000
  vi.setSystemTime(BASE_TIME + clockOffset)
  resetStore()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('起播', () => {
  it('playSong 在给定队列中定位当前曲并递增 playVersion', () => {
    const queue = makeSongs(3)
    usePlayerStore.setState({ playVersion: 7 })

    state().playSong(queue[2], queue)

    expect(currentId()).toBe('s2')
    expect(queueIds()).toEqual(['s0', 's1', 's2'])
    expect(state().queueIndex).toBe(2)
    expect(state().isPlaying).toBe(true)
    expect(state().playVersion).toBe(8)
  })

  it('playSong 不带队列时把单曲作为整个队列', () => {
    state().playSong(song('solo'))

    expect(queueIds()).toEqual(['solo'])
    expect(state().queueIndex).toBe(0)
  })

  it('playSong 把上一首推入跨列表历史', () => {
    seedQueue(2, 0)
    state().playSong(song('other'))

    expect(state().history.map(item => item.id)).toEqual(['s0'])
  })

  it('歌曲不在传入队列里时插到队首,首次 next 不会跳过队列第一首', () => {
    const queue = makeSongs(3)
    const outsider = song('outsider')

    state().playSong(outsider, queue)

    // currentSong 必须等于 queue[queueIndex]，否则 next() 会从 queue[1] 开始
    expect(currentId()).toBe('outsider')
    expect(state().queue[state().queueIndex].id).toBe('outsider')
    expect(queueIds()).toEqual(['outsider', 's0', 's1', 's2'])

    passSwitchDebounce()
    state().next()
    expect(currentId()).toBe('s0')
  })

  it('playQueue 从指定下标起播', () => {
    const queue = makeSongs(4)
    state().playQueue(queue, 2)

    expect(currentId()).toBe('s2')
    expect(state().queueIndex).toBe(2)
    expect(state().playVersion).toBe(1)
  })

  it('playQueue 收到空列表时不改动任何状态', () => {
    state().playQueue([], 0)

    expect(currentId()).toBeNull()
    expect(state().playVersion).toBe(0)
  })
})

describe('顺序播放的 next', () => {
  it('前进到下一首并递增 playVersion', () => {
    seedQueue(3, 0, { playVersion: 2 })
    passSwitchDebounce()

    state().next()

    expect(state().queueIndex).toBe(1)
    expect(currentId()).toBe('s1')
    expect(state().playVersion).toBe(3)
    expect(state().currentTime).toBe(0)
  })

  it('播到队尾且不循环时停止播放，而不是回到开头', () => {
    seedQueue(3, 2)
    passSwitchDebounce()

    state().next()

    expect(state().isPlaying).toBe(false)
    expect(state().queueIndex).toBe(2)
    expect(currentId()).toBe('s2')
  })

  it('列表循环时队尾 next 回绕到第一首', () => {
    seedQueue(3, 2, { repeatMode: 'all' })
    passSwitchDebounce()

    state().next()

    expect(state().queueIndex).toBe(0)
    expect(currentId()).toBe('s0')
    expect(state().isPlaying).toBe(true)
  })
})

describe('随机播放的 next', () => {
  it('按 shuffledIndexes 的顺序走，而不是队列顺序', () => {
    seedQueue(4, 2, { shuffle: true, shuffledIndexes: [2, 0, 3, 1] })

    passSwitchDebounce()
    state().next()
    expect(state().queueIndex).toBe(0)

    passSwitchDebounce()
    state().next()
    expect(state().queueIndex).toBe(3)
  })

  it('随机顺序走完且不循环时停止播放', () => {
    // 队列还有 4 首没播完的错觉：s1 是随机序列的最后一位
    seedQueue(4, 1, { shuffle: true, shuffledIndexes: [2, 0, 3, 1] })
    passSwitchDebounce()

    state().next()

    expect(state().isPlaying).toBe(false)
    expect(state().queueIndex).toBe(1)
  })

  it('随机顺序走完且列表循环时回到随机序列开头', () => {
    seedQueue(4, 1, { shuffle: true, shuffledIndexes: [2, 0, 3, 1], repeatMode: 'all' })
    passSwitchDebounce()

    state().next()

    expect(state().queueIndex).toBe(2)
    expect(state().isPlaying).toBe(true)
  })
})

describe('advanceOnEnded', () => {
  it('单曲循环时重播当前曲并递增 playVersion，而不是前进', () => {
    seedQueue(3, 1, { repeatMode: 'one', playVersion: 5, currentTime: 199 })
    passSwitchDebounce()

    state().advanceOnEnded()

    expect(state().queueIndex).toBe(1)
    expect(currentId()).toBe('s1')
    expect(state().playVersion).toBe(6)
    expect(state().currentTime).toBe(0)
  })

  it('非单曲循环时交给 next 处理', () => {
    seedQueue(3, 1, { repeatMode: 'none' })
    passSwitchDebounce()

    state().advanceOnEnded()

    expect(state().queueIndex).toBe(2)
    expect(currentId()).toBe('s2')
  })

  it('单曲循环但没有当前曲时不产生播放', () => {
    usePlayerStore.setState({ repeatMode: 'one', currentSong: null, playVersion: 4 })
    passSwitchDebounce()

    state().advanceOnEnded()

    expect(state().playVersion).toBe(4)
    expect(state().isPlaying).toBe(false)
  })

  /**
   * 自动推进与用户切歌共用 50ms 防抖，这是有意的。
   * 音频引擎切歌有 120ms 加载防抖，旧 audio 元素在被拆掉前仍可能抛出 ended；
   * 这次 ended 属于已经切走的那一首，必须忽略，否则用户点一次下一首会跳两首。
   *
   * 之所以不会因此卡死：canSwitch 只在成功时更新时间戳，因此 ended 被吞掉的前提
   * 必然是 50ms 内刚有一次成功切歌，而那次切歌已经完成了转场。
   */
  it('用户切歌后紧接着到来的过期 ended 不会二次推进,避免漏歌', () => {
    seedQueue(4, 0)
    passSwitchDebounce()

    state().next()
    expect(currentId()).toBe('s1')

    vi.advanceTimersByTime(20)
    state().advanceOnEnded()

    expect(currentId()).toBe('s1')
    expect(state().queueIndex).toBe(1)
  })

  it('单曲循环下过期的 ended 不会打断刚切到的新歌', () => {
    seedQueue(3, 0, { repeatMode: 'one' })
    passSwitchDebounce()

    state().next()
    const versionAfterSwitch = state().playVersion

    vi.advanceTimersByTime(20)
    state().advanceOnEnded()

    // 未重复递增 playVersion，说明没有把刚切到的 s1 又从头重播一遍
    expect(state().playVersion).toBe(versionAfterSwitch)
    expect(currentId()).toBe('s1')
  })
})

describe('prev', () => {
  it('队首 prev 优先回退到跨列表历史，并把该曲接到队列最前', () => {
    seedQueue(3, 0, { history: [song('older'), song('oldest')] })
    passSwitchDebounce()

    state().prev()

    expect(currentId()).toBe('older')
    expect(queueIds()).toEqual(['older', 's0', 's1', 's2'])
    expect(state().queueIndex).toBe(0)
    expect(state().history.map(item => item.id)).toEqual(['oldest'])
  })

  it('列表循环且无历史时，队首 prev 回绕到最后一首', () => {
    seedQueue(3, 0, { repeatMode: 'all', history: [] })
    passSwitchDebounce()

    state().prev()

    expect(state().queueIndex).toBe(2)
    expect(currentId()).toBe('s2')
  })

  it('队列中间 prev 退回上一首', () => {
    seedQueue(3, 2, { history: [song('older')] })
    passSwitchDebounce()

    state().prev()

    // 历史只在队首生效，中间位置仍按队列顺序回退
    expect(currentId()).toBe('s1')
    expect(state().queueIndex).toBe(1)
  })

  /**
   * 随机模式下「上一首」定义为随机顺序的上一首，不动用跨列表历史 —— 这是取舍而非遗漏：
   * 跨列表回退那条分支会 generateShuffledIndexes 整体重洗，破坏本 store 处处维护的
   * 「增删重排不重洗」性质。此处固定该行为，避免被当成 bug 改掉。
   */
  it('随机模式下 prev 沿随机顺序回退,不动用跨列表历史', () => {
    // queueIndex 必须同时为 0 才能真正覆盖到跨列表历史那条分支的判断条件，
    // 否则无论走哪条分支结果都一样，这条用例就失去了鉴别力。
    seedQueue(3, 0, {
      shuffle: true,
      shuffledIndexes: [0, 2, 1],
      history: [song('from-previous-list')],
    })
    passSwitchDebounce()

    state().prev()

    // 当前处于随机顺序首位，回退时回绕到随机顺序末尾的 s1，而不是历史中的曲目
    expect(currentId()).toBe('s1')
    expect(state().history.map(item => item.id)).toContain('from-previous-list')
    // 随机顺序保持原样，没有被重洗
    expect(state().shuffledIndexes).toEqual([0, 2, 1])
  })
})

describe('addToQueue', () => {
  it("position='next' 插入到当前曲之后，当前曲不变", () => {
    seedQueue(3, 1)

    state().addToQueue([song('n1'), song('n2')], 'next')

    expect(queueIds()).toEqual(['s0', 's1', 'n1', 'n2', 's2'])
    expect(state().queueIndex).toBe(1)
    expect(currentId()).toBe('s1')
  })

  it("随机模式下 position='next' 只把新歌插进当前曲之后，不重洗已有顺序", () => {
    seedQueue(4, 1, { shuffle: true, shuffledIndexes: [1, 3, 0, 2] })

    state().addToQueue([song('n1')], 'next')

    expect(queueIds()).toEqual(['s0', 's1', 'n1', 's2', 's3'])
    // 原随机顺序 s1→s3→s0→s2 完整保留，新歌紧跟当前曲
    expect(shuffleOrderIds()).toEqual(['s1', 'n1', 's3', 's0', 's2'])
    expect(currentId()).toBe('s1')
    expect(state().queue[state().queueIndex].id).toBe('s1')
  })

  it("随机模式下 position='last' 保留已播前缀，新歌只混入未播放部分", () => {
    seedQueue(4, 0, { shuffle: true, shuffledIndexes: [3, 1, 0, 2] })

    state().addToQueue([song('n1'), song('n2')], 'last')

    expect(queueIds()).toEqual(['s0', 's1', 's2', 's3', 'n1', 'n2'])
    // 已播的 s3、s1 与当前的 s0 顺序原样保留
    expect(state().shuffledIndexes.slice(0, 3)).toEqual([3, 1, 0])
    // 剩余部分含且仅含未播放的 s2 与两首新歌，顺序随机
    expect([...state().shuffledIndexes.slice(3)].sort((a, b) => a - b)).toEqual([2, 4, 5])
  })

  it('关闭随机时加歌仍保持随机下标为完整恒等映射,不留下过短的旧数组', () => {
    seedQueue(2, 0)

    state().addToQueue([song('n1'), song('n2')], 'last')
    expect(state().shuffledIndexes).toEqual([0, 1, 2, 3])

    state().addToQueue([song('n3')], 'next')
    expect(state().shuffledIndexes).toEqual([0, 1, 2, 3, 4])
  })

  it('加入空列表不改动队列', () => {
    seedQueue(2, 0)

    state().addToQueue([], 'next')

    expect(queueIds()).toEqual(['s0', 's1'])
  })
})

describe('removeFromQueue', () => {
  it('删除当前曲之前的歌只顺移下标，不换歌', () => {
    seedQueue(4, 2)

    state().removeFromQueue(0)

    expect(queueIds()).toEqual(['s1', 's2', 's3'])
    expect(state().queueIndex).toBe(1)
    expect(currentId()).toBe('s2')
  })

  it('删除当前曲后接着播原位置上的下一首', () => {
    seedQueue(4, 1, { playVersion: 3 })

    state().removeFromQueue(1)

    expect(queueIds()).toEqual(['s0', 's2', 's3'])
    expect(state().queueIndex).toBe(1)
    expect(currentId()).toBe('s2')
    expect(state().playVersion).toBe(4)
  })

  it('删除队尾的当前曲时回退到新的最后一首', () => {
    seedQueue(3, 2)

    state().removeFromQueue(2)

    expect(state().queueIndex).toBe(1)
    expect(currentId()).toBe('s1')
  })

  it('删除最后一首歌时清空当前曲并停止播放', () => {
    seedQueue(1, 0)

    state().removeFromQueue(0)

    expect(state().currentSong).toBeNull()
    expect(state().queue).toEqual([])
    expect(state().queueIndex).toBe(-1)
    expect(state().isPlaying).toBe(false)
    expect(state().shuffledIndexes).toEqual([])
  })

  it('随机模式下删除是无损的：不重洗，仅摘掉该曲并顺移其后下标', () => {
    seedQueue(5, 4, { shuffle: true, shuffledIndexes: [4, 0, 3, 1, 2] })

    state().removeFromQueue(1)

    expect(queueIds()).toEqual(['s0', 's2', 's3', 's4'])
    // 原随机顺序 s4→s0→s3→s1→s2 只少了被删的 s1
    expect(shuffleOrderIds()).toEqual(['s4', 's0', 's3', 's2'])
    expect(state().queueIndex).toBe(3)
    expect(currentId()).toBe('s4')
  })

  it('随机模式下删除当前曲后沿随机顺序接着播,不跳过未播放的曲目', () => {
    // 随机顺序 s4→s0→s3→s1→s2，正在播首位的 s4；删掉它之后应接到 s0，
    // 按队列下标取会落到 s3，让还没播过的 s0 被永久跳过。
    seedQueue(5, 4, { shuffle: true, shuffledIndexes: [4, 0, 3, 1, 2] })

    state().removeFromQueue(4)

    expect(currentId()).toBe('s0')
    expect(shuffleOrderIds()).toEqual(['s0', 's3', 's1', 's2'])

    passSwitchDebounce()
    state().next()
    expect(currentId()).toBe('s3')
  })

  it('随机模式下删除随机顺序末尾的当前曲时不越界', () => {
    // 正在播随机顺序最后一位的 s0，其后已无曲目
    seedQueue(3, 0, { shuffle: true, shuffledIndexes: [1, 2, 0] })

    state().removeFromQueue(0)

    expect(queueIds()).toEqual(['s1', 's2'])
    expect(state().currentSong).not.toBeNull()
    expect(state().queueIndex).toBeGreaterThanOrEqual(0)
    expect(state().queueIndex).toBeLessThan(2)
  })

  it('越界下标不改动队列', () => {
    seedQueue(3, 1)

    state().removeFromQueue(5)
    state().removeFromQueue(-1)

    expect(queueIds()).toEqual(['s0', 's1', 's2'])
    expect(state().queueIndex).toBe(1)
  })
})

describe('reorderQueue', () => {
  it('把当前曲之前的歌拖到其后，当前曲仍是当前曲', () => {
    seedQueue(5, 2)

    state().reorderQueue(0, 4)

    expect(queueIds()).toEqual(['s1', 's2', 's3', 's4', 's0'])
    expect(state().queueIndex).toBe(1)
    expect(currentId()).toBe('s2')
    expect(state().queue[state().queueIndex].id).toBe('s2')
  })

  it('随机模式下重排用同一套映射跟随，随机播放顺序完全不变', () => {
    seedQueue(5, 2, { shuffle: true, shuffledIndexes: [2, 4, 0, 3, 1] })
    const before = shuffleOrderIds()

    state().reorderQueue(0, 4)

    expect(shuffleOrderIds()).toEqual(before)
    expect(state().queue[state().queueIndex].id).toBe('s2')
  })

  it('把当前曲之后的歌拖到其前，当前曲下标后移', () => {
    seedQueue(5, 2)

    state().reorderQueue(4, 0)

    expect(queueIds()).toEqual(['s4', 's0', 's1', 's2', 's3'])
    expect(state().queueIndex).toBe(3)
    expect(currentId()).toBe('s2')
  })

  it('原地重排或越界下标不改动队列', () => {
    seedQueue(3, 1)

    state().reorderQueue(1, 1)
    state().reorderQueue(0, 9)

    expect(queueIds()).toEqual(['s0', 's1', 's2'])
    expect(state().queueIndex).toBe(1)
  })
})

describe('clearQueue', () => {
  it('只保留正在播放的那一首', () => {
    seedQueue(5, 3)

    state().clearQueue()

    expect(queueIds()).toEqual(['s3'])
    expect(state().queueIndex).toBe(0)
    expect(state().shuffledIndexes).toEqual([0])
    expect(currentId()).toBe('s3')
  })

  it('没有正在播放的歌时清成空队列', () => {
    seedQueue(3, 1, { currentSong: null })

    state().clearQueue()

    expect(state().queue).toEqual([])
    expect(state().queueIndex).toBe(-1)
  })
})

describe('toggleShuffle', () => {
  it('开启时当前曲排在随机序列首位，且每个下标恰好出现一次', () => {
    seedQueue(20, 7)

    state().toggleShuffle()

    expect(state().shuffle).toBe(true)
    expect(state().shuffledIndexes[0]).toBe(7)
    expect([...state().shuffledIndexes].sort((a, b) => a - b))
      .toEqual(Array.from({ length: 20 }, (_, i) => i))
  })

  it('关闭时恢复为顺序下标', () => {
    seedQueue(4, 1, { shuffle: true, shuffledIndexes: [1, 3, 0, 2] })

    state().toggleShuffle()

    expect(state().shuffle).toBe(false)
    expect(state().shuffledIndexes).toEqual([0, 1, 2, 3])
  })
})

describe('切歌防抖', () => {
  it('50ms 内的连续 next 只生效一次', () => {
    seedQueue(5, 0)
    passSwitchDebounce()

    state().next()
    state().next()

    expect(state().queueIndex).toBe(1)

    passSwitchDebounce()
    state().next()
    expect(state().queueIndex).toBe(2)
  })

  it('防抖窗口对 next 与 prev 共享，避免快速连点来回跳', () => {
    seedQueue(5, 2)
    passSwitchDebounce()

    state().next()
    state().prev()

    expect(state().queueIndex).toBe(3)
  })
})

describe('resetForServerChange', () => {
  it('清空队列、当前曲与历史并递增 playVersion', () => {
    seedQueue(3, 1, {
      history: [song('older')],
      playVersion: 9,
      shuffledIndexes: [1, 0, 2],
      streamBuffering: true,
    })

    state().resetForServerChange()

    expect(state().currentSong).toBeNull()
    expect(state().queue).toEqual([])
    expect(state().queueIndex).toBe(-1)
    expect(state().history).toEqual([])
    expect(state().shuffledIndexes).toEqual([])
    expect(state().isPlaying).toBe(false)
    expect(state().streamBuffering).toBe(false)
    // playVersion 必须变化，否则 useAudioEngine 会认为是同一次加载而不重建音频
    expect(state().playVersion).toBe(10)
  })
})
