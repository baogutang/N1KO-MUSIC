#!/usr/bin/env node
/**
 * 本地 mock Subsonic 服务器 —— 只为开发与截图存在，不参与构建、不上线。
 *
 * 解决两个具体问题：
 *   1. 改 UI 时不必真的连一台 NAS。登录页之后的所有界面（首页、专辑、歌手、
 *      歌单、正在播放、歌词）此前都要有真实服务器才看得到。
 *   2. README 里的界面截图可复现。以前那几张是对着某台私人 Navidrome 拍的，
 *      换皮肤 / 改版面之后没人能拍出同样内容的一张。现在曲库是固定的假数据，
 *      任何人跑一次都能得到像素级一致的截图。
 *
 * 用法：
 *   node scripts/mock-subsonic.mjs            # 监听 4533
 *   PORT=4600 node scripts/mock-subsonic.mjs
 *
 * 然后在应用里按 Navidrome / Subsonic 连接 http://localhost:4533，
 * 用户名密码随便填——本服务不校验凭据。
 *
 * 覆盖范围是「应用真的会调的那些接口」，不是完整的 Subsonic 协议实现。
 * 曲目内容与 docs/redesign/ 下的设计 demo 保持一致，方便设计稿和真机对照。
 */

import http from 'node:http'

const PORT = Number(process.env.PORT) || 4533
const API_VERSION = '1.16.1'

/* ============================================================
   曲库固件
   ============================================================ */

/** @type {{name:string, sub:string, artist:string, year:number, genre:string, notes:string, tracks:[string,number][]}[]} */
const ALBUM_SEED = [
  {
    name: '风过留痕', sub: '影视原声带', artist: '李佳薇', year: 2023, genre: '原声',
    notes: '电影《风过留痕》原声大碟。李佳薇首度担任音乐总监，以弦乐四重奏为骨架，收录主题曲与五首插曲，讲述一个关于告别与记得的故事。',
    tracks: [['风过留痕', 252], ['此时此刻', 216], ['自由灵魂', 242], ['重写剧本', 224], ['青春追问', 268], ['风过留痕（弦乐版）', 237]],
  },
  {
    name: 'Home', sub: 'feat. Hikaru', artist: 'Charlie Puth', year: 2022, genre: 'Pop',
    notes: '跨洋合作单曲企划。Charlie Puth 的旋律直觉与宇多田光的词作在一间云端录音室里相遇，关于「家」的四种想象。',
    tracks: [['Home (feat. Hikaru)', 212], ['Left and Right', 178], ['Stay With Me', 190], ['Home (Acoustic)', 185]],
  },
  {
    name: 'rosie', sub: '', artist: 'ROSÉ', year: 2024, genre: 'Pop',
    notes: 'ROSÉ 首张正规专辑。橘红色的、带刺的、诚实的一本日记，十二首歌写给过去的自己。',
    tracks: [['rosie', 176], ['number one girl', 201], ['toxic till the end', 179], ['two years', 184], ['drinks or coffee', 168]],
  },
  {
    name: '火力全开', sub: '', artist: '王力宏', year: 2011, genre: '华语流行',
    notes: '中西合璧的流行实验。把京剧的锣鼓点塞进电子节拍里，十一年后再听依然生猛。',
    tracks: [['火力全开', 213], ['另一个天堂', 252], ['心跳', 228], ['大城小爱', 221]],
  },
  {
    name: '亏欠', sub: '', artist: '徐佳莹', year: 2022, genre: '华语流行',
    notes: '徐佳莹第六张录音室专辑。燕麦色的、温吞的、在深夜慢慢发烫的十首歌，唱给所有没说出口的抱歉。',
    tracks: [['亏欠', 238], ['准明星', 216], ['没有第三者的分手', 261], ['在意这件事', 232]],
  },
  {
    name: 'Beyond The Stage', sub: '', artist: 'BEYOND', year: 1991, genre: '摇滚',
    notes: '1991 年红磡演唱会现场录音。舞台之外，理想之内，一个时代的克莱因蓝。',
    tracks: [['海阔天空', 326], ['光辉岁月', 299], ['真的爱你', 277], ['不再犹豫', 251]],
  },
  {
    name: '情歌101', sub: '', artist: '光良', year: 2020, genre: '华语流行',
    notes: '光良情歌精选重修版。101 分的诚意，从《童话》到《约定》，重新编曲，重新流泪。',
    tracks: [['童话', 245], ['第一次', 262], ['约定', 238], ['勇气', 241]],
  },
  {
    name: 'A Time 4 You', sub: '', artist: '林峯', year: 2013, genre: '粤语流行',
    notes: '林峯第九张个人专辑。紫灰色的都市夜行，时间是你唯一带不走的行李。',
    tracks: [['A Time 4 You', 241], ['Nice', 216], ['爱在记忆中找你', 235], ['如果时间来到', 248]],
  },
]

/** 播放次数是伪随机但确定的：同一首歌每次启动都拿到同一个数，截图才可复现 */
function stableCount(seed, max) {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (Math.abs(h) % max) + 1
}

const albums = []
const songs = []
const artistsByName = new Map()

ALBUM_SEED.forEach((seed, ai) => {
  const albumId = `al-${ai + 1}`
  if (!artistsByName.has(seed.artist)) {
    artistsByName.set(seed.artist, {
      id: `ar-${artistsByName.size + 1}`,
      name: seed.artist,
      albumCount: 0,
      coverArt: `ar-${artistsByName.size + 1}`,
      starred: undefined,
    })
  }
  const artist = artistsByName.get(seed.artist)
  artist.albumCount += 1

  const albumSongs = seed.tracks.map(([title, duration], ti) => ({
    id: `so-${ai + 1}-${ti + 1}`,
    parent: albumId,
    isDir: false,
    title,
    album: seed.name,
    albumId,
    artist: seed.artist,
    artistId: artist.id,
    coverArt: albumId,
    duration,
    track: ti + 1,
    year: seed.year,
    genre: seed.genre,
    size: duration * 176400,
    contentType: 'audio/flac',
    suffix: 'flac',
    bitRate: 1005,
    bitDepth: 24,
    samplingRate: 96000,
    channelCount: 2,
    path: `${seed.artist}/${seed.name}/${String(ti + 1).padStart(2, '0')} ${title}.flac`,
    playCount: stableCount(`${albumId}-${ti}`, 40),
    // 每张专辑的第 1 首标星，收藏页与「已收藏」筛选才有内容
    starred: ti === 0 ? '2026-08-01T09:12:00.000Z' : undefined,
    userRating: ti === 0 ? 5 : undefined,
    created: new Date(Date.UTC(2026, 7, 28 - ai, 10, ti)).toISOString(),
    replayGain: { trackGain: -7.2, albumGain: -7.6, trackPeak: 0.98, albumPeak: 0.99 },
  }))

  songs.push(...albumSongs)
  albums.push({
    id: albumId,
    name: seed.name,
    title: seed.name,
    artist: seed.artist,
    artistId: artist.id,
    coverArt: albumId,
    songCount: albumSongs.length,
    duration: albumSongs.reduce((s, x) => s + x.duration, 0),
    year: seed.year,
    genre: seed.genre,
    playCount: stableCount(albumId, 120),
    created: new Date(Date.UTC(2026, 7, 28 - ai, 9)).toISOString(),
    starred: ai % 3 === 0 ? '2026-08-02T20:00:00.000Z' : undefined,
    _notes: seed.notes,
    _sub: seed.sub,
  })
})

const artists = [...artistsByName.values()]
const songById = new Map(songs.map(s => [s.id, s]))
const albumById = new Map(albums.map(a => [a.id, a]))

const playlists = [
  { id: 'pl-1', name: '深夜降落', comment: '给凌晨两点还醒着的人', songIds: ['so-1-1', 'so-5-1', 'so-7-1', 'so-3-3', 'so-8-1'] },
  { id: 'pl-2', name: '通勤加速', comment: '四十分钟，刚好一趟地铁', songIds: ['so-4-1', 'so-6-1', 'so-2-2', 'so-3-1'] },
  { id: 'pl-3', name: '一个人的房间', comment: '', songIds: ['so-5-3', 'so-1-3', 'so-7-2'] },
]

const LYRICS = [
  [0, '站台的风 吹散黄昏'], [11, '把故事 唱给夜归人'], [22, '此时此刻 做最自由灵魂'],
  [33, '别等时针'], [40, '转过青春 再追问'], [52, '为何没来得及爱一个人'],
  [66, '重写剧本'], [74, '不管 不听 不问 谁的标准'], [88, '去见证 每段青春'],
  [99, '每出戏剧 每首诗文'], [110, '每种世界 缤纷'], [121, '自我旋转 自由灵魂'],
  [136, '风吹过处 皆留痕'], [150, '而我们 仍在路上'],
]

/* ============================================================
   封面：内联 SVG，与 docs/redesign 的设计 demo 同一套构图
   ============================================================ */

function coverSVG(index) {
  const S = "xmlns='http://www.w3.org/2000/svg' viewBox='0 0 600 600' width='600' height='600'"
  const covers = [
    `<svg ${S}><rect width='600' height='600' fill='#efe0bd'/>
      <g stroke='#c9a75e' stroke-width='1.4'><line x1='60' y1='120' x2='470' y2='120'/><line x1='110' y1='160' x2='540' y2='160'/><line x1='60' y1='200' x2='380' y2='200'/><line x1='150' y1='240' x2='540' y2='240'/><line x1='60' y1='470' x2='300' y2='470'/><line x1='60' y1='505' x2='420' y2='505'/></g>
      <text x='38' y='448' font-family='Noto Serif SC,Songti SC,serif' font-weight='900' font-size='300' fill='#2e2418'>风</text>
      <rect x='452' y='60' width='86' height='86' fill='#b03a26'/>
      <text x='495' y='97' text-anchor='middle' font-family='Noto Serif SC,Songti SC,serif' font-size='30' fill='#f4efe3'>原声</text>
      <text x='495' y='130' text-anchor='middle' font-family='Noto Serif SC,Songti SC,serif' font-size='30' fill='#f4efe3'>留痕</text></svg>`,
    `<svg ${S}><rect width='600' height='600' fill='#78aede'/>
      <circle cx='470' cy='120' r='72' fill='#f4efe3'/><rect x='90' y='270' width='300' height='200' fill='#123c66'/>
      <path d='M60 275 L240 130 L420 275 Z' fill='#0d2c4c'/><rect x='205' y='350' width='70' height='120' fill='#f4efe3'/>
      <text x='82' y='548' font-family='JetBrains Mono,monospace' font-weight='500' font-size='64' letter-spacing='14' fill='#f4efe3'>HOME</text></svg>`,
    `<svg ${S}><rect width='600' height='600' fill='#d84e22'/>
      <circle cx='300' cy='300' r='238' fill='none' stroke='#f4efe3' stroke-width='1.4' stroke-dasharray='3 7'/>
      <text x='300' y='336' text-anchor='middle' font-family='Noto Serif SC,serif' font-style='italic' font-weight='700' font-size='148' fill='#f8f1e6'>rosie</text>
      <line x1='210' y1='386' x2='390' y2='386' stroke='#f8f1e6' stroke-width='1.2'/>
      <text x='300' y='424' text-anchor='middle' font-family='JetBrains Mono,monospace' font-size='19' letter-spacing='8' fill='#f8d9c6'>ROSÉ · 2024</text></svg>`,
    `<svg ${S}><rect width='600' height='600' fill='#38220f'/>
      <g transform='rotate(-24 300 300)'><rect x='-120' y='330' width='840' height='44' fill='#e8641e'/><rect x='-120' y='392' width='840' height='22' fill='#f2a03d'/><rect x='-120' y='432' width='840' height='10' fill='#c74b16'/></g>
      <g font-family='Noto Serif SC,serif' font-weight='900' font-size='92' fill='#f4efe3'><text x='96' y='170'>火</text><text x='96' y='272'>力</text><text x='96' y='374'>全</text><text x='96' y='476'>开</text></g></svg>`,
    `<svg ${S}><rect width='600' height='600' fill='#d9cdb6'/>
      <circle cx='300' cy='268' r='150' fill='none' stroke='#3a352c' stroke-width='2.6'/><circle cx='300' cy='118' r='5' fill='#3a352c'/>
      <text x='300' y='296' text-anchor='middle' font-family='Noto Serif SC,serif' font-weight='600' font-size='86' fill='#3a352c'>亏欠</text>
      <line x1='140' y1='482' x2='460' y2='482' stroke='#8a7f68' stroke-width='1'/>
      <text x='300' y='520' text-anchor='middle' font-family='Noto Sans SC,sans-serif' font-size='17' letter-spacing='8' fill='#6f6650'>徐佳莹 · 2022</text></svg>`,
    `<svg ${S}><rect width='600' height='600' fill='#1e40a4'/>
      <g transform='translate(235 300)'><circle r='205' fill='#141210'/>
      ${[-188, -168, -148, -128, -108, -88].map(r => `<circle r='${r}' fill='none' stroke='#2c2925' stroke-width='1.6'/>`).join('')}
      <circle r='66' fill='#f4efe3'/><circle r='7' fill='#141210'/></g>
      <text x='492' y='240' text-anchor='middle' font-family='JetBrains Mono,monospace' font-size='19' letter-spacing='4' fill='#f4efe3'>BEYOND</text>
      <text x='492' y='270' text-anchor='middle' font-family='JetBrains Mono,monospace' font-size='13' letter-spacing='3' fill='#9fb2e4'>THE STAGE</text></svg>`,
    `<svg ${S}><rect width='600' height='600' fill='#c33a2a'/>
      <rect x='34' y='34' width='532' height='532' fill='none' stroke='#f8f1e6' stroke-width='1.4'/>
      <text x='300' y='158' text-anchor='middle' font-family='Noto Serif SC,serif' font-size='44' letter-spacing='26' fill='#f8f1e6'>情歌</text>
      <text x='300' y='436' text-anchor='middle' font-family='Noto Serif SC,serif' font-weight='900' font-size='262' fill='#f8f1e6'>101</text></svg>`,
    `<svg ${S}><rect width='600' height='600' fill='#8d8698'/>
      <g transform='translate(300 290)'>
      ${Array.from({ length: 12 }, (_, k) => `<line x1='0' y1='-196' x2='0' y2='${k % 3 === 0 ? -158 : -176}' stroke='#e8e4ec' stroke-width='${k % 3 === 0 ? 2.4 : 1.2}' transform='rotate(${k * 30})'/>`).join('')}
      <line x1='0' y1='0' x2='0' y2='-128' stroke='#f4efe3' stroke-width='3'/><line x1='0' y1='0' x2='86' y2='52' stroke='#f4efe3' stroke-width='2'/><circle r='6' fill='#f4efe3'/></g>
      <text x='300' y='86' text-anchor='middle' font-family='Noto Serif SC,serif' font-weight='700' font-size='42' letter-spacing='14' fill='#f4efe3'>A TIME 4 YOU</text></svg>`,
  ]
  return covers[index % covers.length]
}

/** 歌手头像：首字 + 单色底，够用就行 */
function artistSVG(index, name) {
  const tints = ['#4f46e5', '#14713f', '#c23217', '#b8442a', '#1e40a4', '#8d8698', '#d84e22', '#38220f']
  return `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 600 600' width='600' height='600'>
    <rect width='600' height='600' fill='${tints[index % tints.length]}'/>
    <text x='300' y='372' text-anchor='middle' font-family='Noto Sans SC,sans-serif' font-weight='700' font-size='260' fill='#fbf1e3'>${escapeXml(name.slice(0, 1))}</text>
  </svg>`
}

function escapeXml(s) {
  return String(s).replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]))
}

/* ============================================================
   静音音频：让播放器真的能跑进度条
   8kHz / 单声道 / 8bit —— 一首 4 分钟的曲子约 1.9MB，
   够撑起「按下播放、时间在走、能拖动」这套交互。
   ============================================================ */

function silentWav(seconds) {
  const rate = 8000
  const samples = Math.max(1, Math.floor(rate * seconds))
  const buf = Buffer.alloc(44 + samples)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + samples, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)      // PCM
  buf.writeUInt16LE(1, 22)      // mono
  buf.writeUInt32LE(rate, 24)
  buf.writeUInt32LE(rate, 28)   // byte rate
  buf.writeUInt16LE(1, 32)      // block align
  buf.writeUInt16LE(8, 34)      // bits
  buf.write('data', 36)
  buf.writeUInt32LE(samples, 40)
  buf.fill(128, 44)             // 8bit PCM 的静音是 0x80
  return buf
}

/* ============================================================
   响应封装
   ============================================================ */

function ok(payload = {}) {
  return { 'subsonic-response': { status: 'ok', version: API_VERSION, type: 'navidrome', serverVersion: '0.53.3-mock', openSubsonic: true, ...payload } }
}

function publicSong(s) {
  const { ...rest } = s
  return rest
}

function publicAlbum(a) {
  const { _notes, _sub, ...rest } = a
  return rest
}

function songsOfAlbum(id) {
  return songs.filter(s => s.albumId === id)
}

function pick(list, offset, size) {
  return list.slice(offset, offset + size)
}

/* ============================================================
   路由
   ============================================================ */

const handlers = {
  ping: () => ok(),

  getOpenSubsonicExtensions: () => ok({
    openSubsonicExtensions: [
      { name: 'songLyrics', versions: [1] },
      { name: 'transcodeOffset', versions: [1] },
    ],
  }),

  getMusicFolders: () => ok({ musicFolders: { musicFolder: [{ id: 1, name: '音乐' }] } }),

  getGenres: () => {
    const counts = new Map()
    songs.forEach(s => counts.set(s.genre, (counts.get(s.genre) || 0) + 1))
    return ok({
      genres: {
        genre: [...counts].map(([value, songCount]) => ({
          value,
          songCount,
          albumCount: albums.filter(a => a.genre === value).length,
        })),
      },
    })
  },

  getAlbumList2: q => {
    const size = Number(q.size) || 10
    const offset = Number(q.offset) || 0
    let list = [...albums]
    switch (q.type) {
      case 'frequent': list.sort((a, b) => b.playCount - a.playCount); break
      case 'starred': list = list.filter(a => a.starred); break
      case 'alphabeticalByName': list.sort((a, b) => a.name.localeCompare(b.name, 'zh')); break
      case 'byYear': list.sort((a, b) => a.year - b.year); break
      case 'byGenre': list = list.filter(a => a.genre === q.genre); break
      case 'random': list.reverse(); break   // 「随机」也要可复现，只做一次翻转
      default: break                          // newest / recent：按 created 倒序，即固件顺序
    }
    return ok({ albumList2: { album: pick(list, offset, size).map(publicAlbum) } })
  },

  getAlbum: q => {
    const album = albumById.get(q.id)
    if (!album) return ok({ album: undefined })
    return ok({ album: { ...publicAlbum(album), song: songsOfAlbum(album.id).map(publicSong) } })
  },

  getAlbumInfo2: q => {
    const album = albumById.get(q.id)
    return ok({ albumInfo: { notes: album?._notes ?? '', musicBrainzId: '', smallImageUrl: '', largeImageUrl: '' } })
  },

  getArtists: () => {
    // Subsonic 按首字母分组；中文名统一丢进「#」组，够 UI 渲染即可
    const index = new Map()
    artists.forEach(a => {
      const letter = /^[a-zA-Z]/.test(a.name) ? a.name[0].toUpperCase() : '#'
      if (!index.has(letter)) index.set(letter, [])
      index.get(letter).push(a)
    })
    return ok({
      artists: {
        ignoredArticles: 'The El La Los Las Le Les',
        index: [...index].sort(([a], [b]) => a.localeCompare(b)).map(([name, artist]) => ({ name, artist })),
      },
    })
  },

  getArtist: q => {
    const artist = artists.find(a => a.id === q.id)
    if (!artist) return ok({ artist: undefined })
    return ok({ artist: { ...artist, album: albums.filter(a => a.artistId === artist.id).map(publicAlbum) } })
  },

  getArtistInfo2: q => {
    const artist = artists.find(a => a.id === q.id)
    return ok({
      artistInfo2: {
        biography: `${artist?.name ?? ''} 的资料由 mock 服务提供，用于本地开发与截图。`,
        similarArtist: artists.filter(a => a.id !== q.id).slice(0, 4),
        smallImageUrl: '', mediumImageUrl: '', largeImageUrl: '',
      },
    })
  },

  getTopSongs: q => ok({
    topSongs: { song: songs.filter(s => s.artist === q.artist).slice(0, Number(q.count) || 10).map(publicSong) },
  }),

  getSimilarSongs2: q => ok({
    similarSongs2: { song: songs.filter(s => s.id !== q.id).slice(0, Number(q.count) || 10).map(publicSong) },
  }),

  getRandomSongs: q => {
    const size = Number(q.size) || 10
    // 「随机」在 mock 里是固定的隔位取样：截图才能复现
    return ok({ randomSongs: { song: songs.filter((_, i) => i % 3 === 0).slice(0, size).map(publicSong) } })
  },

  getStarred2: () => ok({
    starred2: {
      song: songs.filter(s => s.starred).map(publicSong),
      album: albums.filter(a => a.starred).map(publicAlbum),
      artist: artists.slice(0, 2),
    },
  }),

  getSong: q => ok({ song: songById.get(q.id) ? publicSong(songById.get(q.id)) : undefined }),

  search3: q => {
    const query = String(q.query || '').trim().toLowerCase()
    const songCount = Number(q.songCount ?? 20)
    const songOffset = Number(q.songOffset || 0)
    const albumCount = Number(q.albumCount ?? 20)
    const artistCount = Number(q.artistCount ?? 20)
    const matchSong = s => !query || s.title.toLowerCase().includes(query) || s.artist.toLowerCase().includes(query) || s.album.toLowerCase().includes(query)
    const matched = songs.filter(matchSong)
    return ok({
      searchResult3: {
        song: pick(matched, songOffset, songCount).map(publicSong),
        album: albums.filter(a => !query || a.name.toLowerCase().includes(query) || a.artist.toLowerCase().includes(query)).slice(0, albumCount).map(publicAlbum),
        artist: artists.filter(a => !query || a.name.toLowerCase().includes(query)).slice(0, artistCount),
        totalMatched: matched.length,
      },
    })
  },

  getPlaylists: () => ok({
    playlists: {
      playlist: playlists.map(p => ({
        id: p.id, name: p.name, comment: p.comment, owner: 'demo', public: false,
        songCount: p.songIds.length,
        duration: p.songIds.reduce((s, id) => s + (songById.get(id)?.duration || 0), 0),
        created: '2026-08-01T12:00:00.000Z', changed: '2026-08-27T12:00:00.000Z',
        coverArt: songById.get(p.songIds[0])?.albumId,
      })),
    },
  }),

  getPlaylist: q => {
    const p = playlists.find(x => x.id === q.id)
    if (!p) return ok({ playlist: undefined })
    return ok({
      playlist: {
        id: p.id, name: p.name, comment: p.comment, owner: 'demo', public: false,
        songCount: p.songIds.length,
        duration: p.songIds.reduce((s, id) => s + (songById.get(id)?.duration || 0), 0),
        created: '2026-08-01T12:00:00.000Z', changed: '2026-08-27T12:00:00.000Z',
        coverArt: songById.get(p.songIds[0])?.albumId,
        entry: p.songIds.map(id => publicSong(songById.get(id))).filter(Boolean),
      },
    })
  },

  getLyricsBySongId: q => {
    const song = songById.get(q.id)
    if (!song) return ok({ lyricsList: { structuredLyrics: [] } })
    return ok({
      lyricsList: {
        structuredLyrics: [{
          displayArtist: song.artist, displayTitle: song.title, lang: 'zho',
          offset: 0, synced: true,
          line: LYRICS.map(([start, value]) => ({ start: start * 1000, value })),
        }],
      },
    })
  },

  getLyrics: q => ok({
    lyrics: { value: LYRICS.map(([, v]) => v).join('\n'), title: String(q.title || ''), artist: String(q.artist || '') },
  }),

  getNowPlaying: () => ok({ nowPlaying: { entry: [] } }),
  getScanStatus: () => ok({ scanStatus: { scanning: false, count: songs.length } }),
  getPlayQueue: () => ok({ playQueue: undefined }),
  getBookmarks: () => ok({ bookmarks: { bookmark: [] } }),
  getShares: () => ok({ shares: { share: [] } }),

  // 写操作一律接受但不落盘：mock 的曲库是常量，重启即回到同一状态
  savePlayQueue: () => ok(),
  createBookmark: () => ok(),
  deleteBookmark: () => ok(),
  star: () => ok(),
  unstar: () => ok(),
  setRating: () => ok(),
  scrobble: () => ok(),
  updateMediaAnnotation: () => ok(),
  setLyrics: () => ok(),
  startScan: () => ok({ scanStatus: { scanning: true, count: songs.length } }),
  createPlaylist: q => ok({ playlist: { id: 'pl-new', name: String(q.name || '新歌单'), songCount: 0, duration: 0, entry: [] } }),
  updatePlaylist: () => ok(),
  deletePlaylist: () => ok(),
  deleteShare: () => ok(),
  createShare: q => ok({
    shares: { share: [{ id: 'sh-1', url: `http://localhost:${PORT}/share/sh-1`, description: String(q.description || ''), created: new Date().toISOString() }] },
  }),
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)
  const query = Object.fromEntries(url.searchParams)

  // 前端跑在另一个端口，全部请求都是跨域的
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range,Accept-Ranges,Content-Length')
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

  // /rest/getAlbum 与 /rest/getAlbum.view 都要认
  const name = url.pathname.replace(/^\/rest\//, '').replace(/\.view$/, '')

  if (name === 'getCoverArt') {
    const id = String(query.id || '')
    let svg
    if (id.startsWith('ar-')) {
      const i = artists.findIndex(a => a.id === id)
      svg = artistSVG(Math.max(0, i), artists[i]?.name || '?')
    } else {
      const i = albums.findIndex(a => a.id === id || a.id === id.replace(/^al-/, 'al-'))
      svg = coverSVG(Math.max(0, i))
    }
    res.writeHead(200, { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' })
    res.end(svg)
    return
  }

  if (name === 'stream' || name === 'download') {
    const song = songById.get(String(query.id))
    const wav = silentWav(song?.duration ?? 30)
    const range = req.headers.range
    if (range) {
      const m = /bytes=(\d+)-(\d*)/.exec(range)
      const start = m ? Number(m[1]) : 0
      const end = m && m[2] ? Math.min(Number(m[2]), wav.length - 1) : wav.length - 1
      res.writeHead(206, {
        'Content-Type': 'audio/wav',
        'Content-Range': `bytes ${start}-${end}/${wav.length}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1,
      })
      res.end(wav.subarray(start, end + 1))
      return
    }
    res.writeHead(200, { 'Content-Type': 'audio/wav', 'Accept-Ranges': 'bytes', 'Content-Length': wav.length })
    res.end(wav)
    return
  }

  const handler = handlers[name]
  const body = handler
    ? handler(query)
    : { 'subsonic-response': { status: 'failed', version: API_VERSION, error: { code: 70, message: `mock 未实现的接口：${name}` } } }

  if (!handler) console.warn(`[mock-subsonic] 未实现：${name}`)

  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
})

server.listen(PORT, () => {
  console.log(`[mock-subsonic] http://localhost:${PORT}`)
  console.log(`[mock-subsonic] ${albums.length} 张专辑 / ${songs.length} 首 / ${artists.length} 位歌手，凭据不校验`)
})
