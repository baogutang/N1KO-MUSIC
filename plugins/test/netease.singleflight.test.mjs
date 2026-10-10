/**
 * 复审 B15：匿名 cookie 注册的 single-flight。
 * 冷启动四类搜索并发时，匿名注册只应发生一次。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadPlugin } from './harness.mjs'

test('并发的匿名请求只注册一次匿名 cookie', async () => {
  let registrations = 0
  const realFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    const u = String(url)
    if (u.includes('/weapi/register/anonimous')) {
      registrations += 1
      await new Promise(r => setTimeout(r, 30)) // 拉长在飞窗口，让并发全撞上
      return new Response(JSON.stringify({ code: 200 }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'set-cookie': 'MUSIC_A=anon-token; Path=/, __csrf=abc; Path=/',
        },
      })
    }
    if (u.includes('/weapi/search')) {
      return new Response(JSON.stringify({ code: 200, result: { songs: [] } }), {
        status: 200, headers: { 'content-type': 'application/json' },
      })
    }
    // 其余（detail 等）一律回空成功
    return new Response(JSON.stringify({ code: 200 }), {
      status: 200, headers: { 'content-type': 'application/json' },
    })
  }

  try {
    const { plugin } = await loadPlugin('plugins/netease')
    // 四类搜索并发（复现 F13 并发后的冷启动形态）
    const q = 'test'
    await Promise.all([
      plugin.search(q, 1, 'music').catch(() => null),
      plugin.search(q, 1, 'album').catch(() => null),
      plugin.search(q, 1, 'artist').catch(() => null),
      plugin.search(q, 1, 'sheet').catch(() => null),
    ])
    assert.equal(registrations, 1, '四路并发只允许一次匿名注册')
  } finally {
    globalThis.fetch = realFetch
  }
})
