/**
 * 「按沙箱的方式调用」回归测试。
 *
 * 为什么单独有这么一个文件：沙箱运行时解析方法之后是**非绑定**调用的
 * （frontend/src/plugins/sandbox/runtime.ts 里 `resolveMethod(...)` 拿到函数、
 * 直接 `method(...args)`），`this` 并不指向导出对象。而其余测试都是
 * `plugin.n1ko.user.getPlaylists()` 这样的方法调用，`this` 是对的——
 * 于是「只在模块作用域缺了个名字」「方法里用了 this.xxx」这两类错误
 * 在测试里全绿，一到真机就是 ReferenceError / TypeError。
 *
 * 2026-09-04 实测踩到过一次：网易云扫码成功、搜索正常，但昵称、我的歌单、
 * 收藏全部抛 `requireLogin is not defined`，而首页只取成功的音源，
 * 于是整个网易云静默消失，用户看到的是「好像没连过」。
 *
 * 这里不联网：只断言**不是**那两类静态错误。真实网络失败（fetch 失败、
 * 接口返回错误码）都算通过——那是 live 测试的职责。
 */

import { test } from 'node:test'
import assert from 'node:assert'
import { loadPlugin } from './harness.mjs'

/** 与 runtime.ts 的 resolveMethod 同形：逐段取属性，取到的函数原样返回（不绑定） */
function resolveUnbound(exports, methodPath) {
  let current = exports
  for (const part of methodPath.split('.')) {
    if (!current || typeof current !== 'object') return null
    current = current[part]
  }
  return typeof current === 'function' ? current : null
}

/** 与 runtime.ts 的 collectMethodPaths 同形 */
function collectMethodPaths(exports) {
  const paths = []
  const walk = (obj, prefix, depth) => {
    for (const key of Object.keys(obj)) {
      if (prefix === '' && (key === 'platform' || key === 'version')) continue
      const value = obj[key]
      const path = prefix ? `${prefix}.${key}` : key
      if (typeof value === 'function') paths.push(path)
      else if (value && typeof value === 'object' && depth < 2) walk(value, path, depth + 1)
    }
  }
  walk(exports, '', 0)
  return paths
}

/** 这两类错误说明代码本身有问题，与网络无关 */
function isStaticFailure(err) {
  if (!err) return null
  const name = err.name || ''
  const msg = String(err.message || '')
  if (name === 'ReferenceError') return `ReferenceError: ${msg}`
  if (name === 'TypeError' && /\bthis\b|is not a function/.test(msg)) return `TypeError: ${msg}`
  return null
}

const PLUGINS = [
  { dir: 'plugins/netease', id: 'netease' },
  { dir: 'plugins/qqmusic', id: 'qqmusic' },
  { dir: 'plugins/mock', id: 'mock' },
]

/**
 * 每个方法给一份「形状对得上」的参数，让它至少能跑到第一次网络调用。
 * 参数不对导致的业务错误无所谓，我们只看是不是 ReferenceError / this 错误。
 */
const ARGS = {
  search: ['test', 1, 'music'],
  getMediaSource: [{ id: '1', platform: 'x' }, 'standard'],
  getMusicInfo: [{ id: '1', platform: 'x' }],
  getLyric: [{ id: '1', platform: 'x' }],
  getAlbumInfo: [{ id: '1', platform: 'x' }, 1],
  getMusicSheetInfo: [{ id: '1', platform: 'x' }, 1],
  getArtistWorks: [{ id: '1', platform: 'x' }, 1, 'music'],
  importMusicSheet: ['https://example.com/playlist?id=1'],
  importMusicItem: ['https://example.com/song?id=1'],
  getTopListDetail: [{ id: '1', platform: 'x' }, 1],
  getRecommendSheetsByTag: [{ id: '1', title: 't' }, 1],
  'n1ko.auth.checkQr': ['key'],
  'n1ko.auth.loginWithCookie': ['MUSIC_U=x'],
  'n1ko.user.getFavorites': [1],
  'n1ko.user.setFavorite': [{ id: '1', platform: 'x' }, true],
  'n1ko.user.createPlaylist': ['name'],
  'n1ko.user.addToPlaylist': [{ id: '1' }, [{ id: '1' }]],
  'n1ko.user.removeFromPlaylist': [{ id: '1' }, [{ id: '1' }]],
  'n1ko.getMediaSource': [{ id: '1', platform: 'x' }, 'standard'],
}

for (const { dir, id } of PLUGINS) {
  test(`${id}：每个导出方法都能按沙箱方式（非绑定）调用`, async () => {
    // 带凭据加载：否则用户域方法会在登录门就返回，走不到真正的实现
    const { plugin } = await loadPlugin(dir, { credentials: 'MUSIC_U=fake; __csrf=fake' })
    const paths = collectMethodPaths(plugin).filter(p => !p.startsWith('_'))
    assert.ok(paths.length > 0, '没有收集到任何方法路径')

    const failures = []
    for (const methodPath of paths) {
      const fn = resolveUnbound(plugin, methodPath)
      assert.ok(fn, `${methodPath} 解析不到函数`)
      try {
        await fn(...(ARGS[methodPath] ?? []))
      } catch (err) {
        const stat = isStaticFailure(err)
        if (stat) failures.push(`${methodPath} → ${stat}`)
      }
    }

    assert.deepEqual(
      failures,
      [],
      `这些方法在非绑定调用下就崩了（沙箱正是这样调用的）：\n${failures.join('\n')}`
    )
  })
}
