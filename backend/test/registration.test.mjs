/**
 * 注册开关与逐账号登录节流。
 *
 * 生产默认是 first-user：库里还没有用户时放行一次，之后自动关闭。
 * 自建服务一旦暴露公网，开放注册意味着任何人都能建号。
 */
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const dataDir = await mkdtemp(path.join(os.tmpdir(), 'n1ko-music-registration-'))
process.env.DATA_DIR = dataDir
process.env.NODE_ENV = 'test'
process.env.JWT_SECRET = 'test-only-jwt-secret-that-is-long-and-random-enough'
process.env.BCRYPT_ROUNDS = '10'
process.env.AUTH_RATE_LIMIT_MAX = '1000'
process.env.LOGIN_ATTEMPT_MAX = '3'
// 不设置 ALLOW_REGISTRATION，验证的正是默认行为

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
  await new Promise(resolve => server.close(resolve))
  db.close()
  await rm(dataDir, { recursive: true, force: true })
})

function post(pathname, body) {
  return fetch(`${baseUrl}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

test('默认只允许第一个用户注册，之后关闭', async () => {
  const first = await post('/api/auth/register', {
    username: 'owner',
    password: 'a-long-enough-password',
  })
  assert.equal(first.status, 201, '第一个用户应当能注册')

  const second = await post('/api/auth/register', {
    username: 'stranger',
    password: 'a-long-enough-password',
  })
  assert.equal(second.status, 403, '第二个用户应当被拒绝')
  const body = await second.json()
  assert.match(body.error, /disabled/i)
})

test('注册关闭后原有用户仍可正常登录', async () => {
  const res = await post('/api/auth/login', {
    username: 'owner',
    password: 'a-long-enough-password',
  })
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.ok(body.token)
})

test('同一账号连续失败登录会被单独节流', async () => {
  for (let i = 0; i < 3; i++) {
    const res = await post('/api/auth/login', { username: 'owner', password: 'wrong-password-here' })
    assert.equal(res.status, 401, `第 ${i + 1} 次失败应当是 401`)
  }
  // 超过 LOGIN_ATTEMPT_MAX 之后即使密码正确也先被挡住
  const blocked = await post('/api/auth/login', {
    username: 'owner',
    password: 'a-long-enough-password',
  })
  assert.equal(blocked.status, 429, '超过阈值后应当返回 429')
})
