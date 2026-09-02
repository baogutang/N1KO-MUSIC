/**
 * 插件目录（PLAN §4.2 catalog.ts）：拉取与更新检查。
 *
 * 目录是一个 JSON 数组：[{ id, name, version, manifest, entry }]——
 * manifest / entry 是地址（相对目录地址解析）。开发态默认目录由 Vite 中间件
 * 从仓库 plugins/ 目录直接供给（/__n1ko_plugins/catalog.json）。
 */

import type { PluginManifest } from '../types'
import { isPrivateHost } from './whitelist'

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
  const res = await fetch(catalogUrl)
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
export function diffUpdates(
  installed: Array<{ id: string; version: string }>,
  catalog: CatalogFetchResult
): UpdateCandidate[] {
  const out: UpdateCandidate[] = []
  for (const entry of catalog.entries) {
    const local = installed.find(p => p.id === entry.id)
    if (!local) continue
    if (!entry.version || entry.version === local.version) continue
    out.push({
      id: entry.id,
      currentVersion: local.version,
      nextVersion: entry.version,
      manifestUrl: resolveManifestUrl(catalog.baseUrl, entry),
    })
  }
  return out
}

// ---------------- 安装源 URL 校验 ----------------

/**
 * 安装源（manifest / 代码地址）的统一防线：只认 https（开发态同源目录除外），
 * 拒绝私网/回环主机，拒绝带 userinfo 的地址。插件 API 流量另有 hosts 白名单
 * （hostFetch），这里是「从哪装」而不是「往哪请求」。
 */
export function assertSafeInstallUrl(rawUrl: string): void {
  let u: URL
  try {
    u = new URL(rawUrl, typeof location !== 'undefined' ? location.href : undefined)
  } catch {
    throw new Error(`安装地址无法解析：${rawUrl}`)
  }
  const sameOrigin = typeof location !== 'undefined' && u.origin === location.origin
  // 同源地址（开发态本地目录 /__n1ko_plugins）放行：dev server 本来就在 localhost
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

/** 安装前校验 manifest 形状；不合法直接抛错并给出人话原因 */
export function validateManifest(raw: unknown): PluginManifest {
  const m = raw as Record<string, unknown>
  const fail = (why: string): never => { throw new Error(`manifest 不合法：${why}`) }
  if (!m || typeof m !== 'object') fail('不是 JSON 对象')
  if (typeof m.id !== 'string' || !ID_PATTERN.test(m.id)) fail(`id 必须形如 ${ID_PATTERN}，得到 ${JSON.stringify(m.id)}`)
  if (m.protocol !== 1) fail(`protocol 只支持 1，得到 ${JSON.stringify(m.protocol)}`)
  if (typeof m.platform !== 'string' || !m.platform) fail('缺少 platform')
  if (typeof m.entry !== 'string' || !m.entry) fail('缺少 entry')
  if (!Array.isArray(m.hosts) || !m.hosts.length || !m.hosts.every(h => typeof h === 'string')) fail('hosts 必须是非空字符串数组')
  if (!Array.isArray(m.capabilities) || !m.capabilities.every(c => typeof c === 'string')) fail('capabilities 必须是字符串数组')
  if (!m.auth || typeof m.auth !== 'object' || !['qr', 'cookie', 'none'].includes(String((m.auth as Record<string, unknown>).kind))) fail('auth.kind 必须是 qr / cookie / none')
  if (typeof m.disclaimer !== 'string' || !m.disclaimer) fail('缺少 disclaimer')
  if (typeof m.name !== 'string' || !m.name) fail('缺少 name')
  if (typeof m.version !== 'string' || !m.version) fail('缺少 version')
  return raw as PluginManifest
}

/** SHA-256 十六进制（代码哈希：同一版本重复安装不重写，更新前后可对比） */
export async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')
}
