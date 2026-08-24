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

  /**
   * 词条表里不该有没人用的条目。
   *
   * 死条目对译者是纯粹的浪费——他们看不出哪些还在界面上，只能全译一遍。
   * 用源码全文匹配 `'key'` / "key"：足够简单，也足够挡住实际会发生的那种遗留。
   */
  it('每一条词条都真的被代码引用', async () => {
    const fs = await import('node:fs')
    const files: string[] = []
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = `${dir}/${entry.name}`
        if (entry.isDirectory()) {
          if (!full.includes('i18n/locales')) walk(full)
        } else if (/\.(ts|tsx)$/.test(entry.name)) files.push(full)
      }
    }
    walk('src')
    const source = files.map(f => fs.readFileSync(f, 'utf8')).join('\n')
    const unused = Object.keys(zhCN)
      // `<key>_one` 是单数形态，由 t() 在 count === 1 时**拼出来**，
      // 源码里不会出现字面量。它的调用方就是同名的基础键。
      .filter(key => !key.endsWith('_one'))
      .filter(key => !source.includes(`'${key}'`) && !source.includes(`"${key}"`))
    expect(unused, `这些词条没有任何调用方，删掉或接上：\n${unused.join('\n')}`).toEqual([])
  })

  it('key 一律是「区域.主题」形式，Weblate 里才能按前缀分组', () => {
    for (const key of Object.keys(zhCN)) {
      // 允许结尾的 `_one`：这是单数形态的约定后缀，见 i18n/index.ts 的 pluralKey
      expect(key, `${key} 不符合命名约定`).toMatch(/^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+)+(_one)?$/)
    }
  })

  /**
   * 单数形态必须成对：只有英文加了 `_one` 而中文没有（或反之），
   * 键集对等那条测试会先红，但错误信息指不到这里。显式钉一遍。
   */
  it('每个 _one 都有对应的基础键', () => {
    for (const key of Object.keys(zhCN)) {
      if (!key.endsWith('_one')) continue
      const base = key.slice(0, -'_one'.length)
      expect(base in zhCN, `${key} 没有对应的基础键 ${base}`).toBe(true)
    }
  })
})

describe('单复数', () => {
  /**
   * 中文没有复数形态，词表一直是单一形式，于是英文界面读成
   * 「1 tracks」「1 albums」——八处，全在计数最常出现的地方。
   */
  it('count 为 1 时用单数形态', () => {
    setLocale('en-US')
    expect(t('song.count', { count: 1 })).toBe('1 track')
    expect(t('album.count', { count: 1 })).toBe('1 album')
  })

  it('count 不为 1 时用复数形态', () => {
    setLocale('en-US')
    expect(t('song.count', { count: 2 })).toBe('2 tracks')
    expect(t('song.count', { count: 0 })).toBe('0 tracks')
  })

  it('中文不受影响——它本来就没有复数形态', () => {
    setLocale('zh-CN')
    const one = t('song.count', { count: 1 })
    const many = t('song.count', { count: 5 })
    expect(one).toContain('1')
    expect(many).toContain('5')
    // 量词一致，只有数字不同
    expect(one.replace('1', '')).toBe(many.replace('5', ''))
  })

  it('没有 _one 变体的键行为完全不变', () => {
    setLocale('en-US')
    // 这类键不该因为传了 count 就找不到译文
    expect(t('song.year', { year: 2014 })).not.toBe('song.year')
  })

  /**
   * 组件用的是 useT() 返回的 bound t，不是模块级的 t。
   * 单复数第一次加上时只改了模块级那份——测试全绿，界面一个字没变。
   * 这条钉的就是那个盲区。
   */
  it('useT() 返回的 t 同样走单复数（组件走的是这条路）', async () => {
    const { boundTForTest } = await import('./index')
    const en = boundTForTest('en-US')
    expect(en('song.count', { count: 1 })).toBe('1 track')
    expect(en('song.count', { count: 3 })).toBe('3 tracks')
  })

  it('没传 count 时不走单复数分支', () => {
    setLocale('en-US')
    expect(t('nav.library')).not.toContain('_one')
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
