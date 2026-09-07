/** Synthetic fixtures only. No provider network or real account is used. */
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const { loadPlugin } = await import(pathToFileURL(path.join(repo, 'plugins/test/harness.mjs')).href)
const originalFetch = globalThis.fetch
try {
  const radar = { tracks: [{ track_info: {
    mid: 'song-fixture', title: 'Actual song fixture', interval: 180,
    singer: [{ mid: 'singer-fixture', name: 'Singer fixture' }],
  } }] }
  globalThis.fetch = async () => new Response(JSON.stringify({ req_0: { code: 0, data: radar } }), { status: 200 })
  const { plugin } = loadPlugin(path.join(repo, 'plugins/qqmusic'), {
    credentials: JSON.stringify({ musickey: 'mock-only', str_musicid: 'fixture-only' }),
  })
  const result = await plugin.n1ko.user.getRecommendSongs()
  assert.equal(result.length, 1)
  assert.equal(result[0].id, 'singer-fixture')
  assert.equal(result[0].title, 'Singer fixture')
  assert.equal(result[0].artist, '')
  assert.equal(result[0].duration, 0)
  console.log('REPRODUCED radar: wrapped track containing singer[] became a 0-second song with the singer ID.')

  const filenames = []
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body)
    filenames.push(body.req_0.param.filename?.[0])
    return new Response(JSON.stringify({ req_0: { code: 0, data: { midurlinfo: [{ result: 104003, purl: '' }] } } }), { status: 200 })
  }
  await assert.rejects(plugin.getMediaSource({ id: 'fixture-track', vip: false }, 'lossless'))
  assert.equal(filenames.length, 1)
  console.log('REPRODUCED quality: requested', filenames[0], '; lower quality retry count = 0.')
} finally {
  globalThis.fetch = originalFetch
}
