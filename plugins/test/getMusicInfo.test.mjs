/**
 * 阶段 1.4 回归：网易/QQ 的歌从链接打开详情页（/songs/:id?src=插件），
 * 宿主会调 getMusicInfo 补全——原先只有 mock 实现，两家一律「找不到」。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadPlugin } from './harness.mjs'

test('netease getMusicInfo：v3/song/detail 按 id 补全，与搜索结果同形', async () => {
  const realFetch = globalThis.fetch
  let hit = false
  globalThis.fetch = async (url) => {
    const u = String(url)
    if (u.includes('/weapi/v3/song/detail')) {
      hit = true
      return new Response(JSON.stringify({
        code: 200,
        songs: [{
          id: 227766, name: '晴天', al: { id: 1, name: '叶惠美', picUrl: 'https://p/x.jpg' },
          ar: [{ id: 6452, name: '周杰伦' }], dt: 269000,
        }],
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return new Response(JSON.stringify({ code: 200 }), {
      status: 200, headers: { 'content-type': 'application/json' },
    })
  }
  try {
    const { plugin } = await loadPlugin('plugins/netease')
    const item = await plugin.getMusicInfo({ id: '227766' })
    assert.ok(hit, '真的打了 v3/song/detail')
    assert.equal(item.id, '227766')
    assert.equal(item.title, '晴天')
    assert.equal(item.artist, '周杰伦')
    assert.equal(item.album, '叶惠美')
    assert.equal(item.duration, 269)
  } finally {
    globalThis.fetch = realFetch
  }
})

test('qqmusic getMusicInfo：mid 当关键词搜，精确匹配同 mid', async () => {
  const realFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body)
    if (body.req_0.module === 'music.adaptor.SearchAdaptor') {
      return new Response(JSON.stringify({
        req_0: { code: 0, data: { body: { item_song: [{
          mid: 'abcDEF12345678', title: '测试曲', singer: [{ mid: 's1', name: '某歌手' }],
          album: { mid: 'al1', title: '某专辑', pmid: 'al1' }, interval: 200, pay: {},
          file: { media_mid: 'abcDEF12345678' },
        }, {
          mid: 'otherMID00000A', title: '同名干扰', singer: [], album: {}, interval: 100,
        }] } } },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return new Response(JSON.stringify({ req_0: { code: 0, data: {} } }), {
      status: 200, headers: { 'content-type': 'application/json' },
    })
  }
  try {
    const { plugin } = await loadPlugin('plugins/qqmusic')
    const item = await plugin.getMusicInfo({ id: 'abcDEF12345678' })
    assert.equal(item.id, 'abcDEF12345678')
    assert.equal(item.title, '测试曲')
    assert.equal(item.artist, '某歌手')
    // 空结果返回 null（宿主据此走「找不到」，不造空白档案）
    assert.equal(await plugin.getMusicInfo({ id: 'zzz' }), null)
  } finally {
    globalThis.fetch = realFetch
  }
})
