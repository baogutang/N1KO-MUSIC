/**
 * 网易云真实网络测试（PLAN 阶段 3）：需要外网，默认跳过。
 *
 *   N1KO_NETEASE_LIVE=1 npm run test:plugins
 *
 * 覆盖：匿名注册、搜索、榜单、二维码 key 创建、免费曲取流、歌词。
 * 扫码登录与 VIP 曲按账号权益的播放，属于需要 N1KO 手机的验收清单，
 * 不在自动测试里。
 */

import { test } from 'node:test'
import assert from 'node:assert'
import { loadPlugin } from './harness.mjs'

const LIVE = process.env.N1KO_NETEASE_LIVE === '1'

test('匿名 + 搜索 + 榜单 + 二维码 key + 免费曲取流 + 歌词', { skip: !LIVE }, async () => {
  const { plugin } = await loadPlugin('plugins/netease')

  // 搜索（匿名令牌自动注册）
  const songs = await plugin.search('海阔天空', 1, 'music')
  assert.ok(songs.data.length > 0, '搜索应有结果')
  const free = songs.data.find(s => !s.vip)
  assert.ok(free, '应至少有一首非 VIP 曲')
  assert.ok(free.duration > 0)

  // 榜单
  const lists = await plugin.getTopLists()
  assert.ok(lists.length >= 1 && lists[0].data.length > 0, '榜单不为空')

  // 二维码 key（不真正扫码，只验证创建链路）
  const qr = await plugin.getQRCode()
  assert.ok(qr.key)
  assert.ok(qr.content.includes('codekey='))

  // 免费曲取流（匿名可听 standard 档）
  const source = await plugin.getMediaSource(free, 'low')
  assert.ok(source.url, '免费曲应拿到流地址')
  assert.ok(source.url.startsWith('http'))

  // 歌词
  const lyric = await plugin.getLyric(free)
  assert.ok(typeof lyric.rawLrc === 'string')
})
