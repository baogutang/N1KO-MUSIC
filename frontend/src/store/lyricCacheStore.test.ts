/**
 * 阶段 3.1 回归：歌词缓存按歌曲自己的来源分域。
 *
 * 用户真实路径：同一首歌 id 在两个音源都存在（Subsonic 数字自增 id 常见），
 * 在 A 源保存过歌词后，B 源的同 id 歌必须拿到自己的（没有）歌词，
 * 而不是 A 的词；删掉一个源，它的词条跟着消失。
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { useLyricCacheStore } from '@/store/lyricCacheStore'

beforeEach(() => {
  useLyricCacheStore.setState({ cache: {} })
})

describe('歌词缓存分域（阶段 3.1）', () => {
  it('两源同 id 不串词：各存各的、各取各的', () => {
    const { saveLyrics, getLyrics } = useLyricCacheStore.getState()
    saveLyrics('42', '[00:01]A 源的词', 'srv-a')
    saveLyrics('42', '[00:02]B 源的词', 'srv-b')

    expect(getLyrics('42', 'srv-a')).toBe('[00:01]A 源的词')
    expect(getLyrics('42', 'srv-b')).toBe('[00:02]B 源的词')
    // 没存过的源拿到 null——去发真正的歌词请求，而不是吃别源的缓存
    expect(getLyrics('42', 'srv-c')).toBeNull()
  })

  it('删源清掉该源名下的条目，别源的保留', () => {
    const { saveLyrics, removeServerEntries, getLyrics } = useLyricCacheStore.getState()
    saveLyrics('42', 'A 的词', 'srv-a')
    saveLyrics('43', 'A 的另一首', 'srv-a')
    saveLyrics('42', 'B 的词', 'srv-b')

    removeServerEntries('srv-a')

    expect(getLyrics('42', 'srv-a')).toBeNull()
    expect(getLyrics('43', 'srv-a')).toBeNull()
    expect(getLyrics('42', 'srv-b')).toBe('B 的词')
  })

  it('removeLyrics 只删自己来源的那条', () => {
    const { saveLyrics, removeLyrics, getLyrics } = useLyricCacheStore.getState()
    saveLyrics('42', 'A 的词', 'srv-a')
    saveLyrics('42', 'B 的词', 'srv-b')

    removeLyrics('42', 'srv-a')

    expect(getLyrics('42', 'srv-a')).toBeNull()
    expect(getLyrics('42', 'srv-b')).toBe('B 的词')
  })
})
