/**
 * 逐字歌词：QQ 的 QRC、网易的 YRC → 增强 LRC（A2）的纯转换。
 *
 * 插件把各家逐字格式转成带 <mm:ss.xxx> 逐字标签的 LRC 放进原来的 rawLrc，
 * 宿主的 LRC 解析器再解析成 LyricLine.words。这里钉住：
 *  - 时间标签结构（行首 [..]、每段文字前的 <..>、行尾结束标记）；
 *  - 文字里的括号（如 "(Dum-Dum)"）不被当成时间标记；
 *  - QRC 的 XML 实体解码、元数据行原样保留；
 *  - YRC 的 JSON 制作人员行转成普通行、坏 JSON 行跳过；
 *  - 畸形输入返回 null，网易 getLyric 据此退回 lrc。
 */

import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { loadPlugin } from './harness.mjs'

const qq = loadPlugin('plugins/qqmusic').plugin
const netease = loadPlugin('plugins/netease').plugin

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

/** 把 QRC 内容包成解密后的 XML 形态（属性值里的换行写成真换行，和实际一样） */
function qrcXml(content) {
  return '<?xml version="1.0" encoding="utf-8"?>\n<QrcInfos>\n'
    + '<QrcHeadInfo SaveTime="1" Version="100"/>\n<LyricInfo LyricCount="1">\n'
    + '<Lyric_1 LyricType="1" LyricContent="' + content + '"/>\n</LyricInfo>\n</QrcInfos>'
}

/* ---------------- QQ：QRC → 增强 LRC ---------------- */

test('QRC：逐字行转成 [行开始]<词开始>文字…<结束>，元数据行原样保留', () => {
  const lrc = qq._crypto.qrcToLrc(qrcXml([
    '[ti:Title]',
    '[ar:Artist]',
    '[offset:0]',
    '[12340,1260]He (12340,300)made (12640,260)my (12900,200)heart(13100,500)',
    '[75000,900]你(75000,300)好(75300,600)',
  ].join('\n')))
  assert.equal(lrc, [
    '[ti:Title]',
    '[ar:Artist]',
    '[offset:0]',
    '[00:12.340]<00:12.340>He <00:12.640>made <00:12.900>my <00:13.100>heart<00:13.600>',
    '[01:15.000]<01:15.000>你<01:15.300>好<01:15.900>',
  ].join('\n'))
})

test('QRC：文字里的括号不是时间标记，只认 (数字,数字)', () => {
  const lrc = qq._crypto.qrcToLrc(qrcXml('[1000,2000]Song (1000,400)(Dum-Dum)(1400,600)'))
  assert.equal(lrc, '[00:01.000]<00:01.000>Song <00:01.400>(Dum-Dum)<00:02.000>')
})

test('QRC：LyricContent 里的 XML 实体解码（命名实体 + &#10; 换行）', () => {
  const content = '[1000,500]Don&apos;t (1000,200)&quot;stop&quot;(1200,300)&#10;'
    + '[2000,500]R&amp;B (2000,250)&lt;3(2250,250)'
  const lrc = qq._crypto.qrcToLrc(qrcXml(content))
  assert.equal(lrc, [
    "[00:01.000]<00:01.000>Don't <00:01.200>\"stop\"<00:01.500>",
    '[00:02.000]<00:02.000>R&B <00:02.250><3<00:02.500>',
  ].join('\n'))
  assert.equal(qq._crypto.decodeXmlEntities('&#x41;&#66;&bogus;'), 'AB&bogus;')
})

test('QRC：没有逐字标记的行当普通行；空文字行丢掉', () => {
  const lrc = qq._crypto.qrcToLrc(qrcXml('[0,1000]纯文字\n[1000,500](1000,500)'))
  assert.equal(lrc, '[00:00.000]纯文字')
})

test('QRC：畸形输入返回 null（调用方据此退回 qrc: 0 的普通 LRC）', () => {
  assert.equal(qq._crypto.qrcToLrc('<QrcInfos></QrcInfos>'), null)
  assert.equal(qq._crypto.qrcToLrc(qrcXml('')), null)
  assert.equal(qq._crypto.qrcToLrc(qrcXml('[ti:only meta]\ngarbage')), null)
})

/* ---------------- 网易：YRC → 增强 LRC ---------------- */

test('YRC：时间标记在文字前面，转成 [行开始]<词开始>文字…<结束>', () => {
  const lrc = netease._crypto.yrcToLrc([
    '[16210,1260](16210,300,0)He (16510,260,0)made (16770,700,0)it',
    '[61000,900](61000,300,0)你(61300,600,0)好',
  ].join('\n'))
  assert.equal(lrc, [
    '[00:16.210]<00:16.210>He <00:16.510>made <00:16.770>it<00:17.470>',
    '[01:01.000]<01:01.000>你<01:01.300>好<01:01.900>',
  ].join('\n'))
})

test('YRC：文字里的括号不是时间标记，只认 (数字,数字,数字)', () => {
  const lrc = netease._crypto.yrcToLrc('[1000,2000](1000,400,0)Song (1400,600,0)(Dum-Dum)')
  assert.equal(lrc, '[00:01.000]<00:01.000>Song <00:01.400>(Dum-Dum)<00:02.000>')
})

test('YRC：JSON 制作人员行转成普通行（tx 连起来），坏 JSON 行跳过', () => {
  const lrc = netease._crypto.yrcToLrc([
    '{"t":0,"c":[{"tx":"作词: "},{"tx":"某某"}]}',
    '{"t":1500,"c":[{"tx":"作曲: "},{"tx":"某某"}]}',
    '{"t":broken',
    '[3000,500](3000,500,0)词',
  ].join('\n'))
  assert.equal(lrc, [
    '[00:00.000]作词: 某某',
    '[00:01.500]作曲: 某某',
    '[00:03.000]<00:03.000>词<00:03.500>',
  ].join('\n'))
})

test('YRC：畸形输入返回 null（只有制作人员行也算没有有效歌词）', () => {
  assert.equal(netease._crypto.yrcToLrc(''), null)
  assert.equal(netease._crypto.yrcToLrc('{"t":0,"c":[{"tx":"作词: 某某"}]}'), null)
  assert.equal(netease._crypto.yrcToLrc('not a lyric'), null)
})

/* ---------------- 网易 getLyric：有 yrc 用 yrc，转不出退回 lrc ---------------- */

function stubLyricResponse(body) {
  globalThis.fetch = async (url) => {
    if (String(url).includes('/eapi/song/lyric/v1')) {
      return new Response(JSON.stringify(Object.assign({ code: 200 }, body)), {
        status: 200, headers: { 'content-type': 'application/json' },
      })
    }
    throw new Error('unexpected request: ' + url)
  }
}

test('网易 getLyric：有 yrc 转成增强 LRC；translation 不动', async () => {
  const { plugin } = loadPlugin('plugins/netease', { credentials: 'MUSIC_U=test' })
  stubLyricResponse({
    lrc: { lyric: '[00:01.00]词' },
    tlyric: { lyric: '[00:01.00]译' },
    yrc: { lyric: '[1000,500](1000,500,0)词' },
  })
  const lyric = await plugin.getLyric({ id: '1' })
  assert.equal(lyric.rawLrc, '[00:01.000]<00:01.000>词<00:01.500>')
  assert.equal(lyric.translation, '[00:01.00]译')
})

test('网易 getLyric：yrc 转不出有效行 / 没有 yrc 时照旧用 lrc', async () => {
  const { plugin } = loadPlugin('plugins/netease', { credentials: 'MUSIC_U=test' })
  stubLyricResponse({ lrc: { lyric: '[00:01.00]词' }, yrc: { lyric: 'garbage' } })
  assert.equal((await plugin.getLyric({ id: '1' })).rawLrc, '[00:01.00]词')
  stubLyricResponse({ lrc: { lyric: '[00:01.00]词' } })
  assert.equal((await plugin.getLyric({ id: '1' })).rawLrc, '[00:01.00]词')
})
