import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const dataDir = await mkdtemp(path.join(os.tmpdir(), 'n1ko-music-notes-'))
process.env.DATA_DIR = dataDir
process.env.NODE_ENV = 'test'
process.env.JWT_SECRET = 'test-only-jwt-secret-that-is-long-and-random-enough'
process.env.BCRYPT_ROUNDS = '10'
process.env.AUTH_RATE_LIMIT_MAX = '1000'
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

async function newUser(username) {
  const registered = await request('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username, password: 'correct-horse' }),
  })
  return { authorization: `Bearer ${registered.body.token}` }
}

test('边注需要登录', async () => {
  const { response } = await request('/api/notes')
  assert.equal(response.status, 401)
})

test('边注可以写、可以改、可以按目标读回来', async () => {
  const auth = await newUser('note-owner')
  const put = (body, targetId = 's1') => request('/api/notes', {
    method: 'PUT',
    headers: auth,
    body: JSON.stringify({ targetType: 'song', targetId, serverId: 'server-a', body }),
  })

  const created = await put('2019 年夏天，回北京的火车上。')
  assert.equal(created.response.status, 201)

  const listed = await request('/api/notes', { headers: auth })
  assert.equal(listed.body.total, 1)
  assert.equal(listed.body.items[0].body, '2019 年夏天，回北京的火车上。')
  assert.equal(listed.body.items[0].targetType, 'song')
  const createdAt = listed.body.items[0].createdAt

  // 改写同一条：算更新而不是新增，写作时间保留
  const updated = await put('改了一下措辞。')
  assert.equal(updated.response.status, 200)
  const afterUpdate = await request('/api/notes', { headers: auth })
  assert.equal(afterUpdate.body.total, 1)
  assert.equal(afterUpdate.body.items[0].body, '改了一下措辞。')
  assert.equal(afterUpdate.body.items[0].createdAt, createdAt)

  // 同一 id 在不同 target_type 下互不干扰
  await request('/api/notes', {
    method: 'PUT',
    headers: auth,
    body: JSON.stringify({ targetType: 'album', targetId: 's1', serverId: 'server-a', body: '整张都好。' }),
  })
  const both = await request('/api/notes', { headers: auth })
  assert.equal(both.body.total, 2)
})

test('删除留下墓碑，增量同步能把删除带到其它设备', async () => {
  const auth = await newUser('note-sync')
  await request('/api/notes', {
    method: 'PUT',
    headers: auth,
    body: JSON.stringify({ targetType: 'artist', targetId: 'a1', serverId: 'server-a', body: '第一次是在livehouse。' }),
  })

  const before = await request('/api/notes', { headers: auth })
  const cursor = before.body.cursor - 1

  const removed = await request(
    '/api/notes?targetType=artist&targetId=a1&serverId=server-a',
    { method: 'DELETE', headers: auth },
  )
  assert.equal(removed.response.status, 200)

  // 全量列表里没了
  const active = await request('/api/notes', { headers: auth })
  assert.equal(active.body.total, 0)

  // 增量里作为墓碑出现，且不再带正文
  const delta = await request(`/api/notes?since=${cursor}`, { headers: auth })
  const tombstone = delta.body.items.find(item => item.targetId === 'a1')
  assert.ok(tombstone)
  assert.equal(tombstone.deleted, true)
  assert.equal(tombstone.body, undefined)

  // 重复删除是 404
  const again = await request(
    '/api/notes?targetType=artist&targetId=a1&serverId=server-a',
    { method: 'DELETE', headers: auth },
  )
  assert.equal(again.response.status, 404)

  // 重新写等于复活，回到 201
  const revived = await request('/api/notes', {
    method: 'PUT',
    headers: auth,
    body: JSON.stringify({ targetType: 'artist', targetId: 'a1', serverId: 'server-a', body: '又去了一次。' }),
  })
  assert.equal(revived.response.status, 201)
})

test('别人的边注读不到', async () => {
  const mine = await newUser('note-mine')
  await request('/api/notes', {
    method: 'PUT',
    headers: mine,
    body: JSON.stringify({ targetType: 'song', targetId: 'x', serverId: 'server-a', body: '私人的。' }),
  })
  const theirs = await newUser('note-theirs')
  const view = await request('/api/notes', { headers: theirs })
  assert.equal(view.body.total, 0)
})

test('边注拒绝非法输入', async () => {
  const auth = await newUser('note-validate')
  const bad = (payload) => request('/api/notes', {
    method: 'PUT', headers: auth, body: JSON.stringify(payload),
  })

  // 目标类型不在白名单里
  assert.equal((await bad({
    targetType: 'playlist', targetId: 'x', serverId: 's', body: 'hi',
  })).response.status, 400)

  // 空正文：删除请走 DELETE，不要用空串表达
  assert.equal((await bad({
    targetType: 'song', targetId: 'x', serverId: 's', body: '   ',
  })).response.status, 400)

  // 超长正文
  assert.equal((await bad({
    targetType: 'song', targetId: 'x', serverId: 's', body: 'a'.repeat(2001),
  })).response.status, 400)

  // 多余字段
  assert.equal((await bad({
    targetType: 'song', targetId: 'x', serverId: 's', body: 'hi', nope: 1,
  })).response.status, 400)

  // 删除缺参数
  assert.equal((await request('/api/notes?targetId=x', {
    method: 'DELETE', headers: auth,
  })).response.status, 400)

  // since 不是时间戳
  assert.equal((await request('/api/notes?since=abc', { headers: auth })).response.status, 400)
})
