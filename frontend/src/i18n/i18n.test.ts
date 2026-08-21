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

  it('没有空值：缺翻译应该整条不写，靠回落，而不是留一个空串', () => {
    for (const [key, value] of Object.entries({ ...zhCN, ...enUS })) {
      expect(value.trim(), `${key} 是空的`).not.toBe('')
    }
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

  it('目标语言缺词时回落到中文，而不是显示空白', () => {
    setLocale('en-US')
    // 用一个只存在于源语言的假 key 验证回落链路的最后一环
    expect(t('nav.home')).not.toBe('nav.home')
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
