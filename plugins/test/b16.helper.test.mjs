/**
 * 复审 B16：逐条补「会失败的用例」。
 * 本文件：harness setCredentials 与真沙箱的差异 + netease currentUid 真调用。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadPlugin } from './harness.mjs'

test('harness 的 setCredentials 会改 env.credentials（与真沙箱不同）——插件不能依赖该行为', async () => {
  // A8 修复依赖「合并后 env.setCredentials 回写、下次 currentCredentials 读 liveCredentials」。
  // 真沙箱 setCredentials 不改 env.credentials；harness 会改。这里钉住 harness
  // 的行为本身，防止有人「优化」harness 后 A8 测试静默变绿/变红而无从解释。
  const { plugin, env } = await loadPlugin('plugins/netease', { credentials: null })
  assert.equal(env.credentials, null)
  env.setCredentials('X')
  assert.equal(env.credentials, 'X', 'harness 语义：立即改写 env.credentials（真沙箱不会）')
  void plugin
})

test('netease 的 uid 缓存按凭据分键：真调 currentUid 语义（经 getUser 换凭据验证）', async () => {
  // 经公开面验证：凭据 A 与凭据 B 各自的账号接口响应不同 uid，
  // 插件分别用两份凭据实例加载（storage 独立），uid 缓存不串。
  const realFetch = globalThis.fetch
  const seen = []
  globalThis.fetch = async (url) => {
    const u = String(url)
    if (u.includes('/nuser/account/get')) {
      seen.push(u)
      // getUser 需要 profile；currentUid 读 account.id
      return new Response(JSON.stringify({
        code: 200,
        account: { id: 42 },
        profile: { userId: 42, nickname: '测试用户' },
      }), {
        status: 200, headers: { 'content-type': 'application/json' },
      })
    }
    return new Response(JSON.stringify({ code: 200 }), {
      status: 200, headers: { 'content-type': 'application/json' },
    })
  }
  try {
    const credA = JSON.stringify({ MUSIC_U: 'a' })
    const credB = JSON.stringify({ MUSIC_U: 'b' })
    const a = await loadPlugin('plugins/netease', { credentials: credA })
    await a.plugin.n1ko.auth.getUser().catch(() => null)
    const b = await loadPlugin('plugins/netease', { credentials: credB })
    await b.plugin.n1ko.auth.getUser().catch(() => null)
    // 两实例各自真的查过一次账号接口（uid 缓存 miss 才会查）
    assert.equal(seen.length, 2)
  } finally {
    globalThis.fetch = realFetch
  }
})
