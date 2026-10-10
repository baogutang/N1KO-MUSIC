/**
 * 阶段 7.2 回归：版记的栏目键覆盖每一条内容路由。
 *
 * 新路由忘了登记时，页脚的栏目位会静默空掉——「每页要有报头/刊号/书眉/版记」
 * 的设计纲领靠这条测试兜底。App.tsx 的内容路由加一条，这里就得跟一条。
 */
import { describe, expect, it } from 'vitest'
import { sectionKeyFor } from '@/components/layout/Colophon'

/** App.tsx 里挂在主布局下的内容路由（/:id 之类的参数位用代表性值代入） */
const CONTENT_ROUTES = [
  '/',
  '/library',
  '/search',
  '/recommendations',
  '/albums',
  '/albums/al-1',
  '/artists',
  '/artists/ar-1',
  '/playlists',
  '/playlists/pl-1',
  '/favorites',
  '/history',
  '/stats',
  '/issue',
  '/songs/sg-1',
  '/settings',
  '/toplists/srv-1/list-1',
]

describe('sectionKeyFor（阶段 7.2：每条路由都有栏目键）', () => {
  it('内容路由一个不漏', () => {
    const missing = CONTENT_ROUTES.filter(path => sectionKeyFor(path) === null)
    expect(missing, `这些路由没有栏目键：${missing.join(', ')}`).toEqual([])
  })

  it('/toplists 归入榜单栏目（此前缺登记，版记空着）', () => {
    expect(sectionKeyFor('/toplists/srv-x/list-y')).toBe('sources.topLists')
  })

  it('未登记的特殊页不乱猜（返回 null 而不是借别的栏目）', () => {
    expect(sectionKeyFor('/login')).toBeNull()
    expect(sectionKeyFor('/open')).toBeNull()
  })
})
