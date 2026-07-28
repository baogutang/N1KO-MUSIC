/**
 * 带例外清单的依赖审计。
 *
 * 直接把 `npm audit` 当硬门禁有个结构性问题：它只看版本区间，不看漏洞代码路径
 * 在本项目里是否可达。前端依赖的框架往往同时发布 SSR/RSC 代码，于是纯 SPA 会
 * 持续收到不适用的告警 —— 甚至出现「没有任何已发布版本能同时避开所有公告」的
 * 死锁，此时硬门禁不再是门禁，只是一个永远红的构建，最终training 出忽略 CI 的习惯。
 *
 * 因此这里保留门禁本身：任何**未登记**的公告一律让 CI 失败；只有写明理由与
 * 解除条件的公告才放行。
 *
 * 用法：node scripts/audit-allowlist.mjs <workspace-dir>
 */

import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * 已评估并接受的公告。
 * 每条都必须写清楚「为什么本项目不受影响」和「什么时候可以删掉这条」。
 */
const ALLOWLIST = [
  {
    id: 'GHSA-qwww-vcr4-c8h2',
    // 例外按工作区限定：否则在不含该依赖的工作区里会被误报为「陈旧例外」
    workspace: 'frontend',
    package: 'react-router',
    reason:
      'RSC Mode CSRF：仅影响 React Server Components 模式下的 server action。' +
      '本项目是纯客户端 SPA（BrowserRouter），不含 RSC、不含 server action，该代码路径不存在。',
    // 公告影响 >=7.12.0 <8.3.0，而 8.x 尚未发布（最新为 7.18.1）；
    // 降到 7.12.0 以下又会落回 GHSA-wrjc-x8rr-h8h6 的 useNavigate 开放重定向 ——
    // 那条对本项目反而有实际面（会把服务器返回的 id 拼进路径）。
    // 也就是说当前不存在能同时避开两者的已发布版本。
    removeWhen: 'react-router 发布 >= 8.3.0 后升级并删除本条',
  },
]

const workspace = process.argv[2]
if (!workspace) {
  console.error('用法：node scripts/audit-allowlist.mjs <workspace-dir>')
  process.exit(2)
}

/** npm audit 发现漏洞时以非 0 退出，因此必须容错地取回 stdout */
function runAudit(cwd) {
  try {
    return execFileSync('npm', ['audit', '--json', '--omit=dev'], {
      cwd,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    })
  } catch (error) {
    if (typeof error.stdout === 'string' && error.stdout.trim()) return error.stdout
    throw error
  }
}

/** 从 audit 报告里抽出去重后的公告列表 */
function collectAdvisories(report) {
  const advisories = new Map()
  for (const vulnerability of Object.values(report.vulnerabilities ?? {})) {
    for (const via of vulnerability.via ?? []) {
      // via 既可能是字符串（传递依赖名），也可能是公告对象
      if (typeof via !== 'object' || !via.url) continue
      const id = via.url.split('/').filter(Boolean).pop()
      if (!id || advisories.has(id)) continue
      advisories.set(id, {
        id,
        package: via.name ?? vulnerability.name,
        severity: via.severity ?? vulnerability.severity,
        title: via.title ?? '(无标题)',
        range: via.range ?? '(未知范围)',
        url: via.url,
      })
    }
  }
  return advisories
}

const cwd = path.resolve(root, workspace)
const report = JSON.parse(runAudit(cwd))
const advisories = collectAdvisories(report)
const allowed = new Map(
  ALLOWLIST.filter(entry => entry.workspace === workspace).map(entry => [entry.id, entry])
)

const unexpected = [...advisories.values()].filter(advisory => !allowed.has(advisory.id))
const stale = [...allowed.keys()].filter(id => !advisories.has(id))

for (const advisory of advisories.values()) {
  if (allowed.has(advisory.id)) {
    console.log(`· 已登记例外 ${advisory.id}（${advisory.package}，${advisory.severity}）`)
  }
}

// 陈旧例外只告警不失败：上游修好属于好消息，不该把构建搞红
for (const id of stale) {
  console.warn(`⚠ 例外 ${id} 已不再出现在审计结果中，请从 ALLOWLIST 中删除`)
}

if (unexpected.length > 0) {
  console.error(`\n✗ ${workspace} 存在 ${unexpected.length} 条未登记的安全公告：\n`)
  for (const advisory of unexpected) {
    console.error(`  ${advisory.severity.toUpperCase()}  ${advisory.package}  ${advisory.range}`)
    console.error(`    ${advisory.title}`)
    console.error(`    ${advisory.url}\n`)
  }
  console.error('请升级依赖，或在 scripts/audit-allowlist.mjs 中登记例外并写明理由。')
  process.exit(1)
}

console.log(`✓ ${workspace} 无未登记的安全公告`)
