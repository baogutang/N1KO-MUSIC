/**
 * 安装源的取数（PLAN 1.4）：manifest 与插件代码。
 * 出网前先过 assertSafeInstallUrl（https 或同源、内网/回环拒绝、无 userinfo），
 * 与目录拉取（catalog.ts 的 fetchCatalog）共用同一道安装源防线；
 * 相对地址（manifest.entry）由调用方解析成绝对地址后传入。
 */

import { assertSafeInstallUrl } from './catalog'

/** 经安装源防线拉取并解析 manifest JSON */
export async function fetchInstallJson(url: string): Promise<unknown> {
  assertSafeInstallUrl(url)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`拉取 manifest 失败（${res.status}）`)
  return res.json()
}

/** 经安装源防线拉取插件代码文本 */
export async function fetchInstallText(url: string): Promise<string> {
  assertSafeInstallUrl(url)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`拉取插件代码失败（${res.status}）`)
  return res.text()
}
