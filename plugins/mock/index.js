/**
 * Mock 音源插件——开发与测试专用（PLAN 1.5）。
 *
 * 特性都为验收而设计：
 *  - 完全离线：不 require('axios')，不出网；hosts 里的 mock.invalid 永远不会被请求
 *  - getMediaSource 返回内存生成的 3 秒 WAV data: URL，expiresAt 20 秒后，
 *    专门用来验证播放引擎的过期重取路径（阶段 0.3 顺延到这里的验收项）
 *  - 扫码是模拟状态机：第 1-2 次 waiting、第 3-4 次 scanned、第 5 次 confirmed
 *  - 曲库固定、中英混合（风格与 scripts/mock-subsonic.mjs 一致），截图可复现
 */

const PLATFORM = 'mock'

/* ============================================================
   固定曲库（与 scripts/mock-subsonic.mjs 同风格）
   ============================================================ */

const ALBUMS = [
  {
    id: 'al-1', title: '风过留痕', artist: 'ar-1', artistName: '李佳薇', date: '2023', artwork: artworkUrl('al-1'),
    tracks: [
      ['so-1-1', '风过留痕', 252], ['so-1-2', '此时此刻', 216], ['so-1-3', '自由灵魂', 242],
      ['so-1-4', '重写剧本', 224], ['so-1-5', '青春追问', 268],
    ],
  },
  {
    id: 'al-2', title: 'Home', artist: 'ar-2', artistName: 'Charlie Puth', date: '2022', artwork: artworkUrl('al-2'),
    tracks: [
      ['so-2-1', 'Home (feat. Hikaru)', 212], ['so-2-2', 'Left and Right', 178],
      ['so-2-3', 'Stay With Me', 190], ['so-2-4', 'Home (Acoustic)', 185],
    ],
  },
  {
    id: 'al-3', title: 'rosie', artist: 'ar-3', artistName: 'ROSÉ', date: '2024', artwork: artworkUrl('al-3'),
    tracks: [
      ['so-3-1', 'rosie', 176], ['so-3-2', 'number one girl', 201],
      ['so-3-3', 'toxic till the end', 179], ['so-3-4', 'two years', 184],
    ],
  },
  {
    id: 'al-4', title: '火力全开', artist: 'ar-4', artistName: '王力宏', date: '2011', artwork: artworkUrl('al-4'),
    tracks: [
      ['so-4-1', '火力全开', 213], ['so-4-2', '另一个天堂', 252],
      ['so-4-3', '心跳', 228], ['so-4-4', '大城小爱', 221],
    ],
  },
  {
    id: 'al-5', title: 'Beyond The Stage', artist: 'ar-5', artistName: 'BEYOND', date: '1991', artwork: artworkUrl('al-5'),
    tracks: [
      ['so-5-1', '海阔天空', 326], ['so-5-2', '光辉岁月', 299],
      ['so-5-3', '真的爱你', 277], ['so-5-4', '不再犹豫', 251],
    ],
  },
  {
    id: 'al-6', title: 'A Time 4 You', artist: 'ar-6', artistName: '林峯', date: '2013', artwork: artworkUrl('al-6'),
    tracks: [
      ['so-6-1', 'A Time 4 You', 241], ['so-6-2', 'Nice', 216],
      ['so-6-3', '爱在记忆中找你', 235], ['so-6-4', '如果时间来到', 248],
    ],
  },
]

const ARTISTS = [
  { id: 'ar-1', name: '李佳薇' },
  { id: 'ar-2', name: 'Charlie Puth' },
  { id: 'ar-3', name: 'ROSÉ' },
  { id: 'ar-4', name: '王力宏' },
  { id: 'ar-5', name: 'BEYOND' },
  { id: 'ar-6', name: '林峯' },
]

/** 1x1 SVG 占位封面：不同专辑不同底色，界面上的封面格不会一片相同 */
function artworkUrl(albumId) {
  const colors = { 'al-1': '%23b45309', 'al-2': '%231d4ed8', 'al-3': '%23be185d', 'al-4': '%23b91c1c', 'al-5': '%231e3a8a', 'al-6': '%236d28d9' }
  const fill = colors[albumId] || '%23337178'
  const label = albumId.replace('al-', 'No.')
  return "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 96 96'%3E%3Crect width='96' height='96' fill='" + fill + "'/%3E%3Ctext x='48' y='54' font-size='20' fill='white' text-anchor='middle' font-family='serif'%3E" + label + "%3C/text%3E%3C/svg%3E"
}

/** 全曲目的扁平视图（每曲带 mock 档位标记，两首故意是 VIP） */
function allSongs() {
  const out = []
  for (const album of ALBUMS) {
    album.tracks.forEach(function (track, index) {
      out.push({
        platform: PLATFORM, id: track[0], title: track[1], artist: album.artistName, artistId: album.artist,
        album: album.title, albumId: album.id, artwork: album.artwork,
        duration: track[2], track: index + 1, mockTier: qualityFor(track[0]),
      })
    })
  }
  return out
}

function songById(id) {
  const songs = allSongs()
  for (const song of songs) {
    if (song.id === id) return song
  }
  return null
}

function qualityFor(id) {
  if (id === 'so-5-1' || id === 'so-5-2') return 'vip'
  return 'free'
}

/* ============================================================
   3 秒 WAV 的内存生成（data: URL，测过期重取）
   ============================================================ */

const SAMPLE_RATE = 8000
const SECONDS = 3
const WAV_HEADER_BYTES = 44

function bytesToBase64(bytes) {
  // WHATWG 的 TextDecoder('latin1') 实际按 windows-1252 解码（0x80-0x9F 会变
  // 成 >0xFF 的码点），不能用于二进制串；分块 fromCharCode 才是标准做法。
  // Node 测试骨架里没有 btoa，走 Buffer。
  if (typeof btoa === 'function') {
    let out = ''
    // 块长必须是 3 的倍数：btoa 给不足 3 字节的块补 '='，块间拼接时中间出现
    // '=' 会让解码器提前截断（Chrome 直接 MEDIA_ELEMENT_ERROR: Format error）
    const CHUNK = 3 * 0x1000
    for (let i = 0; i < bytes.length; i += CHUNK) {
      out += btoa(String.fromCharCode(...bytes.subarray(i, i + CHUNK)))
    }
    return out
  }
  return Buffer.from(bytes).toString('base64')
}

/** 正弦 + 淡入淡出的 8-bit 单声道 WAV；音高由曲目 id 的长度派生（确定性） */
function makeWavDataUrl(songId) {
  const sampleCount = SAMPLE_RATE * SECONDS
  const buffer = new ArrayBuffer(WAV_HEADER_BYTES + sampleCount)
  const view = new DataView(buffer)
  // RIFF 头（标准 WAV 布局）
  view.setUint32(0, 0x46464952, true)          // 'RIFF'
  view.setUint32(4, 36 + sampleCount, true)
  view.setUint32(8, 0x45564157, true)          // 'WAVE'
  view.setUint32(12, 0x20746d66, true)         // 'fmt '
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)                  // PCM
  view.setUint16(22, 1, true)                  // 单声道
  view.setUint32(24, SAMPLE_RATE, true)
  view.setUint32(28, SAMPLE_RATE, true)        // 字节率 = 采样率 × 声道 × 位深/8
  view.setUint16(32, 1, true)
  view.setUint16(34, 8, true)                  // 8-bit
  view.setUint32(36, 0x61746164, true)         // 'data'
  view.setUint32(40, sampleCount, true)

  const seed = String(songId).split('').reduce(function (acc, ch) { return acc + ch.charCodeAt(0) }, 0)
  const freq = 320 + ((seed % 5) * 88)
  for (let i = 0; i < sampleCount; i++) {
    const envelope = Math.min(1, i / 800, (sampleCount - i) / 800)
    const wave = Math.sin((2 * Math.PI * freq * i) / SAMPLE_RATE)
    view.setUint8(WAV_HEADER_BYTES + i, 128 + Math.round(64 * envelope * wave))
  }
  return 'data:audio/wav;base64,' + bytesToBase64(new Uint8Array(buffer))
}

/* ============================================================
   扫码状态机（模拟，确定性序号）
   ============================================================ */

const qrSessions = new Map()
let qrSeq = 0
const QR_EXPIRE_MS = 10 * 60 * 1000

function createQr() {
  qrSeq += 1
  const key = 'mock-qr-' + qrSeq
  qrSessions.set(key, { createdAt: Date.now(), checks: 0 })
  return { key: key, content: 'N1KO-MOCK-QR:' + key, expiresIn: Math.floor(QR_EXPIRE_MS / 1000) }
}

// 第 1-2 次 waiting、第 3-4 次 scanned、第 5 次 confirmed（PLAN 1.5 规定）
function checkQr(key) {
  const session = qrSessions.get(key)
  if (!session) {
    throw pluginError('not-found', '二维码不存在，请刷新')
  }
  if (Date.now() - session.createdAt > QR_EXPIRE_MS) {
    return { status: 'expired' }
  }
  session.checks += 1
  if (session.checks <= 2) return { status: 'waiting' }
  if (session.checks <= 4) return { status: 'scanned' }
  qrSessions.delete(key)
  return { status: 'confirmed', credentials: 'mock-cookie:user-1000:' + Date.now() }
}

function pluginError(code, message) {
  // 沙箱运行时注入了全局 PluginError；Node 测试骨架里退回带 code 字段的 Error
  if (typeof PluginError === 'function') return new PluginError(code, message)
  const err = new Error(message)
  err.name = 'PluginError'
  err.code = code
  return err
}

/* ============================================================
   用户态（凭据 + 私有存储）
   ============================================================ */

function parseCredentials(credentials) {
  if (!credentials || credentials.indexOf('mock-cookie:') !== 0) return null
  return { userId: credentials.split(':')[1] || 'user-1000' }
}

const USER_PLAYLISTS = [
  { id: 'pl-mock-1', title: 'Mock 私藏', songIds: ['so-1-1', 'so-2-1', 'so-3-2', 'so-5-1', 'so-4-3', 'so-6-3'] },
  { id: 'pl-mock-2', title: '深夜代码歌单', songIds: ['so-5-3', 'so-1-3', 'so-2-3', 'so-3-4'] },
]
const SUBSCRIBED_PLAYLISTS = [
  { id: 'pl-mock-9', title: '别人家的精选（收藏的）', songIds: ['so-4-1', 'so-5-2', 'so-6-1'] },
]

function allPlaylists() {
  return USER_PLAYLISTS.concat(SUBSCRIBED_PLAYLISTS)
}

function playlistById(id) {
  const all = allPlaylists()
  for (const pl of all) {
    if (pl.id === id) return pl
  }
  return null
}

async function readFavorites(storage) {
  const raw = await storage.get('favorites')
  return raw ? JSON.parse(raw) : ['so-1-1', 'so-3-1']
}

async function writeFavorites(storage, list) {
  await storage.set('favorites', JSON.stringify(list))
}

const LYRIC_LINES = [
  '[00:00.00]N1KO MUSIC · Mock 音源歌词',
  '[00:02.00]这一行在第二秒',
  '[00:05.00]点歌词跳转在第五秒生效',
  '[00:09.00]三秒的 WAV 播不到这里',
  '[00:15.00]但滚动动画看得到',
]

function toSheetItem(playlist) {
  return {
    platform: PLATFORM, id: playlist.id, title: playlist.title,
    worksNum: playlist.songIds ? playlist.songIds.length : (playlist.worksNum || 0),
    createUser: 'Mock 用户', createUserId: 'user-1000',
  }
}

function toAlbumItem(album) {
  return { platform: PLATFORM, id: album.id, title: album.title, artist: album.artistName, artistId: album.artist, artwork: album.artwork, date: album.date }
}

function toSongIn(album) {
  return function (track, index) {
    return {
      platform: PLATFORM, id: track[0], title: track[1], artist: album.artistName, artistId: album.artist,
      album: album.title, albumId: album.id, artwork: album.artwork, duration: track[2], track: index + 1,
    }
  }
}

function requireLogin() {
  if (!parseCredentials(env && env.credentials)) {
    throw pluginError('unauthorized', 'Mock 音源需要扫码登录后才能访问用户数据')
  }
}

/* ============================================================
   导出（MusicFree 兼容 + n1ko 扩展）
   ============================================================ */

const mockPlugin = {
  platform: PLATFORM,
  version: '0.1.0',

  async search(query, page, type) {
    const q = String(query || '').toLowerCase()
    const pageNum = page || 1
    const kind = type || 'music'
    const size = 20
    let pool
    if (kind === 'album') {
      pool = ALBUMS.map(function (a) {
        return { platform: PLATFORM, id: a.id, title: a.title, artist: a.artistName, artistId: a.artist, artwork: a.artwork, date: a.date }
      })
    } else if (kind === 'artist') {
      pool = ARTISTS.map(function (a) {
        return { platform: PLATFORM, id: a.id, name: a.name, avatar: artworkUrl('al-1') }
      })
    } else if (kind === 'sheet') {
      pool = allPlaylists().map(toSheetItem)
    } else {
      pool = allSongs()
    }
    const matched = pool.filter(function (item) {
      const haystack = kind === 'artist' ? item.name : item.title
      return String(haystack).toLowerCase().includes(q)
    })
    const start = (pageNum - 1) * size
    return { isEnd: start + size >= matched.length, data: matched.slice(start, start + size) }
  },

  async getMediaSource(musicItem) {
    const song = songById(musicItem.id) || musicItem
    if (qualityFor(song.id) === 'vip' && !(env && env.credentials)) {
      throw pluginError('forbidden', '这首歌在 Mock 音源里是 VIP 曲——专门测标灰与原因提示')
    }
    return {
      url: makeWavDataUrl(song.id),
      // 20 秒过期：验证播放引擎的过期重取（阶段 0.3 顺延到这里的验收项）
      expiresAt: Date.now() + 20_000,
      mimeType: 'audio/wav',
    }
  },
  async getMusicInfo(musicItem) {
    const song = songById(musicItem.id)
    return song ? { title: song.title, artist: song.artist, artwork: song.artwork } : {}
  },

  async getLyric(musicItem) {
    const song = songById(musicItem.id)
    if (!song) throw pluginError('not-found', '歌曲不存在：' + musicItem.id)
    return { rawLrc: LYRIC_LINES.join('\n'), translation: '' }
  },

  async getAlbumInfo(albumItem) {
    const album = ALBUMS.find(function (a) { return a.id === albumItem.id })
    if (!album) throw pluginError('not-found', '专辑不存在：' + albumItem.id)
    const songs = album.tracks.map(toSongIn(album))
    return {
      isEnd: true,
      musicList: songs,
      item: { platform: PLATFORM, id: album.id, title: album.title, artist: album.artistName, artistId: album.artist, artwork: album.artwork, date: album.date },
    }
  },

  async getArtistWorks(artistItem, page, type) {
    const artist = ARTISTS.find(function (a) { return a.id === artistItem.id })
    if (!artist) throw pluginError('not-found', '歌手不存在：' + artistItem.id)
    if (type === 'album') {
      const albums = ALBUMS.filter(function (a) { return a.artist === artist.id }).map(toAlbumItem)
      return { isEnd: true, data: albums }
    }
    const songs = allSongs().filter(function (s) { return s.artistId === artist.id })
    const size = 20
    const start = ((page || 1) - 1) * size
    return { isEnd: start + size >= songs.length, data: songs.slice(start, start + size) }
  },

  // 链接导入：链接里含已知 id（pl-mock-* / so-*-*）即命中，否则回退
  async importMusicSheet(urlLike) {
    const text = String(urlLike || '')
    const playlist = allPlaylists().find(function (pl) { return text.includes(pl.id) })
    if (playlist) {
      return playlist.songIds.map(songById).filter(Boolean)
    }
    return allSongs().slice(0, 5)
  },

  async importMusicItem(urlLike) {
    const text = String(urlLike || '')
    const song = allSongs().find(function (s) { return text.includes(s.id) })
    if (!song) throw pluginError('not-found', '链接里找不到歌曲')
    return song
  },

  async getTopLists() {
    return [
      { title: 'Mock 飙升榜', data: [toSheetItem(USER_PLAYLISTS[0]), toSheetItem(USER_PLAYLISTS[1])] },
      { title: 'Mock 新歌速递', data: [toSheetItem(SUBSCRIBED_PLAYLISTS[0])] },
    ]
  },

  async getTopListDetail(topListItem) {
    const playlist = playlistById(topListItem.id)
    if (!playlist) throw pluginError('not-found', '榜单不存在：' + topListItem.id)
    return { isEnd: true, musicList: playlist.songIds.map(songById).filter(Boolean), item: toSheetItem(playlist) }
  },

  async getRecommendSheetTags() {
    return [{ title: '按心情', data: [] }, { title: '按语言', data: [] }]
  },

  async getRecommendSheetsByTag(tag, page) {
    const all = allPlaylists().map(toSheetItem)
    const size = 20
    const start = ((page || 1) - 1) * size
    return { isEnd: start + size >= all.length, data: all.slice(start, start + size) }
  },

  async getMusicSheetInfo(sheetItem) {
    const playlist = playlistById(sheetItem.id)
    if (!playlist) throw pluginError('not-found', '歌单不存在：' + sheetItem.id)
    return { isEnd: true, musicList: playlist.songIds.map(songById).filter(Boolean), item: toSheetItem(playlist) }
  },
}

const n1koAuth = {
  async createQr() {
    return createQr()
  },
  async checkQr(key) {
    return checkQr(key)
  },
  async loginWithCookie(text) {
    if (!text || text.indexOf('mock-cookie:') === -1) {
      throw pluginError('unauthorized', '不是有效的 Mock 凭据串')
    }
    return { credentials: text.trim() }
  },
  async getUser() {
    const parsed = parseCredentials(env && env.credentials)
    if (!parsed) return null
    return { id: parsed.userId, name: 'Mock 用户', avatar: artworkUrl('al-3'), vip: true }
  },
  async logout() {
    env.setCredentials(null)
  },
}

const n1koUser = {
  async getPlaylists() {
    requireLogin()
    return {
      created: USER_PLAYLISTS.map(toSheetItem),
      subscribed: SUBSCRIBED_PLAYLISTS.map(toSheetItem),
    }
  },
  async getFavorites(page) {
    requireLogin()
    const ids = await readFavorites(env.storage)
    const songs = ids.map(songById).filter(Boolean)
    const size = 5 // 小页容量：分页逻辑真正被测到
    const start = ((page || 1) - 1) * size
    return { isEnd: start + size >= songs.length, data: songs.slice(start, start + size) }
  },
  async setFavorite(musicItem, liked) {
    requireLogin()
    const ids = await readFavorites(env.storage)
    let next
    if (liked) {
      next = ids.indexOf(musicItem.id) === -1 ? ids.concat([musicItem.id]) : ids
    } else {
      next = ids.filter(function (id) { return id !== musicItem.id })
    }
    await writeFavorites(env.storage, next)
  },
  async createPlaylist(name) {
    requireLogin()
    return { platform: PLATFORM, id: 'pl-mock-' + Date.now().toString(36), title: String(name || '新歌单'), worksNum: 0 }
  },
  async addToPlaylist(sheetItem, musicItems) {
    requireLogin()
    const playlist = playlistById(sheetItem.id)
    if (!playlist) throw pluginError('not-found', '歌单不存在：' + sheetItem.id)
    for (const item of musicItems) {
      playlist.songIds.push(item.id)
    }
    playlist.worksNum = playlist.songIds.length
  },
  async removeFromPlaylist(sheetItem, musicItems) {
    requireLogin()
    const playlist = playlistById(sheetItem.id)
    if (!playlist) throw pluginError('not-found', '歌单不存在：' + sheetItem.id)
    const removing = {}
    for (const item of musicItems) {
      removing[item.id] = true
    }
    playlist.songIds = playlist.songIds.filter(function (id) { return !removing[id] })
    playlist.worksNum = playlist.songIds.length
  },
}

// n1ko 命名空间的取流优先于顶层（PROTOCOL §3）；行为一致，仅路径不同
const n1koGetMediaSource = async function (musicItem) {
  return mockPlugin.getMediaSource(musicItem)
}

mockPlugin.n1ko = {
  auth: n1koAuth,
  user: n1koUser,
  getMediaSource: n1koGetMediaSource,
}

module.exports = mockPlugin



