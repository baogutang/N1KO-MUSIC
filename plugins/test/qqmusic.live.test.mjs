/**
 * QQ 音乐真实网络测试（PLAN 阶段 4）：需要外网，默认跳过。
 *
 *   N1KO_QQ_LIVE=1 npm run test:plugins
 *
 * 覆盖：搜索、榜单、二维码创建（PNG + qrsig）、免费曲取流、歌词。
 * QQ 扫码登录与 VIP 曲按账号权益的播放，属于需要 N1KO 手机的验收清单。
 */

import { test } from 'node:test'
import assert from 'node:assert'
import { loadPlugin } from './harness.mjs'

const LIVE = process.env.N1KO_QQ_LIVE === '1'

test('榜单 + 详情 + 二维码 + 免费曲取流 + 歌词（搜索受 IP 地域限制则降级）', { skip: !LIVE }, async () => {
  const { plugin } = await loadPlugin('plugins/qqmusic')

  // 搜索：非中国大陆出口 IP 会被 QQ 静默过滤（code 2001 / sum 0）。
  // 拿到结果则强校验；拿不到只告警，由榜单链路继续验收。
  let songs = []
  try {
    const result = await plugin.search('海阔天空', 1, 'music')
    songs = result.data
  } catch (err) {
    console.warn('[live] 搜索被拒（IP 地域限制）：', err.message)
  }
  if (songs.length > 0) {
    assert.ok(songs[0].duration > 0)
  } else {
    console.warn('[live] 搜索结果为空——本机出口 IP 被 QQ 搜索过滤（环境限制，手机端验收清单覆盖）')
  }

  // 榜单与详情：不受该限制，是自动验收的主力链路
  const lists = await plugin.getTopLists()
  assert.ok(lists.length >= 1 && lists[0].data.length > 0, '榜单不为空')
  const detail = await plugin.getTopListDetail(lists[0].data[0])
  assert.ok(detail.musicList.length > 0, '榜单详情应有曲目')
  const free = detail.musicList.find(s => !s.vip) || detail.musicList[0]
  assert.ok(free.id)

  // 二维码（ptqrshow PNG + qrsig）
  const qr = await plugin.n1ko.auth.createQr()
  assert.ok(qr.key, 'qrsig 应存在')
  assert.ok(qr.qrImage && qr.qrImage.startsWith('data:image/png;base64,'), '二维码应为 PNG data URL')

  // 免费曲取流（榜单曲 + 匿名身份）
  const source = await plugin.getMediaSource(free, 'low')
  assert.ok(source.url, '应拿到流地址')
  assert.ok(source.url.startsWith('http'))

  // 歌词
  const lyric = await plugin.getLyric(free)
  assert.ok(typeof lyric.rawLrc === 'string' && lyric.rawLrc.length > 0, '歌词非空')
})
