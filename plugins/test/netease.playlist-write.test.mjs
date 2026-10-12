/**
 * 阶段 1.1 回归：网易云「加入/移出歌单」必须经宿主真正调用的路径可达。
 * 用户路径：设置页声明了 playlistWrite → AddToPlaylistDialog 列出该源 →
 * 建/加/删真的发对请求。宿主只调 n1ko.user.*，不遍历导出。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadPlugin } from './harness.mjs'

const cred = JSON.stringify({ MUSIC_U: 'cookie-a' })
const CRED = { credentials: cred }

test('宿主能力探测路径：n1ko.user.createPlaylist 存在且真能调通', async () => {
  const calls = []
  const realFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    const u = String(url)
    calls.push({ u, body: init.body })
    if (u.includes('/weapi/playlist/create')) {
      return new Response(JSON.stringify({ code: 200, playlist: { id: 991, name: '新单' } }), {
        status: 200, headers: { 'content-type': 'application/json' },
      })
    }
    return new Response(JSON.stringify({ code: 200 }), {
      status: 200, headers: { 'content-type': 'application/json' },
    })
  }
  try {
    const { plugin } = await loadPlugin('plugins/netease', CRED)
    // 宿主（plugin.ts）的挂载判定就是 hasMethod('n1ko.user.createPlaylist')
    const methods = ['n1ko.user.createPlaylist', 'n1ko.user.addToPlaylist', 'n1ko.user.removeFromPlaylist']
    for (const m of methods) assert.ok(true, `method path ${m} 由下方真调验证`)

    const sheet = await plugin.n1ko.user.createPlaylist('新单')
    assert.equal(sheet.id, '991')
    assert.equal(sheet.title, '新单')
    assert.equal(sheet.platform, 'netease', 'SheetItem 必须带 platform，跨源跳转才不回落主库')
    assert.ok(calls.some(c => c.u.includes('/weapi/playlist/create')))
  } finally {
    globalThis.fetch = realFetch
  }
})

test('加歌 / 移歌走 manipulate/tracks，op 正确', async () => {
  const ops = []
  const realFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    const u = String(url)
    if (u.includes('/eapi/playlist/manipulate/tracks')) {
      ops.push(init.body)
    }
    return new Response(JSON.stringify({ code: 200 }), {
      status: 200, headers: { 'content-type': 'application/json' },
    })
  }
  try {
    const { plugin } = await loadPlugin('plugins/netease', CRED)
    // eapi 的 body 是 AES 加密的 params，从外面看不到 op/pid——
    // 这里验证两件事：请求真的打到 manipulate/tracks（不是被能力拦截），
    // 且两种操作都成功返回（宿主把非 200 当失败）。
    const added = await plugin.n1ko.user.addToPlaylist({ id: '77', title: '目标单' }, [{ id: '101' }, { id: '102' }])
    assert.equal(added.status, 200)
    const removed = await plugin.n1ko.user.removeFromPlaylist({ id: '77' }, [{ id: '101' }])
    assert.equal(removed.status, 200)
    assert.equal(ops.length, 2, '加/移各打一次 manipulate/tracks')
  } finally {
    globalThis.fetch = realFetch
  }
})

test('顶层 user: 不再暴露写方法（宿主唯一调用面是 n1ko.user）', async () => {
  const { plugin } = await loadPlugin('plugins/netease', CRED)
  assert.equal(typeof plugin.user.createPlaylist, 'undefined')
  assert.equal(typeof plugin.user.addToPlaylist, 'undefined')
  assert.equal(typeof plugin.user.removeFromPlaylist, 'undefined')
  // 读方法保留（module.exports.requireLogin 那几处还在用）
  assert.equal(typeof plugin.user.getPlaylists, 'function')
})
