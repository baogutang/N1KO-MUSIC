/**
 * 阶段 5 / F18 的后端安全回归：
 *  - 改密吊销旧 token（token_version 递增）
 *  - 过期 / 篡改令牌被拒
 *  - CORS 拒绝名单外的 Origin（不回 ACAO 头）
 *  - 全局限流（超限 429）
 */

import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import jwt from 'jsonwebtoken'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const dataDir = await mkdtemp(path.join(os.tmpdir(), 'n1ko-music-security-'))
process.env.DATA_DIR = dataDir
process.env.NODE_ENV = 'test'
process.env.JWT_SECRET = 'test-only-jwt-secret-that-is-long-and-random-enough'
process.env.BCRYPT_ROUNDS = '10'
process.env.AUTH_RATE_LIMIT_MAX = '1000'
process.env.ALLOW_REGISTRATION = 'open'
// 限流阈值压低（40/分钟）：前面的测试有富余，最后一项连打满到 429
process.env.RATE_LIMIT_WINDOW_MS = '60000'
process.env.RATE_LIMIT_MAX = '40'

const app = require('../dist/app.js').default
const db = require('../dist/db/database.js').default
let server
let baseUrl

before(async () => {
  await new Promise(resolve => {
    server = app.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`
      resolve()
    })
  })
})

after(async () => {
  await new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve())))
  db.close()
  await rm(dataDir, { recursive: true, force: true })
})

async function request(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...options.headers,
    },
  })
  let body = null
  try { body = await response.json() } catch { /* 非 JSON 响应 */ }
  return { response, body }
}

async function newUser(username) {
  const registered = await request('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username, password: 'correct-horse' }),
  })
  return { authorization: `Bearer ${registered.body.token}`, token: registered.body.token }
}

test('过期 / 篡改的令牌被拒', async () => {
  const { token } = await newUser('sec-token')

  // 篡改：翻一个字符
  const tampered = token.slice(0, -2) + (token.endsWith('aa') ? 'bb' : 'aa')
  const bad = await request('/api/auth/me', { headers: { authorization: `Bearer ${tampered}` } })
  assert.equal(bad.response.status, 401)

  // 过期：同 secret 签一个 exp 在过去的令牌（tokenVersion 对齐当前值）
  const user = db.prepare('SELECT id, username, token_version FROM users WHERE username = ?').get('sec-token')
  const expired = jwt.sign(
    { userId: user.id, username: user.username, tokenVersion: user.token_version, exp: Math.floor(Date.now() / 1000) - 3600 },
    process.env.JWT_SECRET
  )
  const stale = await request('/api/auth/me', { headers: { authorization: `Bearer ${expired}` } })
  assert.equal(stale.response.status, 401)

  // 对照：合法令牌可用
  const ok = await request('/api/auth/me', { headers: { authorization: `Bearer ${token}` } })
  assert.equal(ok.response.status, 200)
})

test('改密后旧 token 立即吊销（token_version 递增）', async () => {
  const { token } = await newUser('sec-revoke')
  const auth = { authorization: `Bearer ${token}` }

  const before = await request('/api/auth/me', { headers: auth })
  assert.equal(before.response.status, 200)

  const changed = await request('/api/auth/change-password', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ currentPassword: 'correct-horse', newPassword: 'different-horse-1' }),
  })
  assert.equal(changed.response.status, 200)
  assert.ok(changed.body.token, '应返回新令牌供当前会话续用')

  // 旧令牌：立刻 401
  const afterOld = await request('/api/auth/me', { headers: auth })
  assert.equal(afterOld.response.status, 401)

  // 新令牌：可用
  const afterNew = await request('/api/auth/me', { headers: { authorization: `Bearer ${changed.body.token}` } })
  assert.equal(afterNew.response.status, 200)
})

test('CORS：名单外 Origin 不给 ACAO 头，名单内给', async () => {
  const denied = await fetch(`${baseUrl}/health`, { headers: { Origin: 'https://evil.example' } })
  assert.equal(denied.headers.get('access-control-allow-origin'), null)

  const allowed = await fetch(`${baseUrl}/health`, {
    headers: { Origin: 'http://localhost:5173' },
  })
  // 默认名单含本地开发 Origin（config 的 FRONTEND_ORIGINS）
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'http://localhost:5173')
})

test('全局限流：超过阈值回 429', async () => {
  // 前面的测试已消耗配额；连续打满直到出现 429
  let saw429 = false
  for (let i = 0; i < 45 && !saw429; i++) {
    const res = await fetch(`${baseUrl}/health`)
    if (res.status === 429) saw429 = true
  }
  assert.ok(saw429, '连续请求应触发 429 限流')
})
