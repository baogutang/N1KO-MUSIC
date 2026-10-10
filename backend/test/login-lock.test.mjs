/**
 * 阶段 6.9 回归：登录锁按「账号 + IP」记账。
 *
 * 场景：攻击者（IP A）对一个账号名连续输错达到锁定阈值；
 * 用户本人（IP B = localhost 的另一个协议族地址）用**正确的**口令登录，
 * 不应被那把锁挡住——此前锁只按账号记，任何人都能把别人锁在门外。
 */

import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const dataDir = await mkdtemp(path.join(os.tmpdir(), 'n1ko-music-lock-'))
process.env.DATA_DIR = dataDir
process.env.NODE_ENV = 'test'
process.env.JWT_SECRET = 'test-only-jwt-secret-that-is-long-and-random-enough'
process.env.BCRYPT_ROUNDS = '10'
process.env.AUTH_RATE_LIMIT_MAX = '1000'
process.env.ALLOW_REGISTRATION = 'open'
process.env.RATE_LIMIT_WINDOW_MS = '60000'
process.env.RATE_LIMIT_MAX = '5000'

const app = require('../dist/app.js').default
let server

before(async () => {
  await new Promise(resolve => {
    // 不绑定固定地址：多数平台默认双栈（127.0.0.1 与 ::1 都能到达）
    server = app.listen(0, () => resolve())
  })
})

after(async () => {
  await new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve())))
  await rm(dataDir, { recursive: true, force: true })
})

test('别人烧掉账号锁，本人换个地址仍能登录', async () => {
  const port = server.address().port
  // 双栈监听下 ::1 与 127.0.0.1 是两个真实的来源地址
  const probe = await fetch('http://[::1]:1/').catch(err => err.cause?.code ?? err.name)
  if (probe !== 'ECONNREFUSED') return // 没有 IPv6 回环的环境跳过：无法构造第二个 IP

  const register = await fetch(`http://127.0.0.1:${port}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'lock-victim', password: 'correct-horse' }),
  })
  assert.equal(register.status, 201)

  // 攻击者从 127.0.0.1 连续输错，达到账号锁定
  for (let i = 0; i < 20; i++) {
    await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'lock-victim', password: `wrong-${i}` }),
    })
  }
  const attackAgain = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'lock-victim', password: 'correct-horse' }),
  })
  assert.equal(attackAgain.status, 429, '同 IP 的连续失败应被锁')

  // 本人从 ::1 用正确口令登录：不受那把锁影响
  const victim = await fetch(`http://[::1]:${port}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'lock-victim', password: 'correct-horse' }),
  })
  assert.equal(victim.status, 200, '账号锁按 IP 记账，不该锁住别的地址上的正确登录')
})
