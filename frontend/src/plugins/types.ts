/**
 * 音源插件协议 v1 的类型合同（docs/sources/PROTOCOL.md）。
 *
 * 这份文件同时被宿主（PluginHost / PluginAdapter / pluginStore）与沙箱运行时
 * 引用：宿主与沙箱是两个构建产物，靠这里的消息形状对齐。
 * 实现与协议冲突时，先改 PROTOCOL.md 再改这里，并在 DECISIONS.md 记一条。
 */

// ===================================================
// 错误码
// ===================================================

export type PluginErrorCode =
  | 'unauthorized' // 凭据缺失或失效：宿主标记音源「需要重新登录」并在顶部提示
  | 'forbidden'    // 有凭据但无权（会员曲、地区限制）：宿主把曲目标灰并给出原因
  | 'not-found'
  | 'rate-limited' // 宿主退避 60 秒
  | 'network'      // 宿主原样提示，可重试
  | 'unsupported'  // 方法存在但该平台做不到
  | 'unknown'

export interface SerializedPluginError {
  code: PluginErrorCode
  message: string
  detail?: unknown
}

// ===================================================
// manifest.json
// ===================================================

export interface PluginAuth {
  /** 登录方式，决定登录页渲染什么 */
  kind: 'qr' | 'cookie' | 'none'
  qrHint?: string
  cookieHint?: string
  /** 为 true 时允许不登录就添加音源（搜索、榜单、免费曲） */
  allowAnonymous?: boolean
}

export interface PluginUserVariable {
  key: string
  label: string
  type: 'string' | 'select' | 'boolean'
  options?: string[]
  default?: string
}

export interface PluginManifest {
  /** 全局唯一，^[a-z][a-z0-9-]{1,31}$，安装后不可变 */
  id: string
  name: string
  version: string
  /** 本协议版本，当前为 1 */
  protocol: number
  minAppVersion?: string
  /** 与插件代码导出的 platform 一致 */
  platform: string
  /** 相对 manifest 的插件代码路径 */
  entry: string
  auth: PluginAuth
  /** 宿主放行的域名白名单，支持 `*.` 前缀通配一级子域 */
  hosts: string[]
  /** 宿主据此隐藏入口；声明了但方法不存在按未声明处理并警告 */
  capabilities: string[]
  qualities?: Array<'low' | 'medium' | 'high' | 'lossless'>
  userVariables?: PluginUserVariable[]
  /** 添加音源时必须展示并让用户确认的文字 */
  disclaimer: string
  /** 徽标底色（#RRGGBB），缺省按 id 哈希取宿主 token 色板（PLAN 2.1） */
  color?: string
  homepage?: string
  /** 目录安装时的来源地址，更新检查用 */
  sourceUrl?: string
}

// ===================================================
// 沙箱 env（PROTOCOL §4.2）
// ===================================================

export type PluginPlatform = 'ios' | 'android' | 'desktop' | 'web'

/** init 消息携带的环境数据；setCredentials 与 storage 由运行时补上 */
export interface PluginEnvData {
  appVersion: string
  locale: 'zh-CN' | 'en-US'
  platform: PluginPlatform
  userVariables: Record<string, string>
  /** 宿主替插件保管的不透明凭据串 */
  credentials: string | null
}

// ===================================================
// RPC 消息（PROTOCOL §8）
// ===================================================

export interface HostFetchRequest {
  url: string
  method: string
  headers?: Record<string, string>
  body?: string
  bodyEncoding?: 'text' | 'base64'
  responseType: 'json' | 'text' | 'arraybuffer'
  timeoutMs?: number
}

export interface HostFetchSuccess {
  ok: true
  status: number
  headers: Record<string, string>
  body: string
  bodyEncoding: 'text' | 'base64'
}

export interface HostFetchFailure {
  ok: false
  error: SerializedPluginError
}

export type HostFetchResult = HostFetchSuccess | HostFetchFailure

/** 宿主 → 沙箱 */
export type HostToSandboxMessage =
  | { type: 'init'; pluginId: string; code: string; env: PluginEnvData }
  | { type: 'call'; id: number; method: string; args: unknown[] }
  | ({ type: 'fetch:result'; id: number } & HostFetchResult)
  | { type: 'storage:result'; id: number; value: string | null }

/** 沙箱 → 宿主 */
export type SandboxToHostMessage =
  | { type: 'ready'; methods: string[] }
  | { type: 'result'; id: number; ok: true; value: unknown }
  | { type: 'result'; id: number; ok: false; error: SerializedPluginError }
  | { type: 'fetch'; id: number; request: HostFetchRequest }
  | { type: 'storage:get'; id: number; key: string }
  | { type: 'storage:set'; id: number; key: string; value: string }
  | { type: 'credentials'; value: string | null }
  | { type: 'log'; level: 'log' | 'info' | 'warn' | 'error'; args: string[] }

// ===================================================
// MusicFree 兼容数据形状（PROTOCOL §5.1）
// ===================================================

export interface MusicItem {
  platform: string
  id: string
  title: string
  artist: string
  artistId?: string
  album?: string
  albumId?: string
  artwork?: string
  /** 秒 */
  duration?: number
  /** 有就给，用于跨源同曲匹配 */
  isrc?: string
  qualities?: Partial<Record<'low' | 'standard' | 'high' | 'super', { size?: number }>>
  /** 当前账号无权播放时为 true，宿主据此标灰 */
  vip?: boolean
  /** 插件私有字段（mid、fee 等），宿主原样保留并回传 */
  [k: string]: unknown
}

export interface AlbumItem {
  platform: string
  id: string
  title: string
  artist?: string
  artistId?: string
  artwork?: string
  date?: string
  description?: string
  [k: string]: unknown
}

export interface ArtistItem {
  platform: string
  id: string
  name: string
  avatar?: string
  description?: string
  [k: string]: unknown
}

export interface SheetItem {
  platform: string
  id: string
  title: string
  artwork?: string
  description?: string
  playCount?: number
  worksNum?: number
  createUser?: string
  createUserId?: string
  [k: string]: unknown
}

export interface Paged<T> {
  isEnd: boolean
  data: T[]
}

export interface TopListGroup {
  title: string
  data: SheetItem[]
}

/** getAlbumInfo / getMusicSheetInfo / getTopListDetail 的返回（与 MusicFree 一致） */
export interface MediaDetailResult<TItem> {
  isEnd: boolean
  musicList: MusicItem[]
  item?: TItem
}

// ===================================================
// 插件导出对象（PROTOCOL §3）
// ===================================================

export interface PluginQrCheckResult {
  status: 'waiting' | 'scanned' | 'confirmed' | 'expired'
  credentials?: string
}

export interface PluginUser {
  id: string
  name: string
  avatar?: string
  vip?: boolean
}

export interface PluginMediaSource {
  url: string
  expiresAt?: number
  mimeType?: string
  /** 协议保留字段；当前播放引擎无法附加请求头，宿主忽略 */
  headers?: Record<string, string>
}

/** MusicFree 兼容方法 + n1ko 扩展；宿主按方法路径调用 */
export interface PluginExports {
  platform: string
  version: string
  search?(query: string, page: number, type: 'music' | 'album' | 'artist' | 'sheet'): Promise<Paged<MusicItem | AlbumItem | ArtistItem | SheetItem>>
  getMediaSource?(musicItem: MusicItem, quality: 'low' | 'standard' | 'high' | 'super'): Promise<PluginMediaSource>
  getMusicInfo?(musicItem: MusicItem): Promise<Partial<MusicItem>>
  getLyric?(musicItem: MusicItem): Promise<{ rawLrc?: string; translation?: string }>
  getAlbumInfo?(albumItem: AlbumItem, page: number): Promise<MediaDetailResult<AlbumItem>>
  getMusicSheetInfo?(sheetItem: SheetItem, page: number): Promise<MediaDetailResult<SheetItem>>
  getArtistWorks?(artistItem: ArtistItem, page: number, type: 'music' | 'album'): Promise<Paged<MusicItem | AlbumItem>>
  importMusicSheet?(urlLike: string): Promise<MusicItem[]>
  importMusicItem?(urlLike: string): Promise<MusicItem>
  getTopLists?(): Promise<TopListGroup[]>
  getTopListDetail?(topListItem: SheetItem, page: number): Promise<MediaDetailResult<SheetItem>>
  getRecommendSheetTags?(): Promise<Array<{ title?: string; data?: SheetItem[] }>>
  getRecommendSheetsByTag?(tag: string | SheetItem, page: number): Promise<Paged<SheetItem>>
  n1ko?: {
    auth?: {
      createQr?(): Promise<{ key: string; content: string; expiresIn: number }>
      checkQr?(key: string): Promise<PluginQrCheckResult>
      loginWithCookie?(text: string): Promise<{ credentials: string }>
      getUser?(): Promise<PluginUser | null>
      logout?(): Promise<void>
    }
    user?: {
      getPlaylists?(): Promise<{ created: SheetItem[]; subscribed: SheetItem[] }>
      getFavorites?(page: number): Promise<Paged<MusicItem>>
      setFavorite?(musicItem: MusicItem, liked: boolean): Promise<void>
      createPlaylist?(name: string): Promise<SheetItem>
      addToPlaylist?(sheetItem: SheetItem, musicItems: MusicItem[]): Promise<void>
      removeFromPlaylist?(sheetItem: SheetItem, musicItems: MusicItem[]): Promise<void>
    }
    getMediaSource?(musicItem: MusicItem, quality: 'low' | 'standard' | 'high' | 'super'): Promise<PluginMediaSource>
  }
}
