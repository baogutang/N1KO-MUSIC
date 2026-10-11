/**
 * 阶段 2 回归：QQ 插件凭据生命周期 + 微信扫码登录。
 *
 * 用桩替换 globalThis.fetch 模拟上游接口（harness 的 axios 同形实现底层就是
 * 全局 fetch），钉住：
 *  - 到期前主动刷新：CGI music.login.LoginServer.Login 的 param 按 loginType
 *    分支（QQ=2 / 微信=1），comm 带 tmeLoginType；新凭据经 env.setCredentials 回写；
 *  - 数据接口撞上 unauthorized（1000/104400/104401）时先刷新再重试一次，
 *    刷新失败才把 unauthorized 抛出去（汇入登录状态）；
 *  - getUser 探针换成必须鉴权的 GetLoginUserInfo；
 *  - 微信扫码：createQr('wx') 取码（key 带 wx: 前缀）、checkQr 按 errcode 分派
 *    （408 waiting / 404 scanned / 405 confirmed+换凭据 / 402 过期 / 403 拒绝）；
 *  - 轮询超时（网络错误）映射成 waiting 而不是 expired。
 */

import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { loadPlugin } from './harness.mjs'

const realFetch = globalThis.fetch

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function textResponse(body, status = 200, headers = {}) {
  return new Response(body, { status, headers: { 'content-type': 'text/html' } })
}

/** 构造一段凭据 JSON（默认 QQ 登录态，快过期） */
function credJson(patch = {}) {
  return JSON.stringify(Object.assign({
    musicid: 12345,
    str_musicid: '12345',
    musickey: 'OLD-KEY',
    refresh_key: 'REFRESH-KEY-1',
    openid: 'OPENID-1',
    unionid: '',
    refresh_token: 'REFRESH-TOKEN-1',
    access_token: 'ACCESS-1',
    expired_in: 7776000,
    // 默认「10 分钟内到期」→ 触发主动刷新
    expiresAt: Date.now() + 60 * 1000,
    loginType: 2,
    nick: '',
    avatar: '',
  }, patch))
}

beforeEach(() => {})
afterEach(() => {
  globalThis.fetch = realFetch
})

test('parseWxPoll：errcode 与 code 的解析', async () => {
  const { plugin } = await loadPlugin('plugins/qqmusic')
  assert.deepEqual(
    plugin._crypto.parseWxPoll(`window.wx_errcode=408;window.wx_code='';`),
    { errcode: 408, code: '' }
  )
  assert.deepEqual(
    plugin._crypto.parseWxPoll(`window.wx_errcode=405;window.wx_code='CODE-X';`),
    { errcode: 405, code: 'CODE-X' }
  )
  assert.equal(plugin._crypto.parseWxPoll('garbage').errcode, null)
})

test('checkQr 按 key 前缀分派：wx: 走微信长轮询，errcode → 状态', async () => {
  globalThis.fetch = async () => textResponse(`window.wx_errcode=408;window.wx_code='';`)
  const { plugin } = await loadPlugin('plugins/qqmusic')
  assert.equal((await plugin.n1ko.auth.checkQr('wx:uuid-1')).status, 'waiting')

  globalThis.fetch = async () => textResponse(`window.wx_errcode=404;window.wx_code='';`)
  assert.equal((await plugin.n1ko.auth.checkQr('wx:uuid-1')).status, 'scanned')

  globalThis.fetch = async () => textResponse(`window.wx_errcode=402;window.wx_code='';`)
  assert.equal((await plugin.n1ko.auth.checkQr('wx:uuid-1')).status, 'expired')

  globalThis.fetch = async () => textResponse(`window.wx_errcode=403;window.wx_code='';`)
  const denied = await plugin.n1ko.auth.checkQr('wx:uuid-1')
  assert.equal(denied.status, 'expired')
  assert.equal(denied.reason, 'wx_denied')
})

test('checkQr 微信轮询网络超时映射成 waiting', async () => {
  globalThis.fetch = async () => {
    throw Object.assign(new Error('Request timeout after 20000ms'), {
      isAxiosError: true,
      code: 'network',
    })
  }
  const { plugin } = await loadPlugin('plugins/qqmusic')
  assert.equal((await plugin.n1ko.auth.checkQr('wx:uuid-1')).status, 'waiting')
})

test('createQr("wx")：uuid 从取码页提取，key 带 wx: 前缀，图为 data:image/jpeg', async () => {
  let qrconnectHit = false
  globalThis.fetch = async (url) => {
    const u = String(url)
    if (u.includes('open.weixin.qq.com/connect/qrconnect')) {
      qrconnectHit = true
      return textResponse('<html>var uuid="WX-UUID-123";</html>')
    }
    if (u.includes('open.weixin.qq.com/connect/qrcode/WX-UUID-123')) {
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 })
    }
    throw new Error('unexpected fetch: ' + u)
  }
  const { plugin } = await loadPlugin('plugins/qqmusic')
  const qr = await plugin.n1ko.auth.createQr('wx')
  assert.ok(qrconnectHit)
  assert.equal(qr.key, 'wx:WX-UUID-123')
  assert.ok(qr.qrImage.startsWith('data:image/jpeg;base64,'))
})

test('checkQr("wx:") 405 confirmed：code 换凭据并存 loginType 1', async () => {
  const requests = []
  globalThis.fetch = async (url, init) => {
    const u = String(url)
    if (u.includes('lp.open.weixin.qq.com')) {
      return textResponse(`window.wx_errcode=405;window.wx_code='WX-CODE-9';`)
    }
    if (u.includes('u.y.qq.com/cgi-bin/musicu.fcg')) {
      const body = JSON.parse(init.body)
      requests.push(body)
      return jsonResponse({ req_0: { code: 0, data: {
        musicid: 888, str_musicid: '888', musickey: 'WX-NEW-KEY', refresh_key: 'WX-RK',
        openid: 'WX-OPEN', unionid: 'WX-UNION', refresh_token: 'WX-RT', expired_in: 7776000,
      } } })
    }
    throw new Error('unexpected fetch: ' + u)
  }
  const { plugin } = await loadPlugin('plugins/qqmusic')
  const result = await plugin.n1ko.auth.checkQr('wx:uuid-1')
  assert.equal(result.status, 'confirmed')
  const cred = JSON.parse(result.credentials)
  assert.equal(cred.loginType, 1)
  assert.equal(cred.musickey, 'WX-NEW-KEY')
  assert.equal(cred.openid, 'WX-OPEN')
  assert.ok(cred.expiresAt > Date.now())
  // 换凭据的 CGI：comm.tmeLoginType=1，param 带 code 与 strAppid
  assert.equal(requests[0].comm.tmeLoginType, 1)
  assert.equal(requests[0].req_0.param.code, 'WX-CODE-9')
  assert.equal(requests[0].req_0.param.strAppid, 'wx48db31d50e334801')
})

test('到期前主动刷新：QQ param 分支 + tmeLoginType=2 + 回写凭据', async () => {
  const bodies = []
  let refreshDone = false
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body)
    bodies.push(body)
    if (body.req_0.module === 'music.login.LoginServer') {
      refreshDone = true
      return jsonResponse({ req_0: { code: 0, data: {
        musicid: 12345, str_musicid: '12345', musickey: 'NEW-KEY-2', refresh_key: 'RK-2',
        openid: 'OPENID-1', refresh_token: 'RT-2', access_token: 'AT-2', expired_in: 7776000,
      } } })
    }
    // 刷新后的数据请求
    return jsonResponse({ req_0: { code: 0, data: { songList: [] } } })
  }
  const { plugin, credentialsWrites } = await loadPlugin('plugins/qqmusic', { credentials: credJson() })
  await plugin.n1ko.user.getPlaylists()

  assert.ok(refreshDone, '应当先走一次刷新')
  const refreshReq = bodies.find(b => b.req_0.module === 'music.login.LoginServer')
  assert.equal(refreshReq.comm.tmeLoginType, 2)
  // QQ=2 分支的 param：openid/access_token/refresh_token/expired_in/musicid/musickey/refresh_key/loginMode
  const p = refreshReq.req_0.param
  assert.equal(p.openid, 'OPENID-1')
  assert.equal(p.access_token, 'ACCESS-1')
  assert.equal(p.refresh_token, 'REFRESH-TOKEN-1')
  assert.equal(p.expired_in, 7776000)
  assert.equal(p.musicid, 12345)
  assert.equal(p.musickey, 'OLD-KEY')
  assert.equal(p.refresh_key, 'REFRESH-KEY-1')
  assert.equal(p.loginMode, 2)
  // 新凭据已回写宿主（D1：harness 只记录回写值，env.credentials 是 init 快照）
  const stored = JSON.parse(credentialsWrites[0])
  assert.equal(stored.musickey, 'NEW-KEY-2')
  // 数据请求用新 key
  const dataReq = bodies.find(b => b.req_0.module !== 'music.login.LoginServer')
  assert.equal(dataReq.comm.authst, 'NEW-KEY-2')
})

test('微信凭据到期前主动刷新：param 走 WX 分支', async () => {
  const bodies = []
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body)
    bodies.push(body)
    if (body.req_0.module === 'music.login.LoginServer') {
      return jsonResponse({ req_0: { code: 0, data: {
        musicid: 888, str_musicid: '888', musickey: 'WX-NK', refresh_key: 'WX-RK2',
        openid: 'WX-OPEN', unionid: 'WX-UNION', refresh_token: 'WX-RT2', expired_in: 7776000,
      } } })
    }
    return jsonResponse({ req_0: { code: 0, data: {} } })
  }
  const { plugin } = await loadPlugin('plugins/qqmusic', {
    credentials: credJson({
      loginType: 1, openid: 'WX-OPEN', unionid: 'WX-UNION',
      refresh_token: 'WX-RT', access_token: '', musickey: 'WX-OLD', refresh_key: 'WX-RK',
      str_musicid: '888', musicid: 888,
    }),
  })
  await plugin.n1ko.user.getPlaylists()

  const refreshReq = bodies.find(b => b.req_0.module === 'music.login.LoginServer')
  assert.equal(refreshReq.comm.tmeLoginType, 1)
  const p = refreshReq.req_0.param
  // WX=1 分支：openid/refresh_token/str_musicid/musickey/unionid/refresh_key/loginMode（无 access_token）
  assert.equal(p.openid, 'WX-OPEN')
  assert.equal(p.refresh_token, 'WX-RT')
  assert.equal(p.str_musicid, '888')
  assert.equal(p.musickey, 'WX-OLD')
  assert.equal(p.unionid, 'WX-UNION')
  assert.equal(p.refresh_key, 'WX-RK')
  assert.equal(p.loginMode, 2)
  assert.equal('access_token' in p, false)
})

test('数据接口 unauthorized：刷新成功后重试原请求', async () => {
  const bodies = []
  let refreshed = false
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body)
    bodies.push(body)
    if (body.req_0.module === 'music.login.LoginServer') {
      refreshed = true
      return jsonResponse({ req_0: { code: 0, data: {
        musicid: 12345, str_musicid: '12345', musickey: 'KEY-AFTER-REFRESH', refresh_key: 'RK',
        expired_in: 7776000,
      } } })
    }
    if (!refreshed) {
      // 第一次数据请求：musickey 失效
      return jsonResponse({ req_0: { code: 104401, data: null } })
    }
    return jsonResponse({ req_0: { code: 0, data: { v_playlist: [] } } })
  }
  // expiresAt 在远未来：不触发主动刷新，只靠 104401 被动刷新
  const { plugin } = await loadPlugin('plugins/qqmusic', {
    credentials: credJson({ expiresAt: Date.now() + 24 * 3600 * 1000 }),
  })
  const result = await plugin.n1ko.user.getPlaylists()
  assert.deepEqual(result, { created: [], subscribed: [] })
  assert.ok(refreshed)
  // 数据请求发了两次（失败 → 刷新 → 重试）
  const dataCalls = bodies.filter(b => b.req_0.module !== 'music.login.LoginServer')
  assert.equal(dataCalls.length, 2)
  assert.equal(dataCalls[1].comm.authst, 'KEY-AFTER-REFRESH')
})

test('刷新失败：unauthorized 抛出（汇入登录状态），不再伪装成 unknown', async () => {
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body)
    if (body.req_0.module === 'music.login.LoginServer') {
      return jsonResponse({ req_0: { code: 1000, data: null } })
    }
    return jsonResponse({ req_0: { code: 104400, data: null } })
  }
  const { plugin } = await loadPlugin('plugins/qqmusic', {
    credentials: credJson({ expiresAt: Date.now() + 24 * 3600 * 1000 }),
  })
  await assert.rejects(
    () => plugin.n1ko.user.getPlaylists(),
    err => err.name === 'PluginError' && err.code === 'unauthorized'
  )
})

test('getUser 探针换成必须鉴权的 GetLoginUserInfo', async () => {
  const bodies = []
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body)
    bodies.push(body)
    if (body.req_0.method === 'GetLoginUserInfo') {
      return jsonResponse({ req_0: { code: 0, data: {
        Nick: '探针昵称', Avatar: 'https://a/img.jpg', IsVip: 1,
      } } })
    }
    return jsonResponse({ req_0: { code: 0, data: {} } })
  }
  const { plugin } = await loadPlugin('plugins/qqmusic', {
    credentials: credJson({ expiresAt: Date.now() + 24 * 3600 * 1000 }),
  })
  const user = await plugin.n1ko.auth.getUser()
  assert.equal(user.id, '12345')
  assert.equal(user.name, '探针昵称')
  assert.equal(user.vip, true)
  assert.equal(bodies.some(b => b.req_0.method === 'GetLoginUserInfo'), true)
  // 不再拿歌单接口当探针
  assert.equal(bodies.some(b => b.req_0.method === 'GetPlaylistByUin'), false)
})

test('未声明 methods 的旧宿主语义：createQr 不带参走 QQ 链路', async () => {
  let ptqrshowHit = false
  globalThis.fetch = async (url) => {
    const u = String(url)
    if (u.includes('ssl.ptlogin2.qq.com/ptqrshow')) {
      ptqrshowHit = true
      return new Response(new Uint8Array([9, 9]), {
        status: 200,
        headers: { 'set-cookie': 'qrsig=QRSIG123; Path=/' },
      })
    }
    throw new Error('unexpected fetch: ' + u)
  }
  const { plugin } = await loadPlugin('plugins/qqmusic')
  const qr = await plugin.n1ko.auth.createQr()
  assert.ok(ptqrshowHit)
  assert.equal(qr.key, 'QRSIG123')
  assert.ok(qr.qrImage.startsWith('data:image/png;base64,'))
})

test('复审 A8①：刷新响应只有 musickey/refresh_key 时与旧凭据合并，下一次刷新仍有料', async () => {
  const bodies = []
  let refreshCount = 0
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body)
    bodies.push(body)
    if (body.req_0.module === 'music.login.LoginServer') {
      refreshCount += 1
      if (refreshCount === 1) {
        // 第一次刷新：响应只给两样东西（QQ 扫码链路的真实形状）
        return jsonResponse({ req_0: { code: 0, data: { musickey: 'KEY-2', refresh_key: 'RK-2' } } })
      }
      // 第二次刷新：param 必须仍带旧凭据里的 openid/refresh_token/musicid
      return jsonResponse({ req_0: { code: 0, data: { musickey: 'KEY-3', refresh_key: 'RK-3' } } })
    }
    return jsonResponse({ req_0: { code: 0, data: { v_playlist: [] } } })
  }
  const { plugin, credentialsWrites } = await loadPlugin('plugins/qqmusic', { credentials: credJson({
    expiresAt: Date.now() + 60 * 1000, // 到期前 10 分钟窗口内 → 主动刷新
  }) })
  await plugin.n1ko.user.getPlaylists()

  // 回写值是最新一次合并的结果（最后一次刷新的回写）
  const stored = JSON.parse(credentialsWrites.at(-1))
  // 合并而不是覆盖：旧凭据的字段还在
  assert.equal(stored.openid, 'OPENID-1')
  assert.equal(stored.refresh_token, 'REFRESH-TOKEN-1')
  assert.equal(stored.musicid, 12345)
  assert.equal(stored.musickey, 'KEY-2')

  // 第二次数据请求（快过期的合并凭据）再触发一次刷新：param 仍带得齐全
  await plugin.n1ko.user.getPlaylists()
  const second = bodies.filter(b => b.req_0.module === 'music.login.LoginServer')[1]
  assert.equal(second.req_0.param.openid, 'OPENID-1')
  assert.equal(second.req_0.param.refresh_token, 'REFRESH-TOKEN-1')
  assert.equal(second.req_0.param.musicid, 12345)
})

test('复审 A8②：主动刷新遇 network 错误不致 unauthorized，旧 key 继续工作', async () => {
  let refreshCalls = 0
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body)
    if (body.req_0.module === 'music.login.LoginServer') {
      refreshCalls += 1
      throw Object.assign(new Error('Request timeout after 20000ms'), { isAxiosError: true, code: 'network' })
    }
    // 数据接口照常成功（旧 key 有效）
    return jsonResponse({ req_0: { code: 0, data: { v_playlist: [] } } })
  }
  const { plugin } = await loadPlugin('plugins/qqmusic', { credentials: credJson({
    expiresAt: Date.now() + 60 * 1000,
  }) })
  // 不抛 unauthorized：数据请求成功返回
  const result = await plugin.n1ko.user.getPlaylists()
  assert.deepEqual(result, { created: [], subscribed: [] })
  assert.ok(refreshCalls >= 1, '确实尝试过刷新')
})
