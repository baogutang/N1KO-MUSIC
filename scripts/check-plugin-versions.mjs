/**
 * 插件版本核对（阶段 5 / F18）：plugins/<id>/index.js 变了，manifest.version
 * 必须变（自动更新只比版本串），catalog.json 的版本也必须同步。
 *
 * 用法：node scripts/check-plugin-versions.mjs [base]    # base 缺省 HEAD~1
 * 比较 base..HEAD 之间 plugins/ 与 catalog 的改动。
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const base = process.argv[2] ?? 'HEAD~1'

function changedFiles() {
  const out = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], {
    encoding: 'utf8',
    // 本地手跑时 base...HEAD 可能没差异（改动未提交），退回直接 diff base
  }).trim()
  if (out) return out.split('\n')
  return execFileSync('git', ['diff', '--name-only', base], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter(Boolean)
}

let files
try {
  files = changedFiles()
} catch (err) {
  console.error(`无法获取 git diff（base=${base}）：${err.message}`)
  process.exit(1)
}

const pluginCodeChanged = new Set()
const manifestChanged = new Set()
let catalogChanged = false

for (const file of files) {
  const m = /^plugins\/([^/]+)\/index\.js$/.exec(file)
  if (m) pluginCodeChanged.add(m[1])
  const mm = /^plugins\/([^/]+)\/manifest\.json$/.exec(file)
  if (mm) manifestChanged.add(mm[1])
  if (file === 'plugins/catalog.json') catalogChanged = true
}

const problems = []
for (const id of pluginCodeChanged) {
  if (!manifestChanged.has(id)) {
    problems.push(`plugins/${id}/index.js 变了但 manifest.json 没动：自动更新只比版本串，必须升 patch 版本`)
  }
}

/* catalog 的版本要和各 manifest 一致（无论谁改的） */
const catalog = JSON.parse(readFileSync('plugins/catalog.json', 'utf8'))
for (const entry of catalog) {
  const manifest = JSON.parse(readFileSync(path.join('plugins', entry.id, 'manifest.json'), 'utf8'))
  if (entry.version !== manifest.version) {
    problems.push(`plugins/catalog.json 里 ${entry.id} 是 ${entry.version}，manifest 是 ${manifest.version}：两边必须同步`)
  }
}

if (pluginCodeChanged.size && !catalogChanged) {
  const ids = [...pluginCodeChanged].filter(id => !manifestChanged.has(id))
  if (ids.length) problems.push(`插件代码变了但 plugins/catalog.json 没动：${ids.join(', ')}`)
}

if (problems.length) {
  console.error('✖ 插件版本核对未通过：')
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}
console.log(`插件版本核对通过（比较 ${base}..HEAD，代码变更 ${pluginCodeChanged.size} 个插件）`)
