import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const dataDir = await mkdtemp(path.join(os.tmpdir(), 'n1ko-music-api-'))
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
      const address = server.address()
      baseUrl = `http://127.0.0.1:${address.port}`
      resolve()
    })
  })
})

after(async () => {
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
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

test('health is backed by SQLite and reports the package version', async () => {
  const { response, body } = await request('/health', {
    headers: { origin: 'http://tauri.localhost' },
  })
  assert.equal(response.status, 200)
  assert.equal(body.status, 'ok')
  // 从 package.json 读，而不是写死——否则每次升版本这条都会假红
  assert.equal(body.version, require('../package.json').version)
  assert.equal(response.headers.get('access-control-allow-origin'), 'http://tauri.localhost')
})

test('auth, playlists and history enforce their data contracts', async () => {
  const weak = await request('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username: 'niko', password: 'short' }),
  })
  assert.equal(weak.response.status, 400)

  const registered = await request('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username: ' niko ', password: 'correct-horse' }),
  })
  assert.equal(registered.response.status, 201)
  const authHeaders = { authorization: `Bearer ${registered.body.token}` }

  const created = await request('/api/playlists', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ name: 'Test', description: 'clear me' }),
  })
  assert.equal(created.response.status, 201)
  const playlistId = created.body.id

  const cleared = await request(`/api/playlists/${playlistId}`, {
    method: 'PUT',
    headers: authHeaders,
    body: JSON.stringify({ description: null, coverUrl: null }),
  })
  assert.equal(cleared.response.status, 200)
  assert.equal(cleared.body.description, null)
  assert.equal(cleared.body.cover_url, null)

  for (const serverId of ['server-a', 'server-b']) {
    const added = await request(`/api/playlists/${playlistId}/songs`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ serverId, songs: [{ id: 'same-id', title: serverId }] }),
    })
    assert.equal(added.response.status, 200)
    assert.equal(added.body.inserted, 1)
  }

  const ambiguousDelete = await request(`/api/playlists/${playlistId}/songs/same-id`, {
    method: 'DELETE',
    headers: authHeaders,
  })
  assert.equal(ambiguousDelete.response.status, 409)

  const scopedDelete = await request(
    `/api/playlists/${playlistId}/songs/same-id?serverId=server-a`,
    { method: 'DELETE', headers: authHeaders },
  )
  assert.equal(scopedDelete.response.status, 200)

  const event = {
    eventId: 'event-00000001',
    songId: 'song-1',
    serverId: 'server-a',
    songData: { id: 'song-1', title: 'Song', artist: 'Artist' },
    duration: 120,
  }
  const firstScrobble = await request('/api/stats/scrobble', {
    method: 'POST', headers: authHeaders, body: JSON.stringify(event),
  })
  const duplicateScrobble = await request('/api/stats/scrobble', {
    method: 'POST', headers: authHeaders, body: JSON.stringify(event),
  })
  assert.equal(firstScrobble.response.status, 201)
  assert.equal(duplicateScrobble.response.status, 200)
  assert.equal(duplicateScrobble.body.duplicate, true)

  const invalidDuration = await request('/api/stats/scrobble', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ ...event, eventId: 'event-00000002', duration: -1 }),
  })
  assert.equal(invalidDuration.response.status, 400)

  const unbounded = await request('/api/stats/history?limit=-1', { headers: authHeaders })
  assert.equal(unbounded.response.status, 400)

  const futurePlay = await request('/api/stats/scrobble', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      ...event,
      eventId: 'event-00000003',
      playedAt: Math.floor(Date.now() / 1000) + 600,
    }),
  })
  assert.equal(futurePlay.response.status, 400)

  const summary = await request('/api/stats/summary?serverId=server-a&tzOffsetMinutes=480', {
    headers: authHeaders,
  })
  assert.equal(summary.response.status, 200)
  assert.equal(summary.response.headers.get('cache-control'), 'no-store')
  assert.equal(summary.body.totalPlays, 1)
  assert.equal(summary.body.totalDuration, 120)
  assert.equal(summary.body.topArtists[0].name, 'Artist')
})

test('repeated scrobbles of one session correct the duration instead of being dropped', async () => {
  const registered = await request('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username: 'scrobbler', password: 'correct-horse' }),
  })
  const authHeaders = { authorization: `Bearer ${registered.body.token}` }
  const event = {
    eventId: 'session-00000001',
    songId: 'song-9',
    serverId: 'server-z',
    songData: { id: 'song-9', title: 'Long Song', artist: 'Artist Z' },
  }

  // 客户端在播放过程中周期性上报同一次收听，时长逐步增长
  const first = await request('/api/stats/scrobble', {
    method: 'POST', headers: authHeaders, body: JSON.stringify({ ...event, duration: 30 }),
  })
  assert.equal(first.response.status, 201)

  const refreshed = await request('/api/stats/scrobble', {
    method: 'POST', headers: authHeaders, body: JSON.stringify({ ...event, duration: 240 }),
  })
  assert.equal(refreshed.response.status, 200)
  assert.equal(refreshed.body.duplicate, true)

  const summary = await request('/api/stats/summary?serverId=server-z&tzOffsetMinutes=0', {
    headers: authHeaders,
  })
  // 仍然只有一条记录，但时长已被修正
  assert.equal(summary.body.totalPlays, 1)
  assert.equal(summary.body.totalDuration, 240)

  // 乱序到达的旧上报不能把已记录的时长改小
  const stale = await request('/api/stats/scrobble', {
    method: 'POST', headers: authHeaders, body: JSON.stringify({ ...event, duration: 10 }),
  })
  assert.equal(stale.response.status, 200)

  const afterStale = await request('/api/stats/summary?serverId=server-z&tzOffsetMinutes=0', {
    headers: authHeaders,
  })
  assert.equal(afterStale.body.totalPlays, 1)
  assert.equal(afterStale.body.totalDuration, 240)
})
