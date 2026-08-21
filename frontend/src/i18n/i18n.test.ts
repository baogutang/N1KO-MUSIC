import { describe, expect, it, beforeEach, vi } from 'vitest'

const store = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => { store.set(key, value) },
  removeItem: (key: string) => { store.delete(key) },
})

const { t, setLocale, getLocale, missingKeys, LOCALES } = await import('./index')
const zhCN = (await import('./locales/zh-CN.json')).default as Record<string, string>
const enUS = (await import('./locales/en-US.json')).default as Record<string, string>

beforeEach(() => { setLocale('zh-CN') })

describe('目录完整性', () => {
  it('英文目录覆盖源语言的每一个 key', () => {
    expect(missingKeys('en-US')).toEqual([])
  })

  it('英文目录不含源语言里没有的 key——多出来的都是已经废弃的', () => {
    expect(Object.keys(enUS).filter(key => !(key in zhCN))).toEqual([])
  })

  /**
   * 少数几个词条在中文里就是空的，且必须是空的：
   * 中文句子自带句末留白，句与句之间不需要分隔符，英文需要一个空格。
   * 这类词条列在这里，其余任何空值都是漏翻。
   */
  const INTENTIONALLY_EMPTY_IN_SOURCE = new Set(['issue.sentenceJoiner'])

  it('源语言里没有意外的空值——中文是唯一必须完整的那一份', () => {
    for (const [key, value] of Object.entries(zhCN)) {
      if (INTENTIONALLY_EMPTY_IN_SOURCE.has(key)) continue
      expect(value.trim(), `${key} 在源语言里是空的`).not.toBe('')
    }
  })

  it('故意留空的那几个词条确实还在，改名了要在这里同步', () => {
    for (const key of INTENTIONALLY_EMPTY_IN_SOURCE) {
      expect(key in zhCN, `${key} 不在词条表里了`).toBe(true)
    }
  })

  it('目标语言允许空串，那是「这个语言里没有这个成分」的正确写法', () => {
    // 量词就是典型：中文「3 位歌手」的「位」，英文里根本不存在
    expect(zhCN['stats.unitArtists']).not.toBe('')
    expect(enUS['stats.unitArtists']).toBe('')
    setLocale('en-US')
    // 关键：空串必须**赢过**回落，否则英文界面上会冒出一个「位」
    expect(t('stats.unitArtists')).toBe('')
  })

  it('同一个 key 在两种语言里的占位符集合必须一致', () => {
    const placeholders = (text: string) =>
      (text.match(/\{(\w+)\}/g) ?? []).sort().join(',')
    for (const key of Object.keys(zhCN)) {
      expect(placeholders(enUS[key]), `${key} 的占位符对不上`)
        .toBe(placeholders(zhCN[key]))
    }
  })

  it('key 一律是「区域.主题」形式，Weblate 里才能按前缀分组', () => {
    for (const key of Object.keys(zhCN)) {
      expect(key, `${key} 不符合命名约定`).toMatch(/^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+)+$/)
    }
  })
})

describe('t', () => {
  it('按当前语言取词', () => {
    expect(t('nav.home')).toBe('首页')
    setLocale('en-US')
    expect(t('nav.home')).toBe('Home')
  })

  it('目标语言缺词时回落到源语言，而不是显示空白', () => {
    setLocale('en-US')
    /**
     * 真的造一个「只有中文有、英文没有」的 key 来验回落。
     * 之前这里用的是 nav.home——两个目录里都有，走的根本不是回落分支，
     * 断言恒成立，等于没测。
     */
    const onlyInSource = '__fallback_probe__'
    ;(zhCN as Record<string, string>)[onlyInSource] = '只有中文有这一条'
    try {
      expect(t(onlyInSource)).toBe('只有中文有这一条')
    } finally {
      delete (zhCN as Record<string, string>)[onlyInSource]
    }
  })

  it('两种语言都没有的 key 显示 key 本身——缺口要在界面上看得见', () => {
    expect(t('does.not.exist')).toBe('does.not.exist')
  })

  it('替换 {name} 占位符', () => {
    expect(t('selection.count', { count: 3, total: 9 })).toBe('已选 3 / 9')
  })

  it('缺变量时保留占位符，而不是替成 undefined', () => {
    expect(t('selection.count', { count: 3 })).toBe('已选 3 / {total}')
  })

  it('不传 vars 时原样返回模板', () => {
    expect(t('selection.count')).toBe('已选 {count} / {total}')
  })
})

describe('setLocale', () => {
  it('切换后记住选择', () => {
    setLocale('en-US')
    expect(getLocale()).toBe('en-US')
    expect(store.get('msp-locale')).toBe('en-US')
  })

  it('LOCALES 里的每一项都有对应的目录', () => {
    for (const item of LOCALES) {
      setLocale(item.value)
      expect(getLocale()).toBe(item.value)
      expect(t('nav.home')).not.toBe('nav.home')
    }
  })
})
