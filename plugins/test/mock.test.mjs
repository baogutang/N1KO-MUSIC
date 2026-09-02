/**
 * Mock 插件全方法走查（PLAN 1.5 验收）：node --test。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadPlugin } from './harness.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const MOCK_DIR = path.resolve(here, '../mock')

const { manifest, plugin: mock, env } = loadPlugin(MOCK_DIR)
const CREDENTIALS = 'mock-cookie:user-1000:1750000000000'

/** 未登录实例（凭据为空）单独加载，避免状态串扰 */
function anonPlugin() {
  return loadPlugin(MOCK_DIR).plugin
}

test('manifest 合同：id/protocol/hosts/capabilities/disclaimer', () => {
  assert.equal(manifest.id, 'mock')
  assert.equal(manifest.protocol, 1)
  assert.ok(Array.isArray(manifest.hosts) && manifest.hosts.length > 0)
  assert.ok(manifest.capabilities.includes('search'))
  assert.ok(manifest.disclaimer.length > 0)
  assert.equal(manifest.auth.kind, 'qr')
  assert.equal(manifest.auth.allowAnonymous, true)
})

test('导出形状：platform / version / n1ko 扩展', () => {
  assert.equal(mock.platform, 'mock')
  assert.equal(mock.version, manifest.version)
  assert.ok(mock.n1ko)
  assert.ok(mock.n1ko.auth)
  assert.ok(mock.n1ko.user)
  assert.equal(typeof mock.n1ko.auth.createQr, 'function')
  assert.equal(typeof mock.n1ko.user.getPlaylists, 'function')
})

test('search 四型：music / album / artist / sheet', async () => {
  const music = await mock.search('海阔', 1, 'music')
  assert.equal(music.data.length, 1)
  assert.equal(music.data[0].title, '海阔天空')
  assert.equal(music.isEnd, true)

  const album = await mock.search('home', 1, 'album')
  assert.equal(album.data.length, 1)
  assert.equal(album.data[0].title, 'Home')

  const artist = await mock.search('beyond', 1, 'artist')
  assert.equal(artist.data.length, 1)
  assert.equal(artist.data[0].name, 'BEYOND')

  const sheet = await mock.search('藏', 1, 'sheet')
  assert.equal(sheet.data.length, 2) // Mock 私藏 + 别人家的精选（收藏的）
})

test('getMediaSource：3 秒 WAV data:URL，20 秒过期（测过期重取）', async () => {
  const media = await mock.getMediaSource({ id: 'so-1-1' })
  assert.ok(media.url.startsWith('data:audio/wav;base64,'))
  // 44 头 + 8000×3 样本 → base64 后 > 32KB
  assert.ok(media.url.length > 32_000)
  assert.equal(media.mimeType, 'audio/wav')
  const remain = media.expiresAt - Date.now()
  assert.ok(remain > 18_000 && remain <= 20_000, `expiresAt 应约 20 秒后，实际 ${remain}ms`)
})

test('getMediaSource：不同曲目产出不同地址（音高派生）', async () => {
  const a = await mock.getMediaSource({ id: 'so-1-1' })
  const b = await mock.getMediaSource({ id: 'so-2-3' })
  assert.notEqual(a.url, b.url)
})

test('n1ko.getMediaSource 优先路径与顶层一致', async () => {
  const viaTop = await mock.getMediaSource({ id: 'so-3-1' })
  const viaN1ko = await mock.n1ko.getMediaSource({ id: 'so-3-1' })
  assert.equal(viaN1ko.url, viaTop.url)
})

test('getLyric：5 行 LRC', async () => {
  const lyric = await mock.getLyric({ id: 'so-1-1' })
  assert.equal(lyric.rawLrc.split('\n').length, 5)
  assert.ok(lyric.rawLrc.includes('[00:05.00]'))
})

test('getAlbumInfo / getArtistWorks', async () => {
  const album = await mock.getAlbumInfo({ id: 'al-5' })
  assert.equal(album.musicList.length, 4)
  assert.equal(album.item.title, 'Beyond The Stage')

  const works = await mock.getArtistWorks({ id: 'ar-5' }, 1, 'music')
  assert.equal(works.data.length, 4)
  const albums = await mock.getArtistWorks({ id: 'ar-5' }, 1, 'album')
  assert.equal(albums.data.length, 1)
})

test('importMusicSheet / importMusicItem：链接含 id 即命中', async () => {
  const sheet = await mock.importMusicSheet('https://mock.test/share?pl-mock-2')
  assert.equal(sheet.length, 4)
  const fallback = await mock.importMusicSheet('https://mock.test/unknown')
  assert.equal(fallback.length, 5)
  const song = await mock.importMusicItem('https://mock.test/w/so-1-3')
  assert.equal(song.id, 'so-1-3')
  await assert.rejects(() => mock.importMusicItem('https://mock.test/w/nope'), /not-found|PluginError|找不到/)
})

test('榜单：getTopLists 分组 + getTopListDetail', async () => {
  const groups = await mock.getTopLists()
  assert.equal(groups.length, 2)
  assert.equal(groups[0].title, 'Mock 飙升榜')
  assert.equal(groups[0].data.length, 2)
  const detail = await mock.getTopListDetail(groups[0].data[0])
  assert.equal(detail.musicList.length, 6)
})

test('推荐歌单：tags + byTag', async () => {
  const tags = await mock.getRecommendSheetTags()
  assert.equal(tags.length, 2)
  const sheets = await mock.getRecommendSheetsByTag('', 1)
  assert.equal(sheets.data.length, 3)
  assert.equal(sheets.isEnd, true)
})

test('getMusicSheetInfo', async () => {
  const detail = await mock.getMusicSheetInfo({ id: 'pl-mock-9' })
  assert.equal(detail.musicList.length, 3)
  assert.equal(detail.item.title, '别人家的精选（收藏的）')
  await assert.rejects(() => mock.getMusicSheetInfo({ id: 'pl-nope' }), /not-found|PluginError|不存在/)
})

test('未登录：用户方法 unauthorized，VIP 曲 forbidden，免费曲可取流，getUser 为 null', async () => {
  const anon = anonPlugin()
  await assert.rejects(() => anon.n1ko.user.getPlaylists(), errIs('unauthorized'))
  await assert.rejects(() => anon.getMediaSource({ id: 'so-5-1' }), errIs('forbidden'))
  const free = await anon.getMediaSource({ id: 'so-1-1' })
  assert.ok(free.url.startsWith('data:audio/wav'))
  assert.equal(await anon.n1ko.auth.getUser(), null)
})

test('扫码状态机：waiting×2 → scanned×2 → confirmed（第 5 次），随后 key 失效', async () => {
  const fresh = loadPlugin(MOCK_DIR)
  const qr = await fresh.plugin.n1ko.auth.createQr()
  assert.ok(qr.key.startsWith('mock-qr-'))
  assert.ok(qr.content.includes(qr.key))
  assert.ok(qr.expiresIn > 0)

  const statuses = []
  for (let i = 0; i < 5; i++) {
    const r = await fresh.plugin.n1ko.auth.checkQr(qr.key)
    statuses.push(r.status)
    if (r.status === 'confirmed') {
      assert.ok(r.credentials.startsWith('mock-cookie:'))
      fresh.env.setCredentials(r.credentials)
    }
  }
  assert.deepEqual(statuses, ['waiting', 'waiting', 'scanned', 'scanned', 'confirmed'])
  // confirmed 后 key 被消费掉：再查应报 not-found
  await assert.rejects(() => fresh.plugin.n1ko.auth.checkQr(qr.key), errIs('not-found'))
  // 凭据生效
  const user = await fresh.plugin.n1ko.auth.getUser()
  assert.equal(user.name, 'Mock 用户')
  assert.equal(user.vip, true)
})

test('loginWithCookie：有效凭据直通，无效串拒绝', async () => {
  const r = await mock.n1ko.auth.loginWithCookie('mock-cookie:user-42:1')
  assert.ok(r.credentials.startsWith('mock-cookie:'))
  await assert.rejects(() => mock.n1ko.auth.loginWithCookie('other-service-cookie'), errIs('unauthorized'))
})

test('登录后：歌单 2+1、收藏分页、收藏增删、建单、加减歌', async () => {
  env.setCredentials(CREDENTIALS)

  const playlists = await mock.n1ko.user.getPlaylists()
  assert.equal(playlists.created.length, 2)
  assert.equal(playlists.subscribed.length, 1)

  // 默认收藏 2 首，页容量 5：第 1 页 isEnd=true——先加 4 首凑出第 2 页
  for (const id of ['so-1-2', 'so-2-2', 'so-3-3', 'so-4-4']) {
    await mock.n1ko.user.setFavorite({ id }, true)
  }
  const fav1 = await mock.n1ko.user.getFavorites(1)
  assert.equal(fav1.data.length, 5)
  assert.equal(fav1.isEnd, false)
  const fav2 = await mock.n1ko.user.getFavorites(2)
  assert.equal(fav2.data.length, 1)
  assert.equal(fav2.isEnd, true)

  await mock.n1ko.user.setFavorite({ id: 'so-2-2' }, false)
  const afterUnstar = await mock.n1ko.user.getFavorites(1)
  assert.equal(afterUnstar.data.length, 5)
  assert.equal(afterUnstar.isEnd, true) // 回到 5 首

  const created = await mock.n1ko.user.createPlaylist('验收新建')
  assert.equal(created.title, '验收新建')
  assert.ok(created.id.startsWith('pl-mock-'))

  await mock.n1ko.user.addToPlaylist({ id: 'pl-mock-2' }, [{ id: 'so-6-4' }])
  const added = await mock.getMusicSheetInfo({ id: 'pl-mock-2' })
  assert.equal(added.musicList.length, 5)
  await mock.n1ko.user.removeFromPlaylist({ id: 'pl-mock-2' }, [{ id: 'so-6-4' }])
  const removed = await mock.getMusicSheetInfo({ id: 'pl-mock-2' })
  assert.equal(removed.musicList.length, 4)
})

test('env.setCredentials / logout', async () => {
  env.setCredentials(CREDENTIALS)
  assert.equal((await mock.n1ko.auth.getUser()).id, 'user-1000')
  await mock.n1ko.auth.logout()
  assert.equal(env.credentials, null)
  assert.equal(await mock.n1ko.auth.getUser(), null)
})

/** 断言错误码（沙箱里是 PluginError.code，Node 骨架里同名字段） */
function errIs(code) {
  return (err) => {
    const actual = err.code ?? err.name
    if (actual !== code && actual !== 'PluginError') {
      throw new assert.AssertionError({ message: `期望错误码 ${code}，得到 ${actual}: ${err.message}` })
    }
    return true
  }
}
