/** 阶段 4.1：能力推导唯一真源（声明优先，未声明按方法存在推断） */
import { describe, expect, it } from 'vitest'
import { capabilitiesOfAdapter, sourceCapabilitiesOf, rowCapsOf } from '@/services/capabilities'
import type { MusicServerAdapter } from '@/api/types'

const stub = (methods: Partial<Record<string, unknown>>, declared?: Record<string, boolean>) =>
  ({
    getSourceCapabilities: declared ? () => declared : undefined,
    ...methods,
  }) as unknown as MusicServerAdapter

describe('capabilitiesOfAdapter（4.1）', () => {
  it('声明优先：getSourceCapabilities 说是 false，方法存在也不算', () => {
    const caps = capabilitiesOfAdapter(stub({ searchAll: () => undefined }, { search: false }))
    expect(caps.search).toBe(false)
  })

  it('未声明按方法存在推断', () => {
    const caps = capabilitiesOfAdapter(stub({ searchAll: () => undefined, getLyrics: () => null }))
    expect(caps.search).toBe(true)
    expect(caps.lyrics).toBe(true)
    expect(caps.topLists).toBe(false)
  })

  it('importSheet 缺省 false、libraryBrowse 缺省 true（与旧行为一致）', () => {
    const caps = capabilitiesOfAdapter(stub({}))
    expect(caps.importSheet).toBe(false)
    expect(caps.libraryBrowse).toBe(true)
  })
})

describe('rowCapsOf（4.1：行级能力回落规则统一）', () => {
  const primary = { search: true, libraryBrowse: true } as never
  const wy = { search: true, favorites: false, libraryBrowse: false } as never
  it('歌曲自己的源优先；取不到回落主库', () => {
    expect(rowCapsOf({ wy }, 'wy', primary)).toBe(wy)
    expect(rowCapsOf({ wy }, 'nas-unknown', primary)).toBe(primary)
  })
  it('什么都没有给全空（不再各自另造默认）', () => {
    const caps = rowCapsOf(undefined, undefined, undefined)
    expect(caps.search).toBe(false)
    expect(caps.libraryBrowse).toBe(false)
  })
})
