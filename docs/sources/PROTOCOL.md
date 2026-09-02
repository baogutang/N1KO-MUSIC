# N1KO 音源插件协议 v1

> 本文是实现 `frontend/src/plugins/` 与 `plugins/` 的合同。实现与本文冲突时，先改本文再改代码，并在 `docs/sources/DECISIONS.md` 记一条。

## 1. 基本概念

- **音源（Source）**：一个能提供曲目、歌单、歌词、取流地址的来源。NAS 音乐服务器（Subsonic / Jellyfin / Emby）是内置音源；流媒体平台通过**插件**接入。
- **插件（Plugin）**：一个 CommonJS 风格的 JS 文件加一个 `manifest.json`。插件在 App 内的沙箱里运行，只能通过宿主发网络请求。
- **宿主（Host）**：App 里负责加载沙箱、转发请求、保管凭据、把插件返回的数据映射成 App 统一类型（`frontend/src/api/types.ts`）的那一层。
- **一个插件 = 一个 `ServerConfig`**：`type: 'plugin'`，`pluginId` 指向已安装的插件。同一个插件理论上可以登录两个账号，产生两个 `ServerConfig`。

协议刻意兼容 [MusicFree 插件协议](https://github.com/maotoumao/MusicFree/blob/master/src/core/pluginManager/plugin.ts) 的方法名与数据形状，目的是让社区已有插件不改或少改就能跑；N1KO 自己需要而 MusicFree 没有的能力统一放在 `n1ko` 命名空间下。

## 2. manifest.json

```json
{
  "id": "netease",
  "name": "网易云音乐",
  "version": "0.1.0",
  "protocol": 1,
  "minAppVersion": "1.11.0",
  "platform": "netease",
  "entry": "index.js",
  "auth": {
    "kind": "qr",
    "qrHint": "打开网易云音乐 App，扫描二维码并确认登录",
    "cookieHint": "从浏览器复制 music.163.com 的 Cookie 粘贴到这里",
    "allowAnonymous": true
  },
  "hosts": ["music.163.com", "interface.music.163.com", "*.music.126.net", "*.music.127.net"],
  "capabilities": [
    "search", "album", "artist", "lyrics",
    "userPlaylists", "favorites", "playlistWrite",
    "topLists", "recommendSheets", "importSheet"
  ],
  "qualities": ["low", "medium", "high", "lossless"],
  "userVariables": [
    { "key": "preferQuality", "label": "默认音质", "type": "select", "options": ["standard", "higher", "exhigh", "lossless"], "default": "exhigh" }
  ],
  "disclaimer": "本插件使用网易云音乐的非公开接口，可能违反其用户协议。只能播放你的账号有权收听的内容。",
  "homepage": "https://github.com/baogutang/N1KO-MUSIC/tree/main/plugins/netease"
}
```

字段说明：

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | 是 | 全局唯一，`^[a-z][a-z0-9-]{1,31}$`。安装后不可变。 |
| `protocol` | 是 | 本协议版本，当前为 `1`。App 只加载它认识的版本。 |
| `platform` | 是 | 与插件代码里导出的 `platform` 一致，写进每条数据的 `platform` 字段。 |
| `entry` | 是 | 相对 manifest 的插件代码路径。 |
| `auth.kind` | 是 | `qr` / `cookie` / `none`。决定登录页渲染什么。 |
| `auth.allowAnonymous` | 否 | 为 `true` 时允许不登录就添加音源（搜索、榜单、免费曲）。 |
| `hosts` | 是 | 宿主放行的域名白名单。支持 `*.` 前缀通配一级子域。不在名单内的请求一律拒绝并记录。另外：localhost / 127.0.0.1 / 私网段（10.、192.168.、172.16-31.）/ 链路本地（169.254.）及 `.local` `.internal` 后缀一律拒绝——即使写进了 `hosts` 也不放行（SSRF 防线，插件音源全部面向公网 API）。 |
| `capabilities` | 是 | 宿主据此隐藏入口（见 §6）。声明了但方法不存在，宿主按未声明处理并在控制台警告。 |
| `qualities` | 否 | 插件能提供的音质档位，映射见 §5.3。 |
| `userVariables` | 否 | 用户可配置项，与 MusicFree 的 `userVariables` 兼容，宿主在音源设置里渲染成表单。 |
| `disclaimer` | 是 | 添加音源时必须展示并让用户确认的文字。 |

## 3. 插件代码的形状

插件是一段 CommonJS 代码，由沙箱运行时用 `(function (module, exports, require, env, console) { ... })` 包起来执行。导出对象：

```js
module.exports = {
  platform: 'netease',
  version: '0.1.0',

  // ---- MusicFree 兼容方法（名字、参数、返回形状都按 MusicFree）----
  async search(query, page, type) {},              // type: 'music' | 'album' | 'artist' | 'sheet'
  async getMediaSource(musicItem, quality) {},      // quality: 'low' | 'standard' | 'high' | 'super'
  async getMusicInfo(musicItem) {},
  async getLyric(musicItem) {},                     // -> { rawLrc?: string, translation?: string }
  async getAlbumInfo(albumItem, page) {},
  async getMusicSheetInfo(sheetItem, page) {},
  async getArtistWorks(artistItem, page, type) {},  // type: 'music' | 'album'
  async importMusicSheet(urlLike) {},
  async importMusicItem(urlLike) {},
  async getTopLists() {},
  async getTopListDetail(topListItem, page) {},
  async getRecommendSheetTags() {},
  async getRecommendSheetsByTag(tag, page) {},

  // ---- N1KO 扩展 ----
  n1ko: {
    auth: {
      async createQr() {},            // -> { key, content, expiresIn }   content 是二维码里的文本
      async checkQr(key) {},          // -> { status: 'waiting'|'scanned'|'confirmed'|'expired', credentials? }
      async loginWithCookie(text) {}, // -> { credentials }
      async getUser() {},             // -> { id, name, avatar?, vip?: boolean } | null（null 表示凭据无效）
      async logout() {},
    },
    user: {
      async getPlaylists() {},                       // -> { created: SheetItem[], subscribed: SheetItem[] }
      async getFavorites(page) {},                   // -> { isEnd, data: MusicItem[] }
      async setFavorite(musicItem, liked) {},
      async createPlaylist(name) {},                 // -> SheetItem
      async addToPlaylist(sheetItem, musicItems) {},
      async removeFromPlaylist(sheetItem, musicItems) {},
    },
    async getMediaSource(musicItem, quality) {},     // 有则优先于顶层同名方法；-> { url, expiresAt?, headers?, mimeType? }
  },
}
```

约束：

- 所有方法都是异步的；宿主对每次调用设 30 秒超时。
- 找不到、无权限、需要会员，统一 `throw new PluginError(code, message)`，`code` 取自 §7。其他异常宿主按 `unknown` 处理。
- 插件不得依赖 DOM。沙箱里有 `DOMParser` 可用，但 `document` 不代表任何页面。
- 插件不得自己发网络请求。沙箱 CSP 会把 `fetch`、`XMLHttpRequest`、`WebSocket`、`<img>`、`<script src>` 全部拦掉；唯一的出口是 `require('axios')` 拿到的宿主转发客户端。

## 4. 沙箱运行时提供的东西

### 4.1 `require(name)`

| name | 提供什么 |
|---|---|
| `axios` | 与 axios 同形的客户端（`get/post/request`，支持 `params`、`headers`、`data`、`responseType: 'json'|'text'|'arraybuffer'`，返回 `{ status, headers, data }`）。底层走宿主 RPC。 |
| `crypto-js` | 完整的 crypto-js（AES / MD5 / SHA / enc 工具）。 |
| `dayjs`、`qs`、`he` | 原样提供。 |
| `big-integer` | 提供一个基于原生 `BigInt` 的兼容层，覆盖 `bigInt(str, base)`、`modPow`、`toString(base)`。 |
| `cheerio` | 不提供。需要解析 HTML 的插件用 `DOMParser`。`require('cheerio')` 抛错并说明。 |

### 4.2 `env`

```ts
interface PluginEnv {
  appVersion: string
  locale: 'zh-CN' | 'en-US'
  platform: 'ios' | 'android' | 'desktop' | 'web'
  userVariables: Record<string, string>
  /** 宿主替插件保管的不透明凭据串，插件自己决定格式（通常是 Cookie 或 JSON）*/
  credentials: string | null
  /** 凭据刷新后回写；宿主会加密落盘 */
  setCredentials(next: string | null): void
  /** 每个插件独立的键值存储，宿主落在 IndexedDB，用于缓存 guid、匿名 cookie 等非敏感数据 */
  storage: { get(key: string): Promise<string | null>; set(key: string, value: string): Promise<void> }
}
```

### 4.3 `console`

转发到宿主，按插件 id 打前缀，保留最近 200 条供音源设置里查看。

## 5. 数据形状

### 5.1 MusicFree 兼容项

```ts
interface MusicItem {
  platform: string
  id: string
  title: string
  artist: string
  artistId?: string
  album?: string
  albumId?: string
  artwork?: string       // 封面 URL
  duration?: number      // 秒
  isrc?: string          // 有就给，用于跨源同曲匹配
  qualities?: Partial<Record<'low'|'standard'|'high'|'super', { size?: number }>>
  vip?: boolean          // 当前账号无权播放时为 true，宿主据此标灰
  [k: string]: unknown   // 插件私有字段（例如 mid、fee），宿主原样保留并回传
}
interface AlbumItem  { platform: string; id: string; title: string; artist?: string; artistId?: string; artwork?: string; date?: string; description?: string }
interface ArtistItem { platform: string; id: string; name: string; avatar?: string; description?: string }
interface SheetItem  { platform: string; id: string; title: string; artwork?: string; description?: string; playCount?: number; worksNum?: number; createUser?: string; createUserId?: string }
interface Paged<T>   { isEnd: boolean; data: T[] }
interface TopListGroup { title: string; data: SheetItem[] }
```

`search` 返回 `Paged<MusicItem | AlbumItem | ArtistItem | SheetItem>`；`getAlbumInfo` / `getMusicSheetInfo` / `getTopListDetail` 返回 `{ isEnd, musicList: MusicItem[], albumItem?/sheetItem? }`（与 MusicFree 一致）。

### 5.2 宿主的映射规则

宿主把上述形状映射为 `frontend/src/api/types.ts` 里的 `Song / Album / Artist / Playlist`：

- `id` 原样使用，不加前缀。跨源唯一性靠 `serverId`，所有映射必须填 `serverId`。
- `coverArt` 直接放封面 URL；`PluginAdapter.getCoverUrl(id)` 识别到 URL 就原样返回。
- `duration` 缺失时填 `0`，宿主在播放拿到元数据后回填。
- 插件私有字段整体保存在宿主的「原始项缓存」里（`serverId + kind + id` → 原始对象，LRU 2000 条），调用需要整项的插件方法时回传。缓存未命中时按 `{ platform, id }` 最小项回传。
- `Artist.sortIndex` 由宿主按名称首字符（拼音首字母）生成。

### 5.3 音质映射

| App 设置 | MusicFree quality | 说明 |
|---|---|---|
| `low` | `low` | |
| `medium` | `standard` | |
| `high` | `high` | |
| `lossless` | `super` | 插件没有该档位时降到有的最高档 |

### 5.4 取流结果

```ts
interface MediaSource {
  url: string
  expiresAt?: number   // 毫秒时间戳。缺省按 20 分钟处理
  mimeType?: string
  headers?: Record<string, string>  // 协议保留字段。当前播放引擎无法附加请求头，宿主忽略并在控制台提示一次
}
```

## 6. capabilities 与 App 入口

| capability | 缺失时宿主怎么做 |
|---|---|
| `search` | 该音源不参与聚合搜索 |
| `album` / `artist` | 曲目行上的专辑、歌手不可点 |
| `lyrics` | 歌词面板显示「此音源不提供歌词」 |
| `userPlaylists` | 首页与歌单页不出现该音源的「我的歌单」 |
| `favorites` | 收藏心形不出现 |
| `playlistWrite` | 歌单页只读 |
| `topLists` / `recommendSheets` | 发现区块不出现 |
| `importSheet` | 「粘贴链接导入」不出现 |
| `libraryBrowse` | 流媒体音源一般不声明；未声明时该音源不出现在专辑、歌手、流派浏览页 |

## 7. 错误码

```ts
type PluginErrorCode =
  | 'unauthorized'   // 凭据缺失或失效：宿主标记音源「需要重新登录」并在顶部提示
  | 'forbidden'      // 有凭据但无权（会员曲、地区限制）：宿主把曲目标灰并给出原因
  | 'not-found'
  | 'rate-limited'   // 宿主退避 60 秒
  | 'network'        // 宿主原样提示，可重试
  | 'unsupported'    // 方法存在但该平台做不到
  | 'unknown'
```

沙箱运行时注入全局 `PluginError`：`new PluginError(code, message, detail?)`。

## 8. 宿主与沙箱的 RPC

沙箱是 `<iframe sandbox="allow-scripts">`，文档来自 `blob:` URL，内容固定为：

```html
<!doctype html>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; script-src {ORIGIN} blob:; connect-src 'none'; img-src 'none'; style-src 'none'; frame-src 'none'">
<script src="{ORIGIN}/plugin-sandbox.js"></script>
```

`{ORIGIN}` 是 `location.origin`（浏览器 `http://localhost:5173`、iOS `capacitor://localhost`、Android `https://localhost`、Tauri `tauri://localhost` 或 `http://tauri.localhost`）。插件代码由运行时以 `blob:` 脚本方式载入，不用 `eval`。沙箱文档与插件脚本两个 blob 的 MIME 都必须带 `charset=utf-8`（文档级 `<meta charset>` 同时保留）：opaque-origin 的 blob 文档不继承父页编码、会回落 windows-1252，无 charset 的经典脚本按文档编码解码——中文 literal 会全部变 mojibake。

消息一律 `postMessage(msg, '*')`（opaque origin 只能用 `*`），双方都校验 `event.source`。

宿主 → 沙箱：

```ts
{ type: 'init', pluginId, code, env }                       // 一次
{ type: 'call', id, method: 'search' | 'n1ko.auth.checkQr' | ..., args: unknown[] }
{ type: 'fetch:result', id, ok, status, headers, body, bodyEncoding: 'text' | 'base64' }
{ type: 'storage:result', id, value }
```

沙箱 → 宿主：

```ts
{ type: 'ready', methods: string[] }                        // 导出的方法路径，如 'search'、'n1ko.auth.createQr'
{ type: 'result', id, ok: true, value } | { type: 'result', id, ok: false, error: { code, message, detail } }
{ type: 'fetch', id, request: { url, method, headers, body?, bodyEncoding?, responseType, timeoutMs? } }
{ type: 'storage:get' | 'storage:set', id, key, value? }
{ type: 'credentials', value: string | null }
{ type: 'log', level, args: string[] }
```

宿主对 `fetch` 的处理：

1. 解析 URL，域名不在 manifest `hosts` 内直接回 `ok: false, error: { code: 'forbidden' }`，并写入该插件的请求日志。
2. 按运行环境选一条通道（见 PLAN.md §4.3）。
3. 响应头全部转回；`set-cookie` 有就给，原生通道拿不到时给空。
4. 二进制响应用 base64。

## 9. 版本与兼容

- `protocol` 升版只在破坏兼容时进行。宿主按 manifest 的 `protocol` 选择加载器。
- 插件通过 `sourceUrl` 更新：宿主重新拉取 manifest 与代码，比对 `version` 与代码哈希；`hosts` 有新增时重新弹一次确认。
- 卸载插件时删除它的代码、凭据、私有存储与请求日志。
