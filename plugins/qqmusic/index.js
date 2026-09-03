/**
 * QQ 音乐插件（PLAN 阶段 4）。
 *
 * 从 luren-dc/QQMusicApi（Python）移植：musicu.fcg 的 CGI 请求封装
 * （web 平台 comm + g_tk）、zzc 签名算法（algorithms/sign.py）、
 * QQ 扫码登录链路（ptqrshow → ptqrlogin → check_sig → authorize →
 * QQConnectLogin.LoginServer.QQLogin）、vkey 取流（GetVkey + GetCdnDispatch）、
 * do_search_v2 搜索、歌单 / 榜单 / 专辑 / 歌手 / 歌词模块。
 * 不引入其包；凭据为 JSON {musicid, str_musicid, musickey, refresh_key,
 * loginType}。只播账号有权内容（vkey result 104003 → forbidden）。
 */

var CryptoJS = require('crypto-js')
var axios = require('axios')

/* ============================================================
 * 算法（QQMusicApi 移植）
 * ============================================================ */

/** Hash33（utils/common.py）：逐字符 h = h*33 + c，模 2^31。
 *  每步取模与最后取模等价（乘加对模同余），避免 JS 数值越过 2^53。 */
function hash33(text, seed) {
  var h = seed || 0
  for (var i = 0; i < text.length; i++) h = (h * 33 + text.charCodeAt(i)) % 2147483648
  return h
}

/*
 * zzc 签名（algorithms/sign.py）。摘要用的是腾讯客户端协议**规定的**
 * SHA-1（QQMusicApi 与全部社区实现一致），它是服务端防重放的协议常量
 * 流程，不是本应用任何机密性 / 完整性的安全控制——不保护任何秘密。
 */
var SIGN_P1 = [23, 14, 6, 36, 16, 7, 19]
var SIGN_P2 = [16, 1, 32, 12, 19, 27, 8, 5]
var SIGN_SCRAMBLE = [89, 39, 179, 150, 218, 82, 58, 252, 177, 52, 186, 123, 120, 64, 242, 133, 143, 161, 121, 179]
var protocolDigest = CryptoJS.SHA1

function zzcSign(payload) {
  var hashHex = protocolDigest(payload).toString().toUpperCase()
  var part1 = ''
  for (var i = 0; i < SIGN_P1.length; i++) part1 += hashHex[SIGN_P1[i]]
  var part2 = ''
  for (var j = 0; j < SIGN_P2.length; j++) part2 += hashHex[SIGN_P2[j]]
  var bytes = new Uint8Array(20)
  for (var k = 0; k < SIGN_SCRAMBLE.length; k++) {
    bytes[k] = SIGN_SCRAMBLE[k] ^ Number.parseInt(hashHex.slice(k * 2, k * 2 + 2), 16)
  }
  var b64 = CryptoJS.lib.WordArray.create(bytes).toString(CryptoJS.enc.Base64)
  b64 = b64.replace(/[\\/+=]/g, '')
  return ('zzc' + part1 + b64 + part2).toLowerCase()
}

/** WebCrypto 随机整数（沙箱与 Node ≥19 都有全局 crypto） */
function secureRandInt(bound) {
  var buf = new Uint32Array(1)
  crypto.getRandomValues(buf)
  return buf[0] % bound
}

/** 32 位 hex guid（utils/common.py get_guid），持久化在私有存储 */
async function ensureGuid(env) {
  var cached = await env.storage.get('guid')
  if (cached) return cached
  var chars = '0123456789abcdef'
  var id = ''
  for (var i = 0; i < 32; i++) id += chars.charAt(secureRandInt(16))
  await env.storage.set('guid', id)
  return id
}

function pluginError(code, message) {
  if (typeof PluginError === 'function') return new PluginError(code, message)
  var err = new Error(message)
  err.name = 'PluginError'
  err.code = code
  return err
}

/* ============================================================
 * 凭据（JSON 串）
 * ============================================================ */

function parseCredentials(raw) {
  if (!raw) return null
  try {
    var parsed = JSON.parse(raw)
    if (parsed && parsed.musickey) return parsed
  } catch (e) { /* 凭据格式不对按未登录处理 */ }
  return null
}

function requireLogin() {
  var cred = parseCredentials(env && env.credentials)
  if (!cred) throw pluginError('unauthorized', '请先扫码登录 QQ 音乐')
  return cred
}

/** 雷达推荐（modules/recommend.py GetRadarSong）：响应字段是 tracks，需登录 */
async function fetchRadarSongs() {
  requireLogin()
  var radar = await cgi('music.recommend.TrackRelationServer', 'GetRadarSong', {
    Page: 1,
    ReqType: 0,
    FavSongs: [],
    EntranceSongs: [],
  })
  return ((radar && radar.tracks) || []).map(mapSong)
}

/* ============================================================
 * CGI 请求封装（core/api_context.py build_api_kwargs 的 web 平台移植）
 * ============================================================ */

var MUSICU_URL = 'https://u.y.qq.com/cgi-bin/musicu.fcg'
var REFERER = 'https://y.qq.com/'
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

/** web 平台 comm（versioning.py DEFAULT_VERSION_POLICY.web） */
function buildComm(cred) {
  var gTk = cred && cred.musickey ? hash33(cred.musickey, 5381) : 5381
  return {
    ct: 24,
    cv: 4747474,
    format: 'json',
    inCharset: 'utf-8',
    outCharset: 'utf-8',
    notice: 0,
    platform: 'yqq.json',
    needNewCode: 0,
    uin: (cred && cred.str_musicid) || (cred && String(cred.musicid)) || '0',
    g_tk: gTk,
    g_tk_new_20200303: gTk,
  }
}

/** 单条 CGI 调用（musicu.fcg，req_0 形态） */
async function cgi(module, method, param, commExtra) {
  var cred = parseCredentials(env && env.credentials)
  var comm = buildComm(cred)
  if (commExtra) {
    Object.keys(commExtra).forEach(function (k) { comm[k] = commExtra[k] })
  }
  var res = await axios.post(MUSICU_URL, { comm: comm, req_0: { module: module, method: method, param: param } }, {
    headers: { 'Content-Type': 'application/json', Referer: REFERER, 'User-Agent': UA, Origin: REFERER.slice(0, -1) },
    responseType: 'json',
  })
  var body = res.data || {}
  var req0 = body.req_0 || {}
  if (req0.code !== 0) {
    throw pluginError('unknown', 'CGI ' + module + '.' + method + ' code ' + req0.code)
  }
  return req0.data
}

/* ============================================================
 * QQ 扫码登录链路（modules/login.py 移植；跨源 manual redirect 经宿主通道）
 * ============================================================ */

/** set-cookie 拼接串 → cookie 名值对数组 */
function parseSetCookie(headerValue) {
  var raw = String(headerValue || '')
  if (!raw) return []
  return raw.split(/,(?=[^;]*?=[^;])/).map(function (one) { return one.split(';')[0].trim() })
}

function cookieObjFrom(setCookiePairs) {
  var jar = {}
  setCookiePairs.forEach(function (pair) {
    var idx = pair.indexOf('=')
    if (idx <= 0) return
    jar[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim()
  })
  return jar
}

function cookieHeader(obj) {
  return Object.keys(obj).map(function (k) { return k + '=' + obj[k] }).join('; ')
}

/** URL 查询串拼装 */
function withParams(base, params) {
  var qs = Object.keys(params)
    .map(function (k) { return k + '=' + encodeURIComponent(params[k]) })
    .join('&')
  return base + '?' + qs
}

/** 表单请求体编码（k=v&k=v） */
function formEncode(obj) {
  return Object.keys(obj)
    .map(function (k) { return k + '=' + encodeURIComponent(obj[k]) })
    .join('&')
}

/** 「…&key=value&…」里取 value（切分实现；key 不带 '='） */
function queryValue(from, key, nextKey) {
  var parts = String(from || '').split(key + '=')
  if (parts.length < 2) return null
  var value = parts[1]
  return nextKey ? value.split('&' + nextKey + '=')[0].split('&')[0] : value.split('&')[0]
}

var PT_SHOW = 'https://ssl.ptlogin2.qq.com/ptqrshow'
var PT_LOGIN = 'https://ssl.ptlogin2.qq.com/ptqrlogin'
var CHECK_SIG = 'https://ssl.ptlogin2.graph.qq.com/check_sig'
var AUTHORIZE = 'https://graph.qq.com/oauth2.0/authorize'

async function getQrCode() {
  var res = await axios.get(withParams(PT_SHOW, {
    appid: '716027609',
    e: '2',
    l: 'M',
    s: '3',
    d: '72',
    v: '4',
    t: String(secureRandInt(100000) / 100000),
    daid: '383',
    pt_3rd_aid: '100497308',
  }), {
    headers: { Referer: 'https://xui.ptlogin2.qq.com/' },
    responseType: 'arraybuffer',
  })
  var cookies = cookieObjFrom(parseSetCookie(res.headers['set-cookie']))
  if (!cookies.qrsig) throw pluginError('unknown', '二维码创建失败（没有 qrsig）')
  var bytes = new Uint8Array(res.data)
  var binary = ''
  for (var i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
  }
  var b64 = (typeof btoa === 'function' ? btoa(binary) : Buffer.from(bytes).toString('base64'))
  return {
    key: cookies.qrsig,
    content: 'https://xui.ptlogin2.qq.com/qrcodelogin',
    qrImage: 'data:image/png;base64,' + b64,
    expiresIn: 180,
  }
}

/** ptuiCB('code','0','redirect',…) 的单引号参数解析（切分实现） */
function parsePtuiArgs(text) {
  var raw = String(text || '')
  var open = raw.indexOf('ptuiCB(')
  if (open < 0) return null
  var close = raw.indexOf(')', open)
  if (close < 0) return null
  var inner = raw.slice(open + 'ptuiCB('.length, close)
  return inner.split(',').map(function (part) {
    return part.trim().replace(/^'/, '').replace(/'$/, '')
  })
}

async function checkQrCode(qrsig) {
  var res = await axios.get(withParams(PT_LOGIN, {
    u1: 'https://graph.qq.com/oauth2.0/login_jump',
    ptqrtoken: String(hash33(qrsig)),
    ptredirect: '0',
    h: '1',
    t: '1',
    g: '1',
    from_ui: '1',
    ptlang: '2052',
    action: '0-0-' + Date.now(),
    js_ver: '20102616',
    js_type: '1',
    pt_uistyle: '40',
    aid: '716027609',
    daid: '383',
    pt_3rd_aid: '100497308',
    has_onekey: '1',
  }), {
    headers: { Referer: 'https://xui.ptlogin2.qq.com/', Cookie: 'qrsig=' + qrsig },
    responseType: 'text',
    validateStatus: null,
  })
  var args = parsePtuiArgs(res.data)
  if (!args) return { status: 'expired' }
  var code = args[0]
  if (code === '66') return { status: 'waiting' }
  if (code === '67') return { status: 'scanned' }
  if (code !== '0') return { status: 'expired' }
  /* code 0：args[2] 里带 ptsigx 与 uin，继续换 musickey */
  var sigx = queryValue(args[2], 'ptsigx', 's_url')
  var uin = queryValue(args[2], 'uin', 'service')
  if (!sigx || !uin) return { status: 'expired' }
  var credentials = await authorizeQq(uin, sigx)
  return { status: 'confirmed', credentials: credentials }
}

/** check_sig（拿 p_skey）→ authorize（Location 里取 code）→ QQLogin CGI */
async function authorizeQq(uin, sigx) {
  var checkRes = await axios.get(withParams(CHECK_SIG, {
    uin: uin,
    pttype: '1',
    service: 'ptqrlogin',
    nodirect: '0',
    ptsigx: sigx,
    s_url: 'https://graph.qq.com/oauth2.0/login_jump',
    ptlang: '2052',
    ptredirect: '100',
    aid: '716027609',
    daid: '383',
    j_later: '0',
    low_login_hour: '0',
    regmaster: '0',
    pt_login_type: '3',
    pt_aid: '0',
    pt_aaid: '16',
    pt_light: '0',
    pt_3rd_aid: '100497308',
  }), {
    headers: { Referer: 'https://xui.ptlogin2.qq.com/' },
    responseType: 'text',
    redirect: 'manual',
    validateStatus: null,
  })
  var sigCookies = cookieObjFrom(parseSetCookie(checkRes.headers['set-cookie']))
  if (!sigCookies.p_skey) throw pluginError('unauthorized', 'QQ 授权失败（没有 p_skey）')

  /* Python 参考里这些参数是 data=（表单请求体），不是 query ——
     放 query 会被 QQ 当空提交，返回 200 页面而非 302 */
  var authBody = formEncode({
    response_type: 'code',
    client_id: '100497308',
    redirect_uri: 'https://y.qq.com/portal/wx_redirect.html?login_type=1&surl=https://y.qq.com/',
    scope: 'get_user_info,get_app_friends',
    state: 'state',
    switch: '',
    from_ptlogin: '1',
    src: '1',
    update_auth: '1',
    openapi: '1010_1030',
    g_tk: String(hash33(sigCookies.p_skey, 5381)),
    auth_time: String(Date.now()),
    ui: 'n1ko-' + Date.now(),
  })
  var authRes = await axios.post(AUTHORIZE, authBody, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Referer: 'https://xui.ptlogin2.qq.com/',
      Cookie: cookieHeader(sigCookies),
    },
    responseType: 'text',
    redirect: 'manual',
    validateStatus: null,
  })
  var location = authRes.headers['location'] || ''
  var code = queryValue(location, 'code', null)
  if (!code) throw pluginError('unauthorized', 'QQ 授权失败（Location 没有 code）')

  var data = await cgi('QQConnectLogin.LoginServer', 'QQLogin', { code: code }, { tmeLoginType: 2 })
  if (!data || !data.musickey) throw pluginError('unauthorized', 'QQ 音乐登录失败')
  /* 昵称/头像趁登录响应里有就存进凭据（模型未定义字段按常见名兜底），
     getUser 不再发请求——euin 链路太重 */
  var nick = data.nick || data.nickname || data.user_nick || ''
  var avatar = data.avatar || data.headpic || data.pic || ''
  return JSON.stringify({
    musicid: data.musicid,
    str_musicid: String(data.str_musicid || data.musicid),
    musickey: data.musickey,
    refresh_key: data.refresh_key || '',
    loginType: 2,
    nick: nick,
    avatar: avatar,
  })
}

/* ============================================================
 * 数据形状映射（QQ → MusicFree 条目）
 * ============================================================ */

function mapSong(raw) {
  var singers = raw.singer || []
  var album = raw.album || {}
  var pay = raw.pay || {}
  var file = raw.file || {}
  return {
    id: String(raw.mid),
    title: raw.title || raw.name || '',
    artist: singers.map(function (s) { return s.name }).join(' / '),
    artistId: singers[0] ? singers[0].mid : undefined,
    album: album.title || album.name || '',
    albumId: album.mid,
    artwork: album.mid ? 'https://y.qq.com/music/photo_new/T002R300x300M000' + (album.pmid || album.mid) + '.jpg' : '',
    duration: raw.interval || 0,
    /* pay.pay_play: 1 = VIP */
    vip: pay.pay_play === 1,
    isrc: raw.isrc ? [raw.isrc] : undefined,
    _mediaMid: file.media_mid || raw.mid,
  }
}

function mapAlbum(raw) {
  var singers = raw.singers || raw.singer || []
  var picId = raw.mid || raw.pmid
  return {
    id: raw.mid || String(raw.id),
    title: raw.title || raw.name || '',
    artist: singers.map(function (s) { return s.name }).join(' / '),
    artistId: singers[0] ? singers[0].mid : undefined,
    artwork: picId ? 'https://y.qq.com/music/photo_new/T002R300x300M000' + picId + '.jpg' : '',
    date: raw.aDate || raw.publish_date || '',
  }
}

function mapSinger(raw) {
  return {
    id: raw.mid,
    name: raw.name,
    avatar: raw.pic ? 'https://y.qq.com/music/photo_new/T001R300x300M000' + raw.pic + '.jpg' : '',
    worksNum: raw.albumNum,
  }
}

function mapSheet(raw) {
  var pic = raw.picurl || raw.pic_url || raw.logo || raw.bigpicUrl
  return {
    id: String(raw.tid !== undefined ? raw.tid : (raw.dissid !== undefined ? raw.dissid : raw.id)),
    title: raw.dissname || raw.title || raw.dirName || raw.name || '',
    artist: [raw.nick || raw.creator || 'QQ 音乐'],
    artwork: pic || (raw.mid ? 'https://y.qq.com/music/photo_new/T002R300x300M000' + raw.mid + '.jpg' : ''),
    worksNum: raw.songnum !== undefined ? raw.songnum : (raw.song_cnt !== undefined ? raw.song_cnt : undefined),
    createUserId: raw.uin !== undefined ? String(raw.uin) : (raw.creator_uin !== undefined ? String(raw.creator_uin) : undefined),
  }
}

/* 音质档位（协议四档 → QQ 文件类型前缀/扩展，modules/song.py SongFileType） */
var QUALITY_FILE = {
  low: { s: 'C400', e: '.m4a' },
  medium: { s: 'M500', e: '.mp3' },
  high: { s: 'M800', e: '.mp3' },
  lossless: { s: 'F000', e: '.flac' },
}

/** 流地址有效期：vkey 经验值 1 小时（过期由宿主重取兜底） */
var STREAM_TTL_MS = 60 * 60 * 1000

/** CDN 域名：GetCdnDispatch 尽力而为（部分网络返回 500003），
 *  失败回落 isure.stream（实测三个 stream 域名对 vkey purl 都返回 206） */
async function cdnBase(guid) {
  var cached = cdnBase._cached
  if (cached) return cached
  var sip = ''
  try {
    var data = await cgi('music.audioCdnDispatch.cdnDispatch', 'GetCdnDispatch', {
      guid: guid,
      uid: '0',
      use_new_domain: 1,
      use_ipv6: 1,
    })
    sip = (data && data.sip && data.sip[0]) || ''
  } catch (e) {
    sip = ''
  }
  if (!sip) sip = 'https://isure.stream.qqmusic.qq.com/'
  if (!/\/$/.test(sip)) sip += '/'
  cdnBase._cached = sip
  return sip
}

/*
 * QRC 歌词解密（algorithms/__init__.py qrc_decrypt + tripledes.py 全量移植）。
 *
 * QQ 用的是**魔改 3DES**（自定义 S 盒与带 bug 的 PC-2 密钥压缩，
 * 见 tripledes.py 文件头引用的 QQMusicDecoder C# 实现）——标准库
 * crypto-js 的 TripleDES 解不开，必须原样移植。表从 Python 源生成。
 */
var QRC_SBOX = [
  [14,4,13,1,2,15,11,8,3,10,6,12,5,9,0,7,0,15,7,4,14,2,13,1,10,6,12,11,9,5,3,8,4,1,14,8,13,6,2,11,15,12,9,7,3,10,5,0,15,12,8,2,4,9,1,7,5,11,3,14,10,0,6,13],
  [15,1,8,14,6,11,3,4,9,7,2,13,12,0,5,10,3,13,4,7,15,2,8,15,12,0,1,10,6,9,11,5,0,14,7,11,10,4,13,1,5,8,12,6,9,3,2,15,13,8,10,1,3,15,4,2,11,6,7,12,0,5,14,9],
  [10,0,9,14,6,3,15,5,1,13,12,7,11,4,2,8,13,7,0,9,3,4,6,10,2,8,5,14,12,11,15,1,13,6,4,9,8,15,3,0,11,1,2,12,5,10,14,7,1,10,13,0,6,9,8,7,4,15,14,3,11,5,2,12],
  [7,13,14,3,0,6,9,10,1,2,8,5,11,12,4,15,13,8,11,5,6,15,0,3,4,7,2,12,1,10,14,9,10,6,9,0,12,11,7,13,15,1,3,14,5,2,8,4,3,15,0,6,10,10,13,8,9,4,5,11,12,7,2,14],
  [2,12,4,1,7,10,11,6,8,5,3,15,13,0,14,9,14,11,2,12,4,7,13,1,5,0,15,10,3,9,8,6,4,2,1,11,10,13,7,8,15,9,12,5,6,3,0,14,11,8,12,7,1,14,2,13,6,15,0,9,10,4,5,3],
  [12,1,10,15,9,2,6,8,0,13,3,4,14,7,5,11,10,15,4,2,7,12,9,5,6,1,13,14,0,11,3,8,9,14,15,5,2,8,12,3,7,0,4,10,1,13,11,6,4,3,2,12,9,5,15,10,11,14,1,7,6,0,8,13],
  [4,11,2,14,15,0,8,13,3,12,9,7,5,10,6,1,13,0,11,7,4,9,1,10,14,3,5,12,2,15,8,6,1,4,11,13,12,3,7,14,10,15,6,8,0,5,9,2,6,11,13,8,1,4,10,7,9,5,0,15,14,2,3,12],
  [13,2,8,4,6,15,11,1,10,9,3,14,5,0,12,7,1,15,13,8,10,3,7,4,12,5,6,11,0,14,9,2,7,11,4,1,9,12,14,2,0,6,10,13,15,3,5,8,2,1,14,7,4,10,8,13,15,12,9,0,3,5,6,11],
]
var QRC_KEY_RND_SHIFT = [1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1]
var QRC_KEY_PERM_C = [56,48,40,32,24,16,8,0,57,49,41,33,25,17,9,1,58,50,42,34,26,18,10,2,59,51,43,35]
var QRC_KEY_PERM_D = [62,54,46,38,30,22,14,6,61,53,45,37,29,21,13,5,60,52,44,36,28,20,12,4,27,19,11,3]
var QRC_KEY_COMPRESSION = [13,16,10,23,0,4,2,27,14,5,20,9,22,18,11,3,25,7,15,6,26,19,12,1,40,51,30,36,46,54,29,39,50,44,32,47,43,48,38,55,33,52,45,41,49,35,28,31]

/** 与标准 DES 不同的位重排（tripledes.py sbox_bit） */
function qrcSboxBit(a) {
  return ((a & 32) | ((a & 31) >> 1) | ((a & 1) << 4))
}

/** 初始置换（结构化：每 8 个目标位一组，组内 v1 在前 v0 在后，移位按 8 递进） */
function qrcInitialPermutation(b) {
  var v0 = (b[0] | (b[1] << 8) | (b[2] << 16) | (b[3] << 24)) >>> 0
  var v1 = (b[4] | (b[5] << 8) | (b[6] << 16) | (b[7] << 24)) >>> 0
  var s0 = 0
  var s1 = 0
  for (var g = 0; g < 4; g++) {
    var baseShift = 6 - 2 * g
    for (var k = 0; k < 8; k++) {
      var src = k < 4 ? v1 : v0
      var sh = baseShift + 8 * (k % 4)
      var target = 31 - (g * 8 + k)
      s0 += ((src >>> sh) & 1) * Math.pow(2, target)
      s1 += ((src >>> (sh + 1)) & 1) * Math.pow(2, target)
    }
  }
  return [s0, s1]
}

/** 逆初始置换（data[n] 的四对位来自移位 24+(11-n)%8 的 8、0、-8、-16） */
function qrcInversePermutation(s0, s1) {
  var out = new Uint8Array(8)
  for (var n = 0; n < 8; n++) {
    var top = 24 + ((11 - n) % 8)
    var byte = 0
    for (var pair = 0; pair < 4; pair++) {
      var sh = top - 8 * pair
      byte = (byte << 2) | ((s1 >>> sh) & 1) << 1 | ((s0 >>> sh) & 1)
    }
    out[n] = byte
  }
  return out
}

/** 轮函数 F（tripledes.py f，逐项移植） */
function qrcF(state, key) {
  var t1 =
    (((state & 1) << 31) |
    ((state & 0xF8000000) >>> 1) |
    ((state & 0x1F800000) >>> 3) |
    ((state & 0x01F80000) >>> 5) |
    ((state & 0x001F8000) >>> 7))
  var t2 =
    (((state & 0x0001F800) << 15) |
    ((state & 0x00001F80) << 13) |
    ((state & 0x000001F8) << 11) |
    ((state & 0x0000001F) << 9) |
    ((state & 0x80000000) >>> 23))

  var k0 = ((t1 >>> 24) & 0xFF) ^ key[0]
  var k1 = ((t1 >>> 16) & 0xFF) ^ key[1]
  var k2 = ((t1 >>> 8) & 0xFF) ^ key[2]
  var k3 = ((t2 >>> 24) & 0xFF) ^ key[3]
  var k4 = ((t2 >>> 16) & 0xFF) ^ key[4]
  var k5 = ((t2 >>> 8) & 0xFF) ^ key[5]

  state =
    (QRC_SBOX[0][qrcSboxBit(k0 >>> 2)] * 268435456) +
    (QRC_SBOX[1][qrcSboxBit(((k0 & 0x03) << 4) | (k1 >>> 4))] * 16777216) +
    (QRC_SBOX[2][qrcSboxBit(((k1 & 0x0F) << 2) | (k2 >>> 6))] * 1048576) +
    (QRC_SBOX[3][qrcSboxBit(k2 & 0x3F)] * 65536) +
    (QRC_SBOX[4][qrcSboxBit(k3 >>> 2)] * 4096) +
    (QRC_SBOX[5][qrcSboxBit(((k3 & 0x03) << 4) | (k4 >>> 4))] * 256) +
    (QRC_SBOX[6][qrcSboxBit(((k4 & 0x0F) << 2) | (k5 >>> 6))] * 16) +
    QRC_SBOX[7][qrcSboxBit(k5 & 0x3F)]

  /* P 置换：目标位 → 源位（python 逐项的表驱动形态） */
  var pMap = [16, 25, 12, 11, 3, 20, 4, 15, 31, 17, 9, 6, 27, 14, 1, 22, 30, 24, 8, 18, 0, 5, 29, 23, 13, 19, 2, 26, 10, 21, 28, 7]
  var out = 0
  for (var i = 0; i < 32; i++) {
    out += ((state >>> pMap[i]) & 1) * Math.pow(2, 31 - i)
  }
  return out
}

/** 8 字节块加/解密（tripledes.py crypt） */
function qrcCryptBlock(input, key) {
  var pair = qrcInitialPermutation(input)
  var s0 = pair[0]
  var s1 = pair[1]
  for (var idx = 0; idx < 15; idx++) {
    var previousS1 = s1
    s1 = (qrcF(s1, key[idx]) ^ s0) >>> 0
    s0 = previousS1
  }
  s0 = (qrcF(s1, key[15]) ^ s0) >>> 0
  return qrcInversePermutation(s0, s1)
}

/** 密钥扩展（含 python 注释明说的 PC-2 偏移 bug，逐项移植） */
function qrcKeySchedule(key8, mode) {
  var schedule = []
  for (var r = 0; r < 16; r++) schedule.push([0, 0, 0, 0, 0, 0])
  var v0 = (key8[0] | (key8[1] << 8) | (key8[2] << 16) | (key8[3] << 24)) >>> 0
  var v1 = (key8[4] | (key8[5] << 8) | (key8[6] << 16) | (key8[7] << 24)) >>> 0

  var c = 0
  for (var i = 0; i < QRC_KEY_PERM_C.length; i++) {
    var b = QRC_KEY_PERM_C[i]
    var bit = b < 32 ? (v0 >>> (31 - b)) & 1 : (v1 >>> (63 - b)) & 1
    c += bit * Math.pow(2, 31 - i)
  }
  var d = 0
  for (var j = 0; j < QRC_KEY_PERM_D.length; j++) {
    var bd = QRC_KEY_PERM_D[j]
    var bitD = bd < 32 ? (v0 >>> (31 - bd)) & 1 : (v1 >>> (63 - bd)) & 1
    d += bitD * Math.pow(2, 31 - j)
  }

  for (var round = 0; round < 16; round++) {
    var shift = QRC_KEY_RND_SHIFT[round]
    c = (Math.floor(c * Math.pow(2, shift)) + Math.floor(c / Math.pow(2, 28 - shift))) % Math.pow(2, 32)
    c -= (c % 16) /* & 0xFFFFFFF0 */
    d = (Math.floor(d * Math.pow(2, shift)) + Math.floor(d / Math.pow(2, 28 - shift))) % Math.pow(2, 32)
    d -= (d % 16)

    var togen = mode === 0 ? 15 - round : round
    for (var x = 0; x < 6; x++) schedule[togen][x] = 0
    for (var jc = 0; jc < 24; jc++) {
      var bitC = Math.floor(c / Math.pow(2, 31 - QRC_KEY_COMPRESSION[jc])) % 2
      schedule[togen][Math.floor(jc / 8)] += bitC * Math.pow(2, 7 - (jc % 8))
    }
    for (var jd = 24; jd < 48; jd++) {
      var bitDc = Math.floor(d / Math.pow(2, 31 - (QRC_KEY_COMPRESSION[jd] - 27))) % 2
      schedule[togen][Math.floor(jd / 8)] += bitDc * Math.pow(2, 7 - (jd % 8))
    }
  }
  return schedule
}

/** 3 组子密钥（DECRYPT=0 / ENCRYPT=1；组合顺序照 python） */
function qrcTripleKeySetup(key24) {
  var dec = qrcKeySchedule(key24.slice(16, 24), 0)
  var enc = qrcKeySchedule(key24.slice(8, 16), 1)
  var dec0 = qrcKeySchedule(key24.slice(0, 8), 0)
  return [dec, enc, dec0]
}

/** HEX 串 → 解密字节（魔改 3DES-ECB，8 字节分块） */
function qrcTripleCrypt(hexText, key24) {
  var schedule = qrcTripleKeySetup(key24)
  var out = new Uint8Array(hexText.length / 2)
  for (var block = 0; block * 16 < hexText.length; block += 1) {
    var chunk = new Uint8Array(8)
    for (var i = 0; i < 8; i++) {
      chunk[i] = Number.parseInt(hexText.slice((block * 16) + i * 2, (block * 16) + i * 2 + 2), 16)
    }
    var produced = qrcCryptBlock(chunk, schedule[0])
    produced = qrcCryptBlock(produced, schedule[1])
    produced = qrcCryptBlock(produced, schedule[2])
    out.set(produced, block * 8)
  }
  return out
}

/** QRC 歌词：HEX → 魔改 3DES → zlib（DecompressionStream 'deflate'）→ LRC 文本。
 *  3DES 无去填充，密文尾块可能带垃圾——zlib 流正常结束后多余的尾部字节
 *  会让 DecompressionStream 抛错（python 的 zlib.decompress 容忍尾部垃圾），
 *  这里增量读取：错误发生前收到的完整前缀就是 LRC 全文。 */
async function qrcDecrypt(hexText) {
  if (!hexText) return ''
  try {
    var keyBytes = new TextEncoder().encode(['!@#)(*$%123ZXC!@', '!@#)(NHL'].join(''))
    var bytes = qrcTripleCrypt(hexText, keyBytes)
    var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'))
    var reader = stream.getReader()
    var chunks = []
    while (true) {
      var r
      try {
        r = await reader.read()
      } catch (e) {
        break
      }
      if (r.done) break
      chunks.push(r.value)
    }
    var total = 0
    for (var ci = 0; ci < chunks.length; ci++) total += chunks[ci].length
    var out = new Uint8Array(total)
    var offset = 0
    for (var cj = 0; cj < chunks.length; cj++) {
      out.set(chunks[cj], offset)
      offset += chunks[cj].length
    }
    return new TextDecoder().decode(out)
  } catch (e) {
    return ''
  }
}

/* 2026-09 起 do_search_v2 各分节从数组改成 { items: [...] } 对象（estimate_sum
   等元数据挪进对象里）；两种形态都要认 */
function sectionItems(v) {
  if (Array.isArray(v)) return v
  if (v && Array.isArray(v.items)) return v.items
  return []
}

/* ============================================================
 * 插件主体
 * ============================================================ */

module.exports = {
  platform: 'qqmusic',
  version: '0.1.6',
  author: 'N1KO',
  description: 'QQ 音乐（用自己的账号听自己有权听的）',

  _crypto: { hash33: hash33, zzcSign: zzcSign, parsePtuiArgs: parsePtuiArgs, queryValue: queryValue, qrcDecrypt: qrcDecrypt },

  /* ---------- 搜索（music.adaptor.SearchAdaptor.do_search_v2） ---------- */
  async search(query, page, type) {
    /* search_type 必须按类型给：100 歌曲 / 10 专辑 / 200 歌手 / 3000 歌单。
       全按 100 查的话新版响应里非歌曲分节恒为空（推荐歌单就是这么哑掉的） */
    var typeMap = { music: 100, album: 10, artist: 200, sheet: 3000 }
    /* searchid 是大整数字符串（utils/common.py get_searchID 的形态）；
       布尔值按服务端约定转 0/1（QQMusicApi 的 bool_to_int 默认转换） */
    var data = await cgi('music.adaptor.SearchAdaptor', 'do_search_v2', {
      searchid: String(18014398509481984 * (1 + secureRandInt(20)) + 4294967296 * secureRandInt(4194304) + (Date.now() % 86400000)),
      search_type: typeMap[type] || 100,
      page_num: 30,
      query: String(query || ''),
      page_id: page || 1,
      highlight: 0,
      grp: 1,
    })
    var body = (data && data.body) || {}
    var meta = (data && data.meta) || {}
    var isEnd = meta.nextpage === undefined ? true : meta.nextpage === -1
    if (type === 'album') return { data: sectionItems(body.item_album).map(mapAlbum), isEnd: isEnd }
    if (type === 'artist') return { data: sectionItems(body.singer).map(mapSinger), isEnd: isEnd }
    if (type === 'sheet') return { data: sectionItems(body.item_songlist).map(mapSheet), isEnd: isEnd }
    return { data: sectionItems(body.item_song).map(mapSong), isEnd: isEnd }
  },

  /* ---------- 取流（vkey.GetVkey.UrlGetVkey + CDN 拼接） ---------- */
  async getMediaSource(musicItem, quality) {
    var guid = await ensureGuid(env)
    var file = QUALITY_FILE[quality] || QUALITY_FILE.medium
    var mediaMid = musicItem._mediaMid || musicItem.id
    var filename = file.s + mediaMid + file.e
    var cred = parseCredentials(env && env.credentials)
    var data = await cgi('music.vkey.GetVkey', 'UrlGetVkey', {
      uin: (cred && cred.str_musicid) || '0',
      filename: [filename],
      guid: guid,
      songmid: [musicItem.id],
      songtype: [0],
      ctx: 0,
    })
    var info = (data && data.midurlinfo && data.midurlinfo[0]) || {}
    /* 104003 无权限 / 104004 vkey 失败 / 104013 设备受限 */
    if (!info.purl) {
      if (info.result === 104003 || info.result === 104013) {
        throw pluginError('forbidden', '当前账号无权播放此曲（VIP / 付费曲目）')
      }
      throw pluginError('not-found', '未取到流地址（result ' + info.result + '）')
    }
    return {
      url: (await cdnBase(guid)) + info.purl,
      expiresIn: Math.floor(STREAM_TTL_MS / 1000),
    }
  },

  /* ---------- 歌词（GetPlayLyricInfo：base64 → 3DES-ECB → zlib → LRC） ---------- */
  async getLyric(musicItem) {
    var data = await cgi('music.musichallSong.PlayLyricInfo', 'GetPlayLyricInfo', {
      crypt: 1,
      lrc_t: 0,
      qrc: 0,
      qrc_t: 0,
      roma: 0,
      roma_t: 0,
      trans: 0,
      trans_t: 0,
      type: 1,
      songMid: musicItem.id,
    })
    return {
      rawLrc: await qrcDecrypt(data && data.lyric),
      translation: await qrcDecrypt(data && data.trans),
    }
  },

  /* ---------- 专辑 / 歌手 ---------- */
  async getAlbumInfo(albumItem) {
    var param = /^\d+$/.test(String(albumItem.id))
      ? { albumId: Number(albumItem.id) }
      : { albumMId: albumItem.id }
    /* GetAlbumDetail 只回元数据（basicInfo/singer/company），歌曲在
       GetAlbumSongList——实测两个端点都是这个形状；cgi() 返回的已是 req_0.data */
    var meta = await cgi('music.musichallAlbum.AlbumInfoServer', 'GetAlbumDetail', param)
    var basic = (meta && meta.basicInfo) || {}
    var songs = await cgi('music.musichallAlbum.AlbumSongList', 'GetAlbumSongList', {
      albumMid: basic.albumMid || (/^\d+$/.test(String(albumItem.id)) ? undefined : albumItem.id),
      albumId: basic.albumMid ? undefined : Number(albumItem.id),
      begin: 0,
      num: 200,
      order: 2,
    })
    var metaSingers = (meta && meta.singer) || []
    return {
      /* 本方法一次拉全（num 200），isEnd 必须给 true，否则宿主拉全循环会重拉 */
      isEnd: true,
      title: basic.albumName || albumItem.title,
      artwork: albumItem.artwork,
      description: basic.desc || '',
      artist: metaSingers.map(function (s) { return s.name }).join(' / ') || albumItem.artist,
      date: (basic.publishDate || '').slice(0, 4),
      musicList: ((songs && songs.songList) || []).map(function (row) { return mapSong(row.songInfo || row) }),
    }
  },

  async getArtistWorks(artistItem, page, type) {
    var data = await cgi('musichall.song_list_server', 'GetSingerSongList', {
      singerMid: artistItem.id,
      order: 1,
      number: 50,
      begin: ((page || 1) - 1) * 50,
    })
    /* 实测响应是驼峰：songList[].songInfo，总数在 totalNum（cgi 已剥掉 req_0 外壳） */
    var songs = ((data && data.songList) || []).map(function (row) { return mapSong(row.songInfo || row) })
    if (type === 'music') return { data: songs, isEnd: !data || !data.totalNum || (page || 1) * 50 >= data.totalNum }
    return { data: [], isEnd: true }
  },

  /* ---------- 榜单（music.musicToplist.Toplist：GetAll 的数据在 group[]） ---------- */
  async getTopLists() {
    var data = await cgi('music.musicToplist.Toplist', 'GetAll', {})
    var groups = (data && data.group) || []
    var mapped = groups.map(function (group) {
      return {
        title: group.groupName || '排行榜',
        data: (group.toplist || []).map(function (raw) {
          return {
            id: String(raw.topId),
            title: raw.title || '',
            artwork: raw.frontPicUrl || raw.headPicUrl || raw.mbFrontPicUrl,
            worksNum: raw.totalNum,
          }
        }),
      }
    }).filter(function (g) { return g.data.length > 0 })
    /* 登录后置顶「雷达推荐」（每日推荐，GetRadarSong） */
    if (parseCredentials(env && env.credentials)) {
      mapped.unshift({ title: '每日推荐', data: [{ id: '__radar__', title: '雷达推荐 · 猜你喜欢' }] })
    }
    return mapped
  },

  async getTopListDetail(topListItem) {
    var id = String(topListItem.id)
    if (id === '__radar__') {
      return { musicList: await fetchRadarSongs() }
    }
    var data = await cgi('music.musicToplist.Toplist', 'GetDetail', {
      topId: Number(id),
      offset: 0,
      num: 100,
      withTags: false,
    })
    /* 歌曲在 data.songInfoList（data.song 是同长度占位数组），标题在 data.data */
    return { musicList: ((data && data.songInfoList) || []).map(mapSong) }
  },

  /* ---------- 推荐歌单：do_search_v2 搜热门歌单（web 端没有直接的推荐歌单端点） ---------- */
  async getRecommendSheetTags() {
    return [{ title: '热门' }, { title: '经典' }, { title: '伤感' }, { title: '轻音乐' }]
  },

  async getRecommendSheetsByTag(tag, page) {
    return this.search((tag && tag.title) || '热门歌单', page || 1, 'sheet')
  },

  /* ---------- 歌单详情 / 导入 ---------- */
  async getMusicSheetInfo(musicSheet) {
    var data = await cgi('music.srfDissInfo.DissInfo', 'CgiGetDiss', {
      disstid: Number(musicSheet.id),
      dirid: 0,
      tag: 1,
      song_begin: 0,
      song_num: 200,
      userinfo: 1,
      orderlist: true,
      onlysonglist: 0,
    })
    var dirinfo = (data && data.dirinfo) || {}
    var songs = (data && data.songlist) || []
    return {
      title: dirinfo.title || musicSheet.title,
      musicList: songs.map(mapSong),
      isEnd: true,
    }
  },

  async importMusicSheet(urlLike) {
    var runs = String(urlLike || '').split(/[^0-9]+/).filter(Boolean)
    if (!runs.length) throw pluginError('not-found', '链接里没有歌单 id')
    var imported = await this.getMusicSheetInfo({ id: runs[runs.length - 1] })
    return imported.musicList
  },

  async importMusicItem(urlLike) {
    /* 歌曲 mid 是 14 位字母数字串；按非字母数字切段取第一个 14 长度段 */
    var tokens = String(urlLike || '').split(/[^A-Za-z0-9]+/).filter(function (t) { return t.length === 14 })
    if (!tokens.length) throw pluginError('not-found', '链接里没有歌曲 mid')
    var mid = tokens[0]
    var result = await this.search(mid, 1, 'music')
    var hit = result.data.find(function (s) { return s.id === mid })
    if (!hit) throw pluginError('not-found', '歌曲不存在')
    return hit
  },

  /* ---------- 用户域（需要登录） ---------- */
  user: {
    async getPlaylists() {
      var cred = requireLogin()
      var data = await cgi('music.musicasset.PlaylistBaseRead', 'GetPlaylistByUin', { uin: cred.str_musicid })
      var created = ((data && data.v_playlist) || []).map(mapSheet)
      /* QQ 的收藏歌单在另一个端点（PlaylistFavRead，需要 euin）；v1 只返回创建的歌单 */
      return { created: created, subscribed: [] }
    },

    async getUser() {
      var cred = requireLogin()
      /* 昵称/头像在登录时已存进凭据（见 authorizeQq）；
         GetHomepageHeader 需要 euin 加密链路，不值得为个昵称走一遍 */
      return { name: cred.nick || 'QQ 音乐用户', avatar: cred.avatar || '' }
    },
  },

  /* n1ko 扩展：宿主登录页（QrLogin）与账号横幅用 */
  n1ko: {
    auth: {
      createQr() { return getQrCode() },
      checkQr(key) { return checkQrCode(key) },
      getUser() { return module.exports.user.getUser() },
    },
    user: {
      getPlaylists() { return module.exports.user.getPlaylists() },
      getUser() { return module.exports.user.getUser() },
      /** 雷达推荐（宿主首页「今日推荐」合并区；未登录抛 unauthorized 由宿主降级为空） */
      getRecommendSongs() { return fetchRadarSongs() },
    },
    getMediaSource(item, quality) { return module.exports.getMediaSource(item, quality) },
  },
}
