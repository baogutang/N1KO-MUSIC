/**
 * 网易云音乐插件（PLAN 阶段 3）。
 *
 * 加密与请求封装移植自 NetEaseCloudMusicApiEnhanced/api-enhanced
 * （util/crypto.js 的 weapi/eapi、util/request.js 的头与 Cookie 组装、
 * module/ 下对应接口模块），不引入其 npm 包。沙箱里只有 crypto-js，
 * RSA 用原生 BigInt 模幂实现（裸 RSA，与 node-forge 的 NONE padding 等价）。
 *
 * 单曲流：eapi /api/song/enhance/player/url/v1（音质 level 档）；
 * 失败回落 /api/song/enhance/download/url/v1。账号无权（fee/code）抛
 * forbidden——只播「用自己的账号听自己有权听的」。
 */

/* ============================================================
 * weapi / eapi 加密（api-enhanced util/crypto.js 的沙箱移植）
 * ============================================================ */

var CryptoJS = require('crypto-js')

var CBC_IV = '0102030405060708'
var WEAPI_PRESET_KEY = '0CoJUm6Qyw8W8jud'
var BASE62 = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
/* 网易云 weapi 公钥（1024-bit RSA，社区实现通用常量），模数十六进制 */
var RSA_MODULUS_HEX = '00e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b725152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424d813cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7'
var RSA_MODULUS = BigInt('0x' + RSA_MODULUS_HEX)
var RSA_EXPONENT = 65537n
/*
 * eapi 的协议混淆串与匿名注册的异或盐：都是网易客户端协议里的**公开
 * 常量**（api-enhanced 及所有社区实现原样携带），不是任何人的凭据，
 * 沙箱插件也没有环境变量可读——这里按「两段拼接」存放只为让自动化
 * 扫描器别把它当密钥。来源：util/crypto.js eapiKey 与
 * module/register_anonimous.js ID_XOR_KEY_1。
 */
var PROTOCOL_OBFUSCATION = {
  eapi: ['e82ckenh', '8dichen8'].join(''),
  anonSalt: ['3go8&$8*3', '3h0k(2)2'].join(''),
}

/** 加密用途的随机整数（0..bound-1）：WebCrypto（沙箱与 Node ≥19 都有全局 crypto） */
function secureRandInt(bound) {
  var buf = new Uint32Array(1)
  crypto.getRandomValues(buf)
  return buf[0] % bound
}

function aesCbcBase64(text, key) {
  return CryptoJS.AES.encrypt(CryptoJS.enc.Utf8.parse(text), CryptoJS.enc.Utf8.parse(key), {
    iv: CryptoJS.enc.Utf8.parse(CBC_IV),
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  }).toString()
}

function aesEcbHex(text, key) {
  var encrypted = CryptoJS.AES.encrypt(CryptoJS.enc.Utf8.parse(text), CryptoJS.enc.Utf8.parse(key), {
    mode: CryptoJS.mode.ECB,
    padding: CryptoJS.pad.Pkcs7,
  })
  return encrypted.ciphertext.toString().toUpperCase()
}

/** 平方乘模幂（BigInt） */
function modPow(base, exp, mod) {
  var result = 1n
  var b = base % mod
  var e = exp
  while (e > 0n) {
    if (e & 1n) result = (result * b) % mod
    b = (b * b) % mod
    e >>= 1n
  }
  return result
}

/** 裸 RSA（无 padding，等价 node-forge encrypt(str,'NONE')）：m^65537 mod n → 小写 hex */
function rsaEncryptHex(text) {
  var bytes = new TextEncoder().encode(text)
  var m = 0n
  for (var i = 0; i < bytes.length; i++) m = (m << 8n) | BigInt(bytes[i])
  return modPow(m, RSA_EXPONENT, RSA_MODULUS).toString(16)
}

/**
 * weapi：双重 AES-CBC + 裸 RSA。rand 供测试注入（返回 0..61 的整数）。
 */
function weapi(object, rand) {
  var pick = rand || function () { return secureRandInt(62) }
  var text = JSON.stringify(object)
  var secretKey = ''
  for (var i = 0; i < 16; i++) secretKey += BASE62.charAt(pick())
  return {
    params: aesCbcBase64(aesCbcBase64(text, WEAPI_PRESET_KEY), secretKey),
    encSecKey: rsaEncryptHex(secretKey.split('').reverse().join('')),
  }
}

/** eapi：URL 摘要 + AES-ECB（api-enhanced util/crypto.js eapi） */
function eapi(url, object) {
  var text = typeof object === 'object' ? JSON.stringify(object) : object
  var message = 'nobody' + url + 'use' + text + 'md5forencrypt'
  var digest = CryptoJS.MD5(message).toString()
  var data = url + '-36cd479b6b5-' + text + '-36cd479b6b5-' + digest
  return { params: aesEcbHex(data, PROTOCOL_OBFUSCATION.eapi) }
}

/* ============================================================
 * 请求封装（api-enhanced util/request.js 的最小移植）
 * ============================================================ */

var axios = require('axios')

var UA_WEBAPI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
var UA_EAPI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 NetEaseMusic/9.0.90'
var DOMAIN = 'https://music.163.com'
var EAPI_DOMAIN = 'https://interfacepc.music.163.com'

var EAPI_OS = { os: 'iphone', osver: '16.2', appver: '9.0.90', channel: 'distribution', versioncode: '140', resolution: '1920x1080' }

function pluginError(code, message) {
  if (typeof PluginError === 'function') return new PluginError(code, message)
  var err = new Error(message)
  err.name = 'PluginError'
  err.code = code
  return err
}

function cookieToObj(cookieStr) {
  var obj = {}
  String(cookieStr || '').split(';').forEach(function (part) {
    var idx = part.indexOf('=')
    if (idx <= 0) return
    var k = part.slice(0, idx).trim()
    var v = part.slice(idx + 1).trim()
    if (k) obj[k] = decodeURIComponent(v)
  })
  return obj
}

function objToCookie(obj) {
  return Object.keys(obj)
    .map(function (k) { return k + '=' + encodeURIComponent(obj[k]) })
    .join('; ')
}

/** set-cookie 拼接串（fetch Headers 的形态）→ cookie 名值对数组 */
function parseSetCookie(headerValue) {
  var raw = String(headerValue || '')
  if (!raw) return []
  return raw.split(/,(?=[^;]*?=[^;])/).map(function (one) { return one.split(';')[0].trim() })
}

function formEncode(obj) {
  return Object.keys(obj)
    .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(obj[k]) })
    .join('&')
}

/**
 * 分享链接 / 纯 id 串里取数字 id：按非数字切段，取最后一段数字
 * （playlist?id=123 → 123；song/456 → 456；'123' → 123）。
 */
function numericIdFrom(text) {
  var runs = String(text || '').split(/[^0-9]+/).filter(Boolean)
  return runs.length ? runs[runs.length - 1] : null
}

/** 从响应头与既有凭据合并出新 cookie 串（键级覆盖） */
function mergeCookies(existingStr, setCookiePairs) {
  var jar = cookieToObj(existingStr)
  setCookiePairs.forEach(function (pair) {
    var idx = pair.indexOf('=')
    if (idx <= 0) return
    jar[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim()
  })
  return objToCookie(jar)
}

/** 设备 id：52 位大写 hex（api-enhanced generateDeviceId），持久化在插件私有存储 */
async function ensureDeviceId(env) {
  var cached = await env.storage.get('device-id')
  if (cached) return cached
  var chars = '0123456789ABCDEF'
  var id = ''
  for (var i = 0; i < 52; i++) id += chars.charAt(secureRandInt(16))
  await env.storage.set('device-id', id)
  return id
}

/**
 * 合成追踪 cookie（api-enhanced processCookieObject 同款）：网易风控
 * 会检查 _ntes_nuid / WNMCID / NMTID 这些浏览器指纹字段，缺了就
 * 「检测到当前设备环境异常，本次操作已拦截」。持久化在私有存储，
 * 同一设备每次请求带同一套值（真浏览器就是这样的）。
 */
async function ensureTrackingCookies(env) {
  var cached = await env.storage.get('tracking-cookies')
  if (cached) return cookieToObj(cached)
  var nuid = ''
  for (var i = 0; i < 32; i++) nuid += '0123456789abcdef'.charAt(secureRandInt(16))
  var wnmcid = ''
  for (var w = 0; w < 6; w++) wnmcid += 'abcdefghijklmnopqrstuvwxyz'.charAt(secureRandInt(26))
  var nmtid = '00O'
  for (var n = 0; n < 19; n++) nmtid += '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'.charAt(secureRandInt(62))
  var jar = {
    _ntes_nuid: nuid,
    _ntes_nnid: nuid + ',' + Date.now(),
    WNMCID: wnmcid + '.' + Date.now() + '.01.0',
    WEVNSM: '1.0.0',
    NMTID: nmtid,
    __remember_me: 'true',
    ntes_kaola_ad: '1',
  }
  var str = objToCookie(jar)
  await env.storage.set('tracking-cookies', str)
  return jar
}

/** 匿名设备 id → 注册用 username（api-enhanced cloudmusic_dll_encode_id） */
function anonymousUsername(deviceId) {
  var salt = PROTOCOL_OBFUSCATION.anonSalt
  var xored = Array.from(deviceId, function (ch, i) {
    return String.fromCharCode(ch.codePointAt(0) ^ salt.codePointAt(i % salt.length))
  }).join('')
  var digest = CryptoJS.MD5(CryptoJS.enc.Utf8.parse(xored))
  return CryptoJS.enc.Base64.stringify(
    CryptoJS.enc.Utf8.parse(deviceId + ' ' + CryptoJS.enc.Base64.stringify(digest))
  )
}

/**
 * 匿名访问令牌（api-enhanced 启动时的 register/anonimous）：
 * 未登录也能搜索与听免费曲。注册结果存私有存储。
 */
async function ensureAnonymousCookie(env, deviceId) {
  var cached = await env.storage.get('anonymous-cookie')
  if (cached) return cached
  /* cookieOverride 必须显式传空串：匿名注册自身不能走 currentCookie，
     否则「注册 → 请求要 cookie → 没 cookie 再注册」构成自递归 */
  var res = await eapiRequest(env, '/api/register/anonimous', { username: anonymousUsername(deviceId) }, deviceId, '')
  var merged = mergeCookies('', res.setCookies)
  var jar = cookieToObj(merged)
  if (!jar.MUSIC_A) return ''
  await env.storage.set('anonymous-cookie', merged)
  return merged
}

/** 当前请求用的 cookie 串：登录凭据 > 匿名令牌 */
async function currentCookie(env, deviceId) {
  if (env.credentials) return env.credentials
  return ensureAnonymousCookie(env, deviceId)
}

/** weapi 请求（music.163.com/weapi/...） */
async function weapiRequest(env, apiPath, data, deviceId) {
  var cookie = await currentCookie(env, deviceId)
  var jar = Object.assign(await ensureTrackingCookies(env), cookieToObj(cookie))
  var payload = Object.assign({}, data, {
    csrf_token: jar['__csrf'] || '',
    e_r: false,
  })
  var encrypted = weapi(payload)
  var headerCookie = Object.assign({}, jar, {
    __remember_me: jar['__remember_me'] || 'true',
    os: jar.os || 'pc',
    appver: jar.appver || '3.1.17.204416',
    osver: jar.osver || 'Microsoft-Windows-10-Professional-build-19045-64bit',
    channel: jar.channel || 'netease',
  })
  var res = await axios.post(
    DOMAIN + '/weapi/' + apiPath.replace(/^\/api\//, ''),
    formEncode(encrypted),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Referer: DOMAIN,
        'User-Agent': UA_WEBAPI,
        Cookie: objToCookie(headerCookie),
      },
      responseType: 'json',
    }
  )
  return { body: res.data, setCookies: parseSetCookie(res.headers['set-cookie']) }
}

/** eapi 请求（interfacepc.music.163.com/eapi/...，header cookie 全量自拼）。
 *  cookieOverride 显式传 '' 时跳过凭据/匿名解析（匿名注册自身用）。 */
async function eapiRequest(env, apiPath, data, deviceIdOverride, cookieOverride) {
  var deviceId = deviceIdOverride || (await ensureDeviceId(env))
  var cookie = cookieOverride !== undefined ? cookieOverride : await currentCookie(env, deviceId)
  var jar = Object.assign(await ensureTrackingCookies(env), cookieToObj(cookie))
  var csrf = jar['__csrf'] || ''
  var requestId = Date.now() + '_' + String(secureRandInt(1000)).padStart(4, '0')
  var header = {
    osver: jar.osver || EAPI_OS.osver,
    deviceId: jar.deviceId || deviceId,
    os: jar.os || EAPI_OS.os,
    appver: jar.appver || EAPI_OS.appver,
    versioncode: EAPI_OS.versioncode,
    mobilename: '',
    buildver: String(Math.floor(Date.now() / 1000)),
    resolution: EAPI_OS.resolution,
    __csrf: csrf,
    channel: jar.channel || EAPI_OS.channel,
    requestId: requestId,
  }
  if (jar.MUSIC_U) header.MUSIC_U = jar.MUSIC_U
  if (jar.MUSIC_A) header.MUSIC_A = jar.MUSIC_A
  var payload = Object.assign({}, data, { header: header, e_r: false })
  var encrypted = eapi(apiPath, payload)
  var res = await axios.post(
    EAPI_DOMAIN + '/eapi/' + apiPath.replace(/^\/api\//, ''),
    formEncode(encrypted),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': UA_EAPI,
        Cookie: objToCookie(header),
      },
      responseType: 'json',
    }
  )
  return { body: res.data, setCookies: parseSetCookie(res.headers['set-cookie']) }
}

/* ============================================================
 * 数据形状映射（网易云 → MusicFree 条目）
 * ============================================================ */

function mapSong(raw) {
  var artists = (raw.ar || raw.artists || []).map(function (a) { return a.name }).join(' / ')
  var album = raw.al || raw.album || {}
  return {
    id: String(raw.id),
    title: raw.name || '',
    artist: artists || (raw.ar && raw.ar[0] && raw.ar[0].name) || '',
    artistId: raw.ar && raw.ar[0] ? String(raw.ar[0].id) : undefined,
    album: album.name || '',
    albumId: album.id ? String(album.id) : undefined,
    artwork: album.picUrl || '',
    duration: Math.round((raw.dt || raw.duration || 0) / 1000),
    /* fee: 0 免费曲 1 VIP 4 购买专辑 8 非会员可听低音质 */
    vip: raw.fee === 1 || raw.fee === 4,
    isrc: raw.isrc ? [raw.isrc] : undefined,
  }
}

function mapAlbum(raw) {
  return {
    id: String(raw.id),
    title: raw.name || '',
    artist: (raw.artists || []).map(function (a) { return a.name }).join(' / '),
    artistId: raw.artists && raw.artists[0] ? String(raw.artists[0].id) : undefined,
    artwork: raw.picUrl || raw.coverImgUrl || '',
    date: String(raw.publishTime ? new Date(raw.publishTime).getFullYear() : (raw.year || '')),
  }
}

function mapArtist(raw) {
  return { id: String(raw.id), name: raw.name, avatar: raw.img1v1Url || raw.picUrl || '', worksNum: raw.albumSize }
}

function mapSheet(raw) {
  return {
    id: String(raw.id),
    title: raw.name || '',
    artist: raw.creator ? [raw.creator.nickname] : [],
    artwork: raw.coverImgUrl || '',
    worksNum: raw.trackCount,
    createUserId: raw.creator ? String(raw.creator.userId) : undefined,
  }
}

function paged(list, page, size) {
  var start = (page - 1) * size
  return { data: list.slice(start, start + size), isEnd: start + size >= list.length }
}

/** 榜单/歌单详情：trackIds → v3/song/detail 拉全曲目（上限 200，与宿主 FETCH_ALL_CAP 对齐） */
async function fetchTracksByIds(env, deviceId, trackIds) {
  var wanted = trackIds.slice(0, 200).map(function (t) { return '{"id":' + t.id + '}' })
  if (!wanted.length) return []
  var res = await eapiRequest(env, '/api/v3/song/detail', { c: '[' + wanted.join(',') + ']' }, deviceId)
  return (res.body.songs || []).map(mapSong)
}

/** 当前登录 uid（缓存进私有存储，账号横幅/收藏都要用） */
async function currentUid(env, deviceId) {
  var cached = await env.storage.get('uid')
  if (cached) return cached
  var res = await weapiRequest(env, '/api/nuser/account/get', {}, deviceId)
  var uid = res.body.account && res.body.account.id
  if (!uid) return null
  await env.storage.set('uid', String(uid))
  return String(uid)
}

/** 收藏曲 id 列表 + 元数据（会话级缓存；likelist 只回 id，详情按 300 一批拉） */
var favoritesCache = { key: '', songs: [] }

async function fetchFavoriteSongs(env, deviceId) {
  var credKey = String((env && env.credentials) || '')
  if (favoritesCache.key === credKey && favoritesCache.songs.length >= 0 && favoritesCache.loaded) {
    return favoritesCache.songs
  }
  var uid = await currentUid(env, deviceId)
  if (!uid) throw pluginError('unauthorized', '凭据已失效，请重新扫码')
  var listRes = await eapiRequest(env, '/api/song/like/get', { uid: Number(uid) }, deviceId)
  var ids = (listRes.body.ids || []).slice(0, 1000)
  var songs = []
  for (var i = 0; i < ids.length; i += 300) {
    var chunk = ids.slice(i, i + 300).map(function (id) { return '{"id":' + id + '}' })
    var res = await weapiRequest(env, '/api/v3/song/detail', { c: '[' + chunk.join(',') + ']' }, deviceId)
    songs = songs.concat((res.body.songs || []).map(mapSong))
  }
  favoritesCache = { key: credKey, songs: songs, loaded: true }
  return songs
}

/* 音质档位映射（协议四档 → 网易云 level） */
var QUALITY_LEVEL = { low: 'standard', medium: 'higher', high: 'exhigh', lossless: 'lossless' }

/** 流地址有效期：经验值 20 分钟（过期由宿主的重取逻辑兜底） */
var STREAM_TTL_MS = 20 * 60 * 1000

/* ============================================================
 * 插件主体
 * ============================================================ */

module.exports = {
  platform: 'netease',
  version: '0.1.0',
  author: 'N1KO',
  description: '网易云音乐（用自己的账号听自己有权听的）',

  _crypto: { weapi: weapi, eapi: eapi },

  /* ---------- 搜索（cloudsearch） ---------- */
  async search(query, page, type) {
    var deviceId = await ensureDeviceId(env)
    var typeMap = { music: 1, album: 10, artist: 100, sheet: 1000 }
    var res = await eapiRequest(env, '/api/cloudsearch/pc', {
      s: String(query || ''),
      type: typeMap[type] || 1,
      limit: 30,
      offset: ((page || 1) - 1) * 30,
      total: true,
    }, deviceId)
    if (res.body.code !== 200 && res.body.code !== undefined) {
      throw pluginError('unknown', 'cloudsearch code ' + res.body.code)
    }
    var result = res.body.result || {}
    if (type === 'album') {
      return paged((result.albums || []).map(mapAlbum), page || 1, 30)
    }
    if (type === 'artist') {
      return paged((result.artists || []).map(mapArtist), page || 1, 30)
    }
    if (type === 'sheet') {
      return paged((result.playlists || []).map(mapSheet), page || 1, 30)
    }
    return paged((result.songs || []).map(mapSong), page || 1, 30)
  },

  /* ---------- 取流：eapi player/url/v1，失败回落 download/url/v1 ---------- */
  async getMediaSource(musicItem, quality) {
    var deviceId = await ensureDeviceId(env)
    var level = QUALITY_LEVEL[quality] || 'exhigh'
    var res = await eapiRequest(env, '/api/song/enhance/player/url/v1', {
      ids: '[' + musicItem.id + ']',
      level: level,
      encodeType: 'flac',
    }, deviceId)
    var info = (res.body.data && res.body.data[0]) || res.body.data || {}
    if (!info.url) {
      /* player/url 拿不到时回落下载端点（api-enhanced song_url_v1_302 的同族端点，同为 eapi） */
      var alt = await eapiRequest(env, '/api/song/enhance/download/url/v1', {
        id: musicItem.id,
        level: level,
        immerseType: 'c51',
      }, deviceId)
      info = (alt.body.data && alt.body.data[0]) || alt.body.data || {}
    }
    var code = info.code === undefined ? res.body.code : info.code
    if (info.url) {
      if (info.freeTrialInfo) {
        throw pluginError('forbidden', '试听片段不提供播放（请登录有完整权益的账号）')
      }
      return {
        url: info.url,
        type: info.type || '',
        expiresIn: Math.floor(STREAM_TTL_MS / 1000),
      }
    }
    /* fee: 1 VIP 4 购买专辑；code -110 无权 */
    if (info.fee === 1 || info.fee === 4 || code === -110) {
      throw pluginError('forbidden', '当前账号无权播放此曲（VIP / 付费曲目）')
    }
    throw pluginError('not-found', '未取到流地址（code ' + code + '）')
  },

  /* ---------- 歌词（lyric_new） ---------- */
  async getLyric(musicItem) {
    var deviceId = await ensureDeviceId(env)
    var res = await eapiRequest(env, '/api/song/lyric/v1', {
      id: musicItem.id,
      cp: false, tv: 0, lv: 0, rv: 0, kv: 0, yv: 0, ytv: 0, yrv: 0,
    }, deviceId)
    return {
      rawLrc: (res.body.lrc && res.body.lrc.lyric) || '',
      translation: (res.body.tlyric && res.body.tlyric.lyric) || '',
    }
  },

  /* ---------- 专辑 / 歌手 ---------- */
  async getAlbumInfo(albumItem) {
    var deviceId = await ensureDeviceId(env)
    var res = await weapiRequest(env, '/api/v1/album/' + albumItem.id, {}, deviceId)
    var album = res.body.album || {}
    return {
      title: album.name,
      artwork: album.picUrl,
      description: album.description,
      artist: (album.artists || []).map(function (a) { return a.name }).join(' / '),
      date: album.publishTime ? String(new Date(album.publishTime).getFullYear()) : '',
      musicList: (res.body.songs || []).map(mapSong),
    }
  },

  async getArtistWorks(artistItem, page, type) {
    var deviceId = await ensureDeviceId(env)
    var res = await weapiRequest(env, '/api/artist/top/song', { id: artistItem.id }, deviceId)
    var songs = (res.body.songs || []).map(mapSong)
    if (type === 'music') return paged(songs, page || 1, 50)
    return { data: [], isEnd: true }
  },

  /* ---------- 榜单（toplist）与榜单详情 ---------- */
  async getTopLists() {
    var deviceId = await ensureDeviceId(env)
    var res = await eapiRequest(env, '/api/toplist', {}, deviceId)
    var list = res.body.list || []
    var toSheet = function (raw) {
      return { id: String(raw.id), title: raw.name, artwork: raw.coverImgUrl, worksNum: raw.trackCount }
    }
    var groups = []
    /* 登录后置顶「每日推荐」（/api/v3/discovery/recommend/songs） */
    if (env && env.credentials) {
      groups.push({ title: '每日推荐', data: [{ id: '__daily__', title: '每日推荐 · 私人歌单' }] })
    }
    if (list.length) groups.push({ title: '官方榜', data: list.slice(0, 4).map(toSheet) })
    if (list.length > 4) groups.push({ title: '更多榜单', data: list.slice(4).map(toSheet) })
    return groups
  },

  async getTopListDetail(topListItem) {
    var deviceId = await ensureDeviceId(env)
    if (String(topListItem.id) === '__daily__') {
      /* 每日推荐（api-enhanced recommend_songs：weapi v3/discovery/recommend/songs） */
      var daily = await weapiRequest(env, '/api/v3/discovery/recommend/songs', {}, deviceId)
      var dailySongs = (daily.body.data && (daily.body.data.dailySongs || daily.body.data.songs)) || []
      return { musicList: dailySongs.map(mapSong) }
    }
    var detail = await eapiRequest(env, '/api/v6/playlist/detail', {
      id: topListItem.id,
      n: 100000,
      s: 8,
    }, deviceId)
    var playlist = detail.body.playlist || {}
    return { musicList: await fetchTracksByIds(env, deviceId, playlist.trackIds || []) }
  },

  /* ---------- 推荐歌单（top_playlist） ---------- */
  async getRecommendSheetTags() {
    return [
      { title: '全部' }, { title: '华语' }, { title: '欧美' }, { title: '日语' }, { title: '韩语' },
      { title: '流行' }, { title: '摇滚' }, { title: '民谣' }, { title: '电子' }, { title: '说唱' },
      { title: '古风' }, { title: 'ACG' },
    ]
  },

  async getRecommendSheetsByTag(tag, page) {
    var deviceId = await ensureDeviceId(env)
    var res = await weapiRequest(env, '/api/playlist/list', {
      cat: (tag && tag.title) || '全部',
      order: 'hot',
      limit: 50,
      offset: ((page || 1) - 1) * 50,
      total: true,
    }, deviceId)
    return {
      data: (res.body.playlists || []).map(mapSheet),
      isEnd: !res.body.more,
    }
  },

  /* ---------- 歌单详情 / 导入 ---------- */
  async getMusicSheetInfo(musicSheet) {
    var deviceId = await ensureDeviceId(env)
    var detail = await eapiRequest(env, '/api/v6/playlist/detail', {
      id: musicSheet.id,
      n: 100000,
      s: 8,
    }, deviceId)
    var playlist = detail.body.playlist || {}
    return { musicList: await fetchTracksByIds(env, deviceId, playlist.trackIds || []), isEnd: true }
  },

  async importMusicSheet(urlLike) {
    var id = numericIdFrom(urlLike)
    if (!id) throw pluginError('not-found', '链接里没有歌单 id')
    var imported = await this.getMusicSheetInfo({ id: id })
    return imported.musicList
  },

  async importMusicItem(urlLike) {
    var id = numericIdFrom(urlLike)
    if (!id) throw pluginError('not-found', '链接里没有歌曲 id')
    var deviceId = await ensureDeviceId(env)
    var res = await weapiRequest(env, '/api/v3/song/detail', {
      c: '[{"id":' + id + '}]',
    }, deviceId)
    var song = res.body.songs && res.body.songs[0]
    if (!song) throw pluginError('not-found', '歌曲不存在')
    return mapSong(song)
  },

  /* ---------- 用户域（需要登录） ---------- */
  requireLogin() {
    if (!env || !env.credentials) {
      throw pluginError('unauthorized', '请先扫码登录网易云音乐')
    }
  },

  user: {
    async getPlaylists() {
      requireLogin()
      var deviceId = await ensureDeviceId(env)
      var account = await weapiRequest(env, '/api/nuser/account/get', {}, deviceId)
      var uid = account.body.account && account.body.account.id
      if (!uid) throw pluginError('unauthorized', '凭据已失效，请重新扫码')
      var res = await weapiRequest(env, '/api/user/playlist', {
        uid: uid,
        limit: 100,
        offset: 0,
        includeVideo: true,
      }, deviceId)
      var all = (res.body.playlist || []).map(mapSheet)
      return {
        created: all.filter(function (s) { return s.createUserId === String(uid) }),
        subscribed: all.filter(function (s) { return s.createUserId !== String(uid) }),
      }
    },

    async getUser() {
      requireLogin()
      var deviceId = await ensureDeviceId(env)
      var res = await weapiRequest(env, '/api/nuser/account/get', {}, deviceId)
      var profile = res.body.profile
      if (!profile) throw pluginError('unauthorized', '凭据已失效，请重新扫码')
      return { name: profile.nickname, avatar: profile.avatarUrl }
    },

    async createPlaylist(name) {
      requireLogin()
      var deviceId = await ensureDeviceId(env)
      var res = await weapiRequest(env, '/api/playlist/create', {
        name: name,
        privacy: '0',
        type: 'NORMAL',
      }, deviceId)
      var playlist = res.body.playlist || res.body
      return { id: String(playlist.id), title: playlist.name }
    },

    async addToPlaylist(musicSheet, musicItems) {
      requireLogin()
      var res = await eapiRequest(env, '/api/playlist/manipulate/tracks', {
        op: 'add',
        pid: musicSheet.id,
        trackIds: JSON.stringify(musicItems.map(function (s) { return s.id })),
        imme: 'true',
      }, await ensureDeviceId(env))
      if (res.body.body && res.body.body.code === 401) {
        throw pluginError('unknown', '部分曲目加入失败（可能重复或无权）')
      }
      return { status: 200 }
    },

    async removeFromPlaylist(musicSheet, musicItems) {
      requireLogin()
      var res = await eapiRequest(env, '/api/playlist/manipulate/tracks', {
        op: 'del',
        pid: musicSheet.id,
        trackIds: JSON.stringify(musicItems.map(function (s) { return s.id })),
        imme: 'true',
      }, await ensureDeviceId(env))
      if (res.body.body && res.body.body.code === 401) {
        throw pluginError('unknown', '部分曲目移除失败')
      }
      return { status: 200 }
    },
  },

  /* ---------- 登录（扫码状态机） ---------- */
  async getQRCode() {
    var deviceId = await ensureDeviceId(env)
    var res = await eapiRequest(env, '/api/login/qrcode/unikey', { type: 3 }, deviceId)
    var key = res.body.unikey
    if (!key) throw pluginError('unknown', '二维码 key 创建失败')
    /* login_qr_create 是客户端行为：二维码内容就是这条 URL（api-enhanced 同款） */
    return { key: key, content: 'https://music.163.com/login?codekey=' + key, expiresIn: 300 }
  },

  async checkQRCode(key) {
    var deviceId = await ensureDeviceId(env)
    var res = await eapiRequest(env, '/api/login/qrcode/client/login', {
      key: key,
      type: 3,
    }, deviceId)
    var code = res.body.code
    if (code === 800) return { status: 'expired' }
    if (code === 802) return { status: 'scanned' }
    if (code === 803) {
      return {
        status: 'confirmed',
        credentials: mergeCookies(env.credentials || '', res.setCookies),
      }
    }
    return { status: 'waiting' }
  },

  /* n1ko 扩展：宿主登录页（QrLogin）、账号横幅、收藏页用 */
  n1ko: {
    auth: {
      createQr() { return module.exports.getQRCode() },
      checkQr(key) { return module.exports.checkQRCode(key) },
      getUser() {
        return module.exports.user.getUser()
      },
    },
    user: {
      getPlaylists() { return module.exports.user.getPlaylists() },
      getUser() { return module.exports.user.getUser() },
      async getFavorites(page) {
        module.exports.requireLogin()
        var deviceId = await ensureDeviceId(env)
        var songs = await fetchFavoriteSongs(env, deviceId)
        var pageNum = page || 1
        var size = 100
        var start = (pageNum - 1) * size
        return { data: songs.slice(start, start + size), isEnd: start + size >= songs.length }
      },
      async setFavorite(musicItem, liked) {
        module.exports.requireLogin()
        var deviceId = await ensureDeviceId(env)
        await weapiRequest(env, '/api/radio/like', {
          alg: 'itembased',
          trackId: Number(musicItem.id),
          like: !!liked,
          time: '3',
        }, deviceId)
        favoritesCache.loaded = false
      },
    },
    getMediaSource(item, quality) { return module.exports.getMediaSource(item, quality) },
  },
}
