/**
 * 插件目录（PLAN §4.2 catalog.ts）：拉取与更新检查。
 *
 * 目录是一个 JSON 数组：[{ id, name, version, manifest, entry }]——
 * manifest / entry 是地址（相对目录地址解析）。开发态默认目录由 Vite 中间件
 * 从仓库 plugins/ 目录直接供给（/__n1ko_plugins/catalog.json）。
 */

import type { PluginManifest } from '../types'
import { isPrivateHost, isWildcardBaseTooBroad } from './whitelist'

export interface CatalogEntry {
  id: string
  name: string
  version: string
  /** manifest 地址（相对目录地址） */
  manifest: string
  /** 可选：代码直连地址；缺省按 manifest 里的 entry 相对解析 */
  entry?: string
  description?: string
}

export interface CatalogFetchResult {
  /** 目录基址（解析相对地址用） */
  baseUrl: string
  entries: CatalogEntry[]
}

/** 拉取并解析目录 */
export async function fetchCatalog(catalogUrl: string): Promise<CatalogFetchResult> {
  assertSafeInstallUrl(catalogUrl)
  /* 每次都向服务器复验（no-cache 不是不缓存，是用缓存前先问一声）：静态部署
     常给整站设长缓存，命中旧目录就看不到新版本，「检查更新」一直说已是最新 */
  const res = await fetch(catalogUrl, { cache: 'no-cache' })
  if (!res.ok) throw new Error(`拉取插件目录失败（${res.status}）`)
  const raw: unknown = await res.json()
  if (!Array.isArray(raw)) throw new Error('插件目录格式不对：应为 JSON 数组')
  const entries = raw.map((item): CatalogEntry => {
    const e = item as Record<string, unknown>
    if (typeof e.id !== 'string' || typeof e.manifest !== 'string') {
      throw new Error('插件目录条目缺少 id / manifest')
    }
    return {
      id: e.id,
      name: String(e.name ?? e.id),
      version: String(e.version ?? ''),
      manifest: e.manifest,
      ...(typeof e.entry === 'string' ? { entry: e.entry } : {}),
      ...(typeof e.description === 'string' ? { description: e.description } : {}),
    }
  })
  return { baseUrl: new URL(catalogUrl, location.href).href, entries }
}

/** 目录里每个条目的 manifest 地址（相对 → 绝对） */
export function resolveManifestUrl(baseUrl: string, entry: CatalogEntry): string {
  return new URL(entry.manifest, baseUrl).href
}

/** 更新检查结果：目录里有更新版本的条目 */
export interface UpdateCandidate {
  id: string
  currentVersion: string
  nextVersion: string
  manifestUrl: string
}

/**
 * 对比已安装插件与目录：版本不同即视为有更新（目录版本可回退）。
 * hosts 有新增的更新在安装确认时另行提示（PROTOCOL §9），这里只看版本。
 */

// ---------------- 安装源 URL 校验 ----------------

/**
 * 安装源（manifest / 代码地址）的统一防线：只认 https（开发态同源目录除外），
 * 拒绝私网/回环主机，拒绝带 userinfo 的地址。插件 API 流量另有 hosts 白名单
 * （hostFetch），这里是「从哪装」而不是「往哪请求」。
 */
function safeParse(href: string | undefined): URL | null {
  if (!href) return null
  try {
    return new URL(href)
  } catch {
    return null
  }
}

export function assertSafeInstallUrl(rawUrl: string): void {
  let u: URL
  try {
    u = new URL(rawUrl, typeof location !== 'undefined' ? location.href : undefined)
  } catch {
    throw new Error(`安装地址无法解析：${rawUrl}`)
  }
  /* 同源地址放行：开发态的 /__n1ko_plugins 与正式版随包的 /plugins 都是同源。
     不能比 origin——Tauri（tauri://localhost）与 Capacitor iOS（capacitor://localhost）
     是自定义 scheme，URL 规范下它们的 origin 序列化成 "null"，两边一比全相等，
     连 data: 都会被当成同源；按 protocol + host 逐项比才是「同一个壳」。 */
  const here = safeParse(typeof location !== 'undefined' ? location.href : undefined)
  const sameOrigin = !!here && u.host !== '' && u.protocol === here.protocol && u.host === here.host
  if (sameOrigin) return
  if (u.protocol !== 'https:') {
    throw new Error('插件安装地址只支持 https')
  }
  if (u.username || u.password) {
    throw new Error('插件安装地址不能带用户名密码')
  }
  if (isPrivateHost(u.hostname)) {
    throw new Error('插件安装地址不能是内网/回环主机')
  }
}

// ---------------- manifest 校验（安装的第一道门） ----------------

const ID_PATTERN = /^[a-z][a-z0-9-]{1,31}$/

/**
 * 协议认识的 capability（PROTOCOL §6，与 PluginAdapter.methodExistsForCapability 一一对应）。
 *
 * 不认识的名字必须当场报错而不是静默忽略：写成 MusicFree 的 `lyric`、
 * `importMusicSheet` 时宿主只会当「没声明」，歌词面板、导入入口直接消失，
 * 而插件作者看到的是安装成功、毫无提示——出厂的两个插件就这么错了一版。
 */
const KNOWN_CAPABILITIES = new Set([
  'search', 'album', 'artist', 'lyrics',
  'userPlaylists', 'favorites', 'playlistWrite',
  'topLists', 'recommendSheets', 'recommendSongs',
  'importSheet', 'libraryBrowse', 'radio',
])

/**
 * hosts 的单个条目只能是主机名：可选的 `*.` 前缀 + 字母数字 / 连字符 / 下划线
 * 组成的点分标签（允许一个结尾的点）。协议、路径、端口、userinfo、空白、
 * 中间位置的 `*` 全都落在这个字符集外面。
 *
 * 为什么要卡这么死：isHostAllowed 只比 hostname，`https://a.com/x`、`a.com:8443`
 * 这种条目永远匹配不上任何请求——插件作者看到的是「装上了、什么都连不上」；
 * 而 ` a.com`、`a.com ` 这类带空白的条目在不同的地方 trim 与不 trim，
 * 判定就可能两边不一致。安装时直接说清楚比运行时静默不匹配好。
 */
const HOST_ENTRY_PATTERN = /^(\*\.)?[a-z0-9_-]+(\.[a-z0-9_-]+)*\.?$/i

/** hosts 条目的问题（人话）；合法返回 null */
function hostEntryProblem(entry: string): string | null {
  if (entry.trim() === '*') return '通配范围过宽：不能放行所有域名'
  if (!HOST_ENTRY_PATTERN.test(entry)) return '只能写域名（可带 *. 前缀），不能带协议、路径、端口或空白'
  if (entry.startsWith('*.') && isWildcardBaseTooBroad(entry.slice(2))) {
    return '通配范围过宽：*. 后面必须是具体的站点域名，不能是 com、cn、com.cn 这类公共后缀'
  }
  return null
}

export interface ValidateManifestOptions {
  /**
   * 容忍协议不认识的 capability 名（只用于读盘复验，见 validateStoredManifest）。
   * 安装时必须报错：静默忽略的话插件作者看到的是「装上了、入口全没了」。
   */
  allowUnknownCapabilities?: boolean
}

/** 安装前校验 manifest 形状；不合法直接抛错并给出人话原因 */
export function validateManifest(raw: unknown, options: ValidateManifestOptions = {}): PluginManifest {
  const m = raw as Record<string, unknown>
  const fail = (why: string): never => { throw new Error(`manifest 不合法：${why}`) }
  if (!m || typeof m !== 'object') fail('不是 JSON 对象')
  if (typeof m.id !== 'string' || !ID_PATTERN.test(m.id)) fail(`id 必须形如 ${ID_PATTERN}，得到 ${JSON.stringify(m.id)}`)
  if (m.protocol !== 1) fail(`protocol 只支持 1，得到 ${JSON.stringify(m.protocol)}`)
  if (typeof m.platform !== 'string' || !m.platform) fail('缺少 platform')
  if (typeof m.entry !== 'string' || !m.entry) fail('缺少 entry')
  if (!Array.isArray(m.hosts) || !m.hosts.length || !m.hosts.every(h => typeof h === 'string')) fail('hosts 必须是非空字符串数组')
  for (const host of m.hosts as string[]) {
    const why = hostEntryProblem(host)
    if (why) fail(`hosts 条目 ${JSON.stringify(host)} 不合法：${why}`)
  }
  if (!Array.isArray(m.capabilities) || !m.capabilities.every(c => typeof c === 'string')) fail('capabilities 必须是字符串数组')
  const unknownCaps = (m.capabilities as string[]).filter(c => !KNOWN_CAPABILITIES.has(c))
  if (unknownCaps.length && !options.allowUnknownCapabilities) {
    fail(`capabilities 里有协议不认识的名字：${unknownCaps.join('、')}（可用：${[...KNOWN_CAPABILITIES].join('、')}）`)
  }
  if (!m.auth || typeof m.auth !== 'object' || !['qr', 'cookie', 'none'].includes(String((m.auth as Record<string, unknown>).kind))) fail('auth.kind 必须是 qr / cookie / none')
  if (typeof m.disclaimer !== 'string' || !m.disclaimer) fail('缺少 disclaimer')
  if (typeof m.name !== 'string' || !m.name) fail('缺少 name')
  if (typeof m.version !== 'string' || !m.version) fail('缺少 version')
  if (m.color !== undefined && !/^#[0-9a-fA-F]{6}$/.test(String(m.color))) fail('color 必须是 #RRGGBB')
  return raw as PluginManifest
}

/**
 * IndexedDB 里读回来的 manifest 的复验：装载沙箱 / 进登录页之前用。
 *
 * 盘上的记录不是「装的时候校验过」就一劳永逸的：旧版本写下的、写到一半损坏的、
 * 被手动改过的都可能在里面，而它的 hosts 直接就是宿主代发请求的白名单。
 * 规则与安装时相同（hosts 的新规则同样生效），只有一处放宽：不认识的
 * capability 名不报错——v1.11 之前出厂的网易云 / QQ（0.1.0–0.1.7 / 0.1.0–0.1.6）
 * 写的是 MusicFree 的 lyric / musicUrl / importMusicSheet，装的时候还没有这道检查；
 * 宿主本来就按「没声明」处理不认识的名字，为这个把老用户的音源整个停掉不值。
 */
export function validateStoredManifest(raw: unknown): PluginManifest {
  return validateManifest(raw, { allowUnknownCapabilities: true })
}

/**
 * 读盘复验的统一出口：不合格时抛一条说得清的错（哪个插件、为什么、该怎么办），
 * 由调用方按「连接失败 / 进不了登录」处理，不会把音源列表或应用拖垮。
 */
export function loadableManifest(pluginId: string, raw: unknown): PluginManifest {
  try {
    return validateStoredManifest(raw)
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err)
    throw new Error(`插件 ${pluginId} 的安装记录不合法，已停止装载；请卸载后重新安装（${why}）`)
  }
}

/** SHA-256 十六进制（代码哈希：同一版本重复安装不重写，更新前后可对比） */
export async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')
}
