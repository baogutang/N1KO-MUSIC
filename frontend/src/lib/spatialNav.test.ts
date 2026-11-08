/**
 * @vitest-environment happy-dom
 *
 * 电视的方向键导航（lib/spatialNav）。
 * happy-dom 不排版，元素的位置用 data-rect="left,top,width,height" 直接给。
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
  addNavInterceptor,
  arrowOwnedByControl,
  findNext,
  initialFocusTarget,
  installSpatialNav,
  isInDirection,
  pickNearest,
  type Rect,
} from '@/lib/spatialNav'

const r = (left: number, top: number, width: number, height: number): Rect => ({ left, top, right: left + width, bottom: top + height })

/** 把 data-rect 变成 getBoundingClientRect 的返回值 */
function mount(html: string): HTMLElement {
  const root = document.createElement('div')
  root.innerHTML = html
  document.body.appendChild(root)
  root.querySelectorAll<HTMLElement>('[data-rect]').forEach(el => {
    const [left, top, width, height] = el.dataset.rect!.split(',').map(Number)
    el.getBoundingClientRect = () => ({
      left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}),
    }) as DOMRect
  })
  return root
}

const $ = (sel: string) => document.querySelector<HTMLElement>(sel)!

afterEach(() => {
  document.body.innerHTML = ''
})

describe('几何', () => {
  // 两行三列，卡片 100×100，间距 20
  const grid = [r(0, 0, 100, 100), r(120, 0, 100, 100), r(240, 0, 100, 100), r(0, 120, 100, 100), r(120, 120, 100, 100), r(240, 120, 100, 100)]

  it('往右是同一行紧挨着的那张，往下是正下方那张', () => {
    expect(pickNearest(grid[0], grid, 'right')).toBe(1)
    expect(pickNearest(grid[1], grid, 'down')).toBe(4)
    expect(pickNearest(grid[5], grid, 'up')).toBe(2)
    expect(pickNearest(grid[4], grid, 'left')).toBe(3)
  })

  it('走到头没有候选', () => {
    expect(pickNearest(grid[2], grid, 'right')).toBe(-1)
    expect(pickNearest(grid[0], grid, 'up')).toBe(-1)
  })

  it('焦点卡放大 6% 伸进缝里，邻居仍然算在它右边', () => {
    const scaled = r(-3, -3, 106, 106)
    expect(isInDirection(scaled, grid[1], 'right')).toBe(true)
  })

  it('光束里的远一点也赢过光束外斜着的近一点', () => {
    const from = r(0, 0, 100, 40)
    const below = r(0, 200, 100, 40) // 正下方，远
    const diagonal = r(300, 60, 100, 40) // 斜下方，近
    expect(pickNearest(from, [diagonal, below], 'down')).toBe(1)
  })

  it('光束里没有候选时取正交方向最近的', () => {
    const from = r(800, 0, 100, 30) // 右上角的「正在播放」
    const left = r(100, 100, 200, 40)
    const farLeft = r(0, 300, 200, 40)
    expect(pickNearest(from, [farLeft, left], 'down')).toBe(1)
  })
})

describe('方向键归控件自己', () => {
  it('横向滑块管左右，不管上下', () => {
    mount('<div role="slider" tabindex="0" id="s"></div>')
    expect(arrowOwnedByControl($('#s'), 'left')).toBe(true)
    expect(arrowOwnedByControl($('#s'), 'down')).toBe(false)
  })

  it('竖向滑块反过来', () => {
    mount('<div role="slider" aria-orientation="vertical" tabindex="0" id="s"></div>')
    expect(arrowOwnedByControl($('#s'), 'up')).toBe(true)
    expect(arrowOwnedByControl($('#s'), 'right')).toBe(false)
  })

  it('文本框：光标在中间时左右键移光标，到头了才放行', () => {
    mount('<input id="i" type="text" value="abc">')
    const input = $('#i') as HTMLInputElement
    input.setSelectionRange(1, 1)
    expect(arrowOwnedByControl(input, 'left')).toBe(true)
    input.setSelectionRange(3, 3)
    expect(arrowOwnedByControl(input, 'right')).toBe(false)
    expect(arrowOwnedByControl(input, 'left')).toBe(true)
    input.setSelectionRange(0, 0)
    expect(arrowOwnedByControl(input, 'left')).toBe(false)
    expect(arrowOwnedByControl(input, 'down')).toBe(false)
  })

  it('菜单里的方向键全归菜单', () => {
    mount('<div role="menu"><div role="menuitem" tabindex="0" id="m"></div></div>')
    expect(arrowOwnedByControl($('#m'), 'down')).toBe(true)
    expect(arrowOwnedByControl($('#m'), 'left')).toBe(true)
  })

  it('普通按钮不管方向键；data-nav-own 可以声明', () => {
    mount('<button id="b"></button><div data-nav-own="x"><button id="c"></button></div>')
    expect(arrowOwnedByControl($('#b'), 'left')).toBe(false)
    expect(arrowOwnedByControl($('#c'), 'left')).toBe(true)
    expect(arrowOwnedByControl($('#c'), 'up')).toBe(false)
  })
})

describe('找下一个', () => {
  it('嵌在封面卡里的播放键不当候选：往右是下一张卡', () => {
    mount(`
      <div role="button" tabindex="0" id="a" data-rect="0,0,100,140"><button id="a-play" data-rect="60,60,30,30"></button></div>
      <div role="button" tabindex="0" id="b" data-rect="120,0,100,140"><button id="b-play" data-rect="180,60,30,30"></button></div>
    `)
    expect(findNext($('#a'), 'right')?.id).toBe('b')
    expect(findNext($('#b'), 'left')?.id).toBe('a')
  })

  it('换排时回到那一排上次停的位置', () => {
    mount(`
      <div data-nav-group="shelf" id="row1">
        <button id="r1a" data-rect="0,0,100,100"></button>
        <button id="r1b" data-rect="120,0,100,100"></button>
        <button id="r1c" data-rect="240,0,100,100"></button>
      </div>
      <div data-nav-group="shelf" id="row2">
        <button id="r2a" data-rect="0,200,100,100"></button>
        <button id="r2b" data-rect="120,200,100,100"></button>
        <button id="r2c" data-rect="240,200,100,100"></button>
      </div>
    `)
    const uninstall = installSpatialNav()
    $('#r2c').focus() // 第二排上次停在第三张
    $('#r1a').focus()
    // 从第一排第一张往下：几何上最近的是 r2a，但第二排记着 r2c——它也在下面，回到 r2c
    expect(findNext($('#r1a'), 'down')?.id).toBe('r2c')
    uninstall()
  })

  it('进导航条落在当前页那一项；导航条里上下键不会掉进内容区', () => {
    mount(`
      <nav data-nav-group="rail" data-nav-contain="y">
        <a href="/search" id="search" data-rect="40,90,40,40"></a>
        <a href="/" id="home" data-rect="40,140,40,40" data-nav-preferred=""></a>
        <a href="/settings" id="settings" data-rect="40,480,40,40"></a>
      </nav>
      <button id="content" data-rect="120,90,200,60"></button>
      <button id="below" data-rect="40,600,200,60"></button>
    `)
    expect(findNext($('#content'), 'left')?.id).toBe('home')
    expect(findNext($('#search'), 'down')?.id).toBe('home')
    expect(findNext($('#settings'), 'down')).toBeNull()
    expect(findNext($('#home'), 'right')?.id).toBe('content')
  })

  it('歌曲行：按右进入行内按钮，最左再按左回到行，上下换行', () => {
    mount(`
      <div role="button" tabindex="0" data-nav-row="" id="row1" data-rect="0,0,600,50">
        <button id="r1-artist" data-rect="60,25,80,16"></button>
        <button id="r1-heart" data-rect="500,8,34,34"></button>
        <button id="r1-more" data-rect="550,8,34,34"></button>
      </div>
      <div role="button" tabindex="0" data-nav-row="" id="row2" data-rect="0,50,600,50">
        <button id="r2-heart" data-rect="500,58,34,34"></button>
      </div>
      <a href="/rail" id="rail" data-rect="-80,0,40,40"></a>
    `)
    expect(findNext($('#row1'), 'down')?.id).toBe('row2')
    expect(findNext($('#row1'), 'right')?.id).toBe('r1-artist')
    expect(findNext($('#r1-artist'), 'right')?.id).toBe('r1-heart')
    expect(findNext($('#r1-heart'), 'right')?.id).toBe('r1-more')
    expect(findNext($('#r1-more'), 'right')).toBeNull()
    // 行内往左：不会跳到导航条，最左边回到行本身
    expect(findNext($('#r1-artist'), 'left')?.id).toBe('row1')
    // 行内按钮往下：下一行（而不是下一行里的按钮）
    expect(findNext($('#r1-heart'), 'down')?.id).toBe('row2')
    // 行本身往左才离开这一排
    expect(findNext($('#row1'), 'left')?.id).toBe('rail')
  })

  it('一排的最后一个往右是到头了，不会斜着跳到下面那一排', () => {
    mount(`
      <button id="end" data-rect="800,0,60,40"></button>
      <button id="far" data-rect="900,600,160,200"></button>
    `)
    expect(findNext($('#end'), 'right')).toBeNull()
    expect(findNext($('#end'), 'down')?.id).toBe('far')
  })

  it('书架里滚出可视区的卡，从书架外面看不见', () => {
    mount(`
      <button id="out" data-rect="200,0,100,40"></button>
      <div data-nav-shelf="" data-nav-group="shelf" data-rect="100,100,800,240">
        <div role="button" tabindex="0" id="gone" data-rect="-300,100,160,240"></div>
        <div role="button" tabindex="0" id="first" data-rect="100,100,160,240"></div>
      </div>
    `)
    expect(findNext($('#out'), 'down')?.id).toBe('first')
    // 沿着书架走过去还是可以的
    expect(findNext($('#first'), 'left')?.id).toBe('gone')
  })

  it('导航条只能横着进：内容区按上下不掉进去；横着出去回到进来之前那一个', () => {
    mount(`
      <nav data-nav-group="rail" data-nav-contain="y" data-nav-enter="x">
        <a href="/" id="home" data-nav-w="38" data-rect="48,100,170,38" data-nav-preferred=""></a>
        <a href="/settings" id="settings" data-nav-w="38" data-rect="48,480,170,38"></a>
      </nav>
      <div role="button" tabindex="0" id="card1" data-rect="116,60,160,240"></div>
      <div role="button" tabindex="0" id="card2" data-rect="296,60,160,240"></div>
    `)
    const uninstall = installSpatialNav()
    // 收起的导航条只算图标那一截（48..86），第一列往左进得去
    expect(findNext($('#card1'), 'left')?.id).toBe('home')
    // 第一列往下：下面没有内容了，也不掉进导航条
    expect(findNext($('#card1'), 'down')).toBeNull()
    $('#card2').focus()
    $('#home').focus()
    expect(findNext($('#home'), 'right')?.id).toBe('card2')
    // 设置那一项和内容不在一条光束里，照样出得去
    expect(findNext($('#settings'), 'right')?.id).toBe('card2')
    uninstall()
  })

  it('工具栏（data-nav-last）排在最后：往上先到页面顶上的标签，没有了才到它', () => {
    mount(`
      <div data-nav-last=""><button id="chip" data-rect="750,19,160,34"></button></div>
      <button id="tab" data-rect="116,55,120,36"></button>
      <button id="playAll" data-rect="643,109,136,48"></button>
    `)
    expect(findNext($('#playAll'), 'up')?.id).toBe('tab')
    expect(findNext($('#tab'), 'up')?.id).toBe('chip')
  })

  it('进一组选项落在选中的那一项上', () => {
    mount(`
      <div role="radiogroup">
        <button role="radio" aria-checked="true" id="auto" data-rect="600,0,80,38"></button>
        <button role="radio" aria-checked="false" id="on" data-rect="680,0,80,38"></button>
        <button role="radio" aria-checked="false" id="off" data-rect="760,0,80,38"></button>
      </div>
      <button id="below" data-rect="700,100,200,40"></button>
    `)
    expect(findNext($('#below'), 'up')?.id).toBe('auto')
    // 组里左右走照常
    expect(findNext($('#auto'), 'right')?.id).toBe('on')
  })

  it('跳过 data-nav-skip 与 aria-hidden 的子树', () => {
    mount(`
      <button id="a" data-rect="0,0,100,40"></button>
      <button id="skip" data-nav-skip="" data-rect="120,0,100,40"></button>
      <div aria-hidden="true"><button id="hidden" data-rect="240,0,100,40"></button></div>
      <button id="c" data-rect="360,0,100,40"></button>
    `)
    expect(findNext($('#a'), 'right')?.id).toBe('c')
  })

  it('没有焦点时先落在 data-tv-autofocus 上', () => {
    mount(`
      <main>
        <button id="first" data-rect="0,0,100,40"></button>
        <button id="auto" data-tv-autofocus="" data-rect="0,60,100,40"></button>
      </main>
    `)
    expect(initialFocusTarget(document.body)?.id).toBe('auto')
  })
})

describe('装上以后', () => {
  it('方向键挪焦点、吃掉按键；走到头轻推一下', () => {
    mount(`
      <button id="a" data-rect="0,0,100,40"></button>
      <button id="b" data-rect="120,0,100,40"></button>
    `)
    const uninstall = installSpatialNav()
    $('#a').focus()
    const right = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })
    window.dispatchEvent(right)
    expect(document.activeElement?.id).toBe('b')
    expect(right.defaultPrevented).toBe(true)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))
    expect(document.activeElement?.id).toBe('b')
    expect($('#b').classList.contains('tv-bump-right')).toBe(true)
    uninstall()
  })

  it('滑块拿着左右键时不插手', () => {
    mount(`
      <div role="slider" tabindex="0" id="s" data-rect="0,0,300,20"></div>
      <button id="b" data-rect="320,0,100,40"></button>
    `)
    const uninstall = installSpatialNav()
    $('#s').focus()
    const right = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })
    window.dispatchEvent(right)
    expect(document.activeElement?.id).toBe('s')
    expect(right.defaultPrevented).toBe(false)
    uninstall()
  })

  it('拦截器先看按键：吃掉的那一下不挪焦点', () => {
    mount(`
      <button id="a" data-rect="0,0,100,40"></button>
      <button id="b" data-rect="120,0,100,40"></button>
    `)
    const uninstall = installSpatialNav()
    let wake = true
    const remove = addNavInterceptor(() => {
      const swallow = wake
      wake = false
      return swallow
    })
    $('#a').focus()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))
    expect(document.activeElement?.id).toBe('a')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))
    expect(document.activeElement?.id).toBe('b')
    remove()
    uninstall()
  })

  it('最上面那个打开的对话框是范围：焦点不会挪到它底下的页面上', () => {
    mount(`
      <button id="page" data-rect="300,0,100,40"></button>
      <div role="dialog" data-state="open">
        <button id="d1" data-rect="0,0,100,40"></button>
      </div>
    `)
    const uninstall = installSpatialNav()
    $('#d1').focus()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))
    expect(document.activeElement?.id).toBe('d1')
    uninstall()
  })
})
