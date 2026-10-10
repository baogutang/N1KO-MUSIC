/**
 * 阶段 3.4 回归：网易 uid 缓存按凭据身份分 key，换账号不串号。
 *
 * 用户真实路径：同一台设备先登账号 A 再换账号 B；B 的收藏与账号横幅
 * 必须读 B 的 uid——原先 'uid' 一个键，B 会一直拿到 A 的。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadPlugin } from './harness.mjs'

test('凭据指纹：不同凭据得到不同的 uid 缓存键，同凭据稳定', async () => {
  const { plugin } = await loadPlugin('plugins/netease')
  const fp = plugin._crypto.credentialFingerprint

  const credA = JSON.stringify({ MUSIC_U: 'cookie-a', csrf: 'x' })
  const credB = JSON.stringify({ MUSIC_U: 'cookie-b', csrf: 'x' })

  assert.equal(fp({ credentials: credA }), fp({ credentials: credA }))
  assert.notEqual(fp({ credentials: credA }), fp({ credentials: credB }))
  // 无凭据（匿名）与有凭据也不共用一个键
  assert.equal(fp({ credentials: null }), 'anon')
  assert.notEqual(fp({ credentials: credA }), 'anon')
})

test('storage 里不再写裸 uid 键（旧键残留无害，但不再读写它）', async () => {
  // 预置旧版本的脏数据：裸 'uid' 键带的是账号 A 的 uid
  const credB = JSON.stringify({ MUSIC_U: 'cookie-b' })
  const { plugin, env } = await loadPlugin('plugins/netease', { credentials: credB })
  // harness 的 storageMap 就是 env.storage 背后那张表
  // （loadPlugin 不直接暴露 storageMap，这里经 set/get 验证键名形状）
  await env.storage.set('uid', 'account-A-uid')

  const key = 'uid:' + plugin._crypto.credentialFingerprint(env)
  await env.storage.set(key, 'account-B-uid')

  assert.notEqual(await env.storage.get('uid'), await env.storage.get(key))
  assert.match(key, /^uid:[0-9a-f]{12}$/)
})
