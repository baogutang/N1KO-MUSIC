import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const dataDir = await mkdtemp(path.join(os.tmpdir(), 'n1ko-music-favorites-'))
process.env.DATA_DIR = dataDir
process.env.NODE_ENV = 'test'
process.env.JWT_SECRET = 'test-only-jwt-secret-that-is-long-and-random-enough'
process.env.BCRYPT_ROUNDS = '10'
process.env.AUTH_RATE_LIMIT_MAX = '1000'
// 多用户隔离用例需要注册多个账号；生产默认是 first-user
process.env.ALLOW_REGISTRATION = 'open'

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
  const body = await response.json()
  return { response, body }
}

test('favorites require authentication', async () => {
  const { response } = await request('/api/favorites')
  assert.equal(response.status, 401)
})

test('favorites round-trip, dedupe by server and scope by user', async () => {
  const owner = await request('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username: 'fav-owner', password: 'correct-horse' }),
  })
  assert.equal(owner.response.status, 201)
  const authHeaders = { authorization: `Bearer ${owner.body.token}` }

  // 同一个 songId 出现在两个服务器上必须各自独立保存
  for (const serverId of ['server-a', 'server-b']) {
    const added = await request('/api/favorites', {
      method: 'PUT',
      headers: authHeaders,
      body: JSON.stringify({
        songId: 'same-id',
        serverId,
        songData: { id: 'same-id', title: `song on ${serverId}`, artist: 'A' },
      }),
    })
    assert.equal(added.response.status, 201)
  }

  const all = await request('/api/favorites', { headers: authHeaders })
  assert.equal(all.response.status, 200)
  assert.equal(all.body.total, 2)

  const scoped = await request('/api/favorites?serverId=server-a', { headers: authHeaders })
  assert.equal(scoped.body.total, 1)
  assert.equal(scoped.body.items[0].serverId, 'server-a')
  assert.equal(scoped.body.items[0].title, 'song on server-a')

  // 重复收藏刷新元数据但不新增记录
  const again = await request('/api/favorites', {
    method: 'PUT',
    headers: authHeaders,
    body: JSON.stringify({
      songId: 'same-id',
      serverId: 'server-a',
      songData: { id: 'same-id', title: 'renamed', artist: 'A' },
    }),
  })
  assert.equal(again.response.status, 200)

  const refreshed = await request('/api/favorites?serverId=server-a', { headers: authHeaders })
  assert.equal(refreshed.body.total, 1)
  assert.equal(refreshed.body.items[0].title, 'renamed')

  // 另一个用户看不到别人的收藏
  const other = await request('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username: 'fav-other', password: 'correct-horse' }),
  })
  const otherView = await request('/api/favorites', {
    headers: { authorization: `Bearer ${other.body.token}` },
  })
  assert.equal(otherView.body.total, 0)

  const removed = await request('/api/favorites?songId=same-id&serverId=server-a', {
    method: 'DELETE',
    headers: authHeaders,
  })
  assert.equal(removed.response.status, 200)

  const missing = await request('/api/favorites?songId=same-id&serverId=server-a', {
    method: 'DELETE',
    headers: authHeaders,
  })
  assert.equal(missing.response.status, 404)

  const remaining = await request('/api/favorites', { headers: authHeaders })
  assert.equal(remaining.body.total, 1)
  assert.equal(remaining.body.items[0].serverId, 'server-b')
})

test('favorites reject malformed input', async () => {
  const registered = await request('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username: 'fav-validate', password: 'correct-horse' }),
  })
  const authHeaders = { authorization: `Bearer ${registered.body.token}` }

  const missingServer = await request('/api/favorites', {
    method: 'PUT',
    headers: authHeaders,
    body: JSON.stringify({ songId: 'x', songData: { id: 'x' } }),
  })
  assert.equal(missingServer.response.status, 400)

  const unknownField = await request('/api/favorites', {
    method: 'PUT',
    headers: authHeaders,
    body: JSON.stringify({ songId: 'x', serverId: 's', songData: { id: 'x' }, nope: 1 }),
  })
  assert.equal(unknownField.response.status, 400)

  const future = await request('/api/favorites', {
    method: 'PUT',
    headers: authHeaders,
    body: JSON.stringify({
      songId: 'x',
      serverId: 's',
      songData: { id: 'x' },
      favoritedAt: Math.floor(Date.now() / 1000) + 86_400,
    }),
  })
  assert.equal(future.response.status, 400)

  const deleteWithoutServer = await request('/api/favorites?songId=x', {
    method: 'DELETE',
    headers: authHeaders,
  })
  assert.equal(deleteWithoutServer.response.status, 400)

  const badLimit = await request('/api/favorites?limit=9999', { headers: authHeaders })
  assert.equal(badLimit.response.status, 400)
})
