/**
 * 反代漏配 TRUST_PROXY_HOPS 的运行时警告（hops=0 的一侧）。
 * app 在模块加载时按环境变量决定是否挂探测中间件，且模块缓存按进程算，
 * 所以 hops=0 与 hops=1 各占一个测试文件（node --test 每个文件独立进程）。
 */

import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const dataDir = await mkdtemp(path.join(os.tmpdir(), 'n1ko-music-proxywarn-'))
process.env.DATA_DIR = dataDir
process.env.NODE_ENV = 'test'
process.env.JWT_SECRET = 'test-only-jwt-secret-that-is-long-and-random-enough'
process.env.TRUST_PROXY_HOPS = '0'

// 在加载 app 之前就接管 console.warn：启动时那条「提示」不算，只数「已收到 X-Forwarded-For」
const xffWarnings = []
const originalWarn = console.warn
console.warn = (...args) => {
  const text = args.join(' ')
  if (text.includes('已收到 X-Forwarded-For')) xffWarnings.push(text)
  else originalWarn(...args)
}

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
  console.warn = originalWarn
  await new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve())))
  db.close()
  await rm(dataDir, { recursive: true, force: true })
})

const ping = headers => fetch(`${baseUrl}/health`, { headers })

test('不带 X-Forwarded-For 的请求不触发警告', async () => {
  assert.equal((await ping({})).status, 200)
  assert.equal(xffWarnings.length, 0)
})

test('带 X-Forwarded-For 的第一个请求警告一次，之后不再重复，且不拒绝请求', async () => {
  const first = await ping({ 'x-forwarded-for': '203.0.113.7' })
  assert.equal(first.status, 200)
  assert.equal(xffWarnings.length, 1)
  assert.match(xffWarnings[0], /TRUST_PROXY_HOPS/)

  const second = await ping({ 'x-forwarded-for': '198.51.100.9' })
  assert.equal(second.status, 200)
  assert.equal(xffWarnings.length, 1)
})
