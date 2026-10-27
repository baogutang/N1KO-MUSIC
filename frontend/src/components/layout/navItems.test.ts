/**
 * v5 外壳的导航高亮：三档导航共用一张表，哪一格亮由 isNavActive 决定。
 *
 * 中、窄两档只有四格，音乐库那一格要把专辑、歌手、歌单、收藏、历史、统计、
 * 单曲详情、榜单都算进来——否则从专辑页点进去，底部标签栏一格都不亮，
 * 人不知道自己在哪。宽档侧栏则要精确到分类。
 */
import { describe, expect, it } from 'vitest'
import { PRIMARY_NAV, SIDEBAR_DISCOVER, SIDEBAR_LIBRARY, MORE_NAV, isNavActive } from './navItems'

const active = (items: typeof PRIMARY_NAV, path: string) =>
  items.filter(item => isNavActive(item, path)).map(item => item.to)

describe('PRIMARY_NAV（中、窄两档的四格）', () => {
  it('首页只在根路径亮', () => {
    expect(active(PRIMARY_NAV, '/')).toEqual(['/'])
    expect(active(PRIMARY_NAV, '/recommendations')).toEqual(['/recommendations'])
  })

  it('音乐库下的每一条路由都落在「音乐库」这一格', () => {
    for (const path of [
      '/library', '/albums', '/albums/al-1', '/artists', '/artists/ar-1', '/playlists', '/playlists/pl-1',
      '/favorites', '/history', '/stats', '/songs/sg-1', '/toplists/srv/list',
    ]) {
      expect(active(PRIMARY_NAV, path), path).toEqual(['/library'])
    }
  })

  it('设置与本期不点亮任何一格（它们在「更多」里）', () => {
    expect(active(PRIMARY_NAV, '/settings')).toEqual([])
    expect(active(PRIMARY_NAV, '/issue')).toEqual([])
  })

  it('前缀相同但不是子路径的不误亮（/albums 不点亮 /albumsx）', () => {
    expect(active(SIDEBAR_LIBRARY, '/albumsx')).toEqual([])
  })
})

describe('侧栏（宽档）精确到分类', () => {
  it('专辑详情点亮「专辑」，不点亮「全部歌曲」', () => {
    expect(active(SIDEBAR_LIBRARY, '/albums/al-1')).toEqual(['/albums'])
  })

  it('单曲详情归「全部歌曲」', () => {
    expect(active(SIDEBAR_LIBRARY, '/songs/sg-1')).toEqual(['/library'])
  })

  it('本期在侧栏的发现组里', () => {
    expect(active(SIDEBAR_DISCOVER, '/issue')).toEqual(['/issue'])
  })
})

describe('中、窄两档放不下的入口一个都不丢', () => {
  it('侧栏有、四格里没有的入口都在「更多」菜单里', () => {
    const primary = new Set(PRIMARY_NAV.map(i => i.to))
    const more = new Set(MORE_NAV.map(i => i.to))
    const sidebarOnly = [...SIDEBAR_DISCOVER, ...SIDEBAR_LIBRARY]
      .map(i => i.to)
      // 音乐库的分类在「音乐库」页内有分段导航；这里只核对跨页面的独立入口
      .filter(to => !['/library', '/albums', '/artists', '/playlists'].includes(to))
      .filter(to => !primary.has(to))
    expect(sidebarOnly.filter(to => !more.has(to))).toEqual([])
  })
})
