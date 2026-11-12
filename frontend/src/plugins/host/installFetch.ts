/**
 * 安装源的取数（PLAN 1.4）：manifest 与插件代码。
 * 出网前先过 assertSafeInstallUrl（https 或同源、内网/回环拒绝、无 userinfo），
 * 与目录拉取（catalog.ts 的 fetchCatalog）共用同一道安装源防线；
 * 相对地址（manifest.entry）由调用方解析成绝对地址后传入。
 */

import { assertSafeInstallUrl } from './catalog'

/**
 * 安装取数一律 `cache: 'no-cache'`：用 HTTP 缓存之前先向服务器复验。
 *
 * 静态部署常给 `.js` / `.json` 设长缓存，而目录里没有代码哈希可比——命中旧缓存时
 * 拿到的是上一版的代码，却会按新版本号装进去：设置页写着新版本，跑的是旧代码，
 * 新版修的问题一个都没生效。安装是低频操作，多一次条件请求不值一提。
 */
const INSTALL_FETCH_INIT: RequestInit = { cache: 'no-cache' }

/** 经安装源防线拉取并解析 manifest JSON */
export async function fetchInstallJson(url: string): Promise<unknown> {
  assertSafeInstallUrl(url)
  const res = await fetch(url, INSTALL_FETCH_INIT)
  if (!res.ok) throw new Error(`拉取 manifest 失败（${res.status}）`)
  return res.json()
}

/** 经安装源防线拉取插件代码文本 */
export async function fetchInstallText(url: string): Promise<string> {
  assertSafeInstallUrl(url)
  const res = await fetch(url, INSTALL_FETCH_INIT)
  if (!res.ok) throw new Error(`拉取插件代码失败（${res.status}）`)
  return res.text()
}
