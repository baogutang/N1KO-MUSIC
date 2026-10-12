/**
 * 复审 B16 / D1：测试基建与真沙箱的语义对齐。
 *
 * D1 修正：harness 的 setCredentials 改为**只记录回写值**（真沙箱不改写
 * env.credentials 快照）。原先 harness 会改写，A8 的「合并凭据」用例
 * 靠这个错误语义变绿——删掉插件里的 liveCredentials 兜底测试照样绿。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadPlugin } from './harness.mjs'

test('harness 的 setCredentials 是快照语义：只记录，不改 env.credentials', async () => {
  const { env, credentialsWrites } = await loadPlugin('plugins/netease', { credentials: 'OLD' })
  assert.equal(env.credentials, 'OLD')
  env.setCredentials('NEW')
  // 真沙箱行为：env.credentials 仍是 init 快照
  assert.equal(env.credentials, 'OLD')
  // 回写值被记录，供断言
  assert.deepEqual(credentialsWrites, ['NEW'])
})

test('qqmusic 刷新后的合并凭据靠 liveCredentials 生效（删掉兜底此用例必红）', async () => {
  // 场景与 A8① 相同：刷新响应只有 musickey/refresh_key，
  // harness 不改写 env.credentials → 若插件没有 liveCredentials，
  // 第二次请求仍拿旧 key。
  let refreshCount = 0
  const bodies = []
  const realFetch = globalThis.fetch
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body)
    bodies.push(body)
    if (body.req_0.module === 'music.login.LoginServer') {
      refreshCount += 1
      return new Response(JSON.stringify({
        req_0: { code: 0, data: { musickey: `KEY-${refreshCount}`, refresh_key: 'RK' } },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return new Response(JSON.stringify({
      req_0: { code: 0, data: { v_playlist: [] } },
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  try {
    const credJson = JSON.stringify({
      musicid: 12345, str_musicid: '12345', musickey: 'OLD-KEY', refresh_key: 'RK0',
      openid: 'OPENID-1', refresh_token: 'RT-1', access_token: 'AT-1',
      expired_in: 7776000, expiresAt: Date.now() + 60 * 1000, loginType: 2,
    })
    const { plugin, env, credentialsWrites } = await loadPlugin('plugins/qqmusic', { credentials: credJson })
    await plugin.n1ko.user.getPlaylists()
    await plugin.n1ko.user.getPlaylists()

    // env.credentials 还是 init 快照（harness 不改写）——第二次请求用了新 key
    // 只可能来自插件内部的 liveCredentials。
    const dataCalls = bodies.filter(b => b.req_0.module !== 'music.login.LoginServer')
    // 到期窗口内：第一笔请求就先刷新，刷新后的 key 只能经 liveCredentials 生效
    // （harness 不改写 env.credentials 快照）——删掉兜底时这里会是 OLD-KEY。
    assert.equal(env.credentials, credJson, 'env.credentials 仍是 init 快照')
    assert.equal(dataCalls.length, 2)
    assert.equal(dataCalls[0].comm.authst, 'KEY-1', '刷新后的 key 经 liveCredentials 立即生效')
    // E1：响应没给 expired_in 也按旧寿命（expired_in）续期——第二笔请求
    // 已在刷新窗口外，不再刷新，仍用 KEY-1（原先这里是 KEY-2：逐请求刷新风暴）。
    assert.equal(dataCalls[1].comm.authst, 'KEY-1', '续期后不再逐请求刷新')
    assert.equal(refreshCount, 1, '整个过程只刷新一次')
    const renewed = JSON.parse(credentialsWrites.at(-1))
    assert.ok(renewed.expiresAt > Date.now() + 60 * 60 * 1000, '回写的凭据已按 expired_in 续期')
  } finally {
    globalThis.fetch = realFetch
  }
})

test('netease uid 缓存按凭据分键（D1：同一 storage 换凭据，真调 currentUid）', async () => {
  // 同一插件 storage（同一台设备）：凭据 A 登录后再换凭据 B，
  // 裸 'uid' 键会串号（B 直接吃到 A 的 uid，不再查账号接口）；
  // 按凭据指纹分键则 B 的键 miss、重新请求 account/get。
  const realFetch = globalThis.fetch
  const seen = []
  globalThis.fetch = async (url) => {
    const u = String(url)
    if (u.includes('/nuser/account/get')) {
      seen.push(u)
      return new Response(JSON.stringify({
        code: 200,
        account: { id: 42 },
        profile: { userId: 42, nickname: 'x' },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (u.includes('/api/song/like/get')) {
      return new Response(JSON.stringify({ code: 200, ids: [] }), {
        status: 200, headers: { 'content-type': 'application/json' },
      })
    }
    return new Response(JSON.stringify({ code: 200, songs: [] }), {
      status: 200, headers: { 'content-type': 'application/json' },
    })
  }
  try {
    const credA = JSON.stringify({ MUSIC_U: 'cookie-a' })
    const credB = JSON.stringify({ MUSIC_U: 'cookie-b' })
    const storageMap = new Map() // 共享：同一设备

    const a = await loadPlugin('plugins/netease', { credentials: credA, storageMap })
    await a.plugin.n1ko.user.getFavorites(1).catch(() => null)
    assert.equal(seen.length, 1, '凭据 A 首次收藏查询触发一次 account/get')

    // 预置旧版本裸 'uid' 脏数据（换凭据前的残留）
    storageMap.set('uid', 'stale-account-a')

    // 换凭据 B（同 storage）：指纹不同 → 缓存 miss → 再查一次
    const b = await loadPlugin('plugins/netease', { credentials: credB, storageMap })
    await b.plugin.n1ko.user.getFavorites(1).catch(() => null)
    assert.equal(seen.length, 2, '凭据 B 重新请求 account/get（裸 uid 键不串号）')

    // 两份凭据各有一把指纹键；裸键残留但没人读它
    const uidKeys = [...storageMap.keys()].filter(k => k.startsWith('uid:'))
    assert.equal(uidKeys.length, 2)
    assert.equal(storageMap.get('uid'), 'stale-account-a')
  } finally {
    globalThis.fetch = realFetch
  }
})
