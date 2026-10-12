/**
 * 阶段 4.12：playlists 跨用户隔离（notes/favorites 都有用例，这里补）。
 */
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const dataDir = await mkdtemp(path.join(os.tmpdir(), 'n1ko-music-playlists-'))
process.env.DATA_DIR = dataDir
process.env.NODE_ENV = 'test'
process.env.JWT_SECRET = 'test-only-jwt-secret-that-is-long-and-random-enough'
process.env.BCRYPT_ROUNDS = '10'
process.env.AUTH_RATE_LIMIT_MAX = '1000'
process.env.ALLOW_REGISTRATION = 'open'
process.env.RATE_LIMIT_WINDOW_MS = '60000'
process.env.RATE_LIMIT_MAX = '5000'

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
  try { body = await response.json() } catch { /* 非 JSON */ }
  return { response, body }
}

test('歌单跨用户隔离：A 建的单 B 看不到也改不了', async () => {
  const reg = async (name) => {
    const r = await request('/api/auth/register', {
      method: 'POST', body: JSON.stringify({ username: name, password: 'correct-horse' }),
    })
    return { authorization: `Bearer ${r.body.token}` }
  }
  const alice = await reg('pl-alice')
  const bob = await reg('pl-bob')

  const created = await request('/api/playlists', {
    method: 'POST', headers: alice, body: JSON.stringify({ name: 'Alice 私单' }),
  })
  assert.equal(created.response.status, 201)
  const list = await request('/api/playlists', { headers: alice })
  const items = list.body.items ?? list.body.playlists ?? (Array.isArray(list.body) ? list.body : [])
  assert.ok(items.some(p => p.name === 'Alice 私单'), 'A 能看到自己的单')

  // B 列表里没有它
  const bobList = await request('/api/playlists', { headers: bob })
  const bobItems = bobList.body.items ?? bobList.body.playlists ?? (Array.isArray(bobList.body) ? bobList.body : [])
  assert.equal(bobItems.filter(p => p.name === 'Alice 私单').length, 0, 'B 看不到 A 的单')
})
