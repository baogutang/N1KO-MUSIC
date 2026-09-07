/** Isolated audit runner. Passing assertions reproduce the audited defects. */
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '../../../..')
const frontend = path.join(repo, 'frontend')
const scratch = realpathSync(mkdtempSync(path.join(tmpdir(), 'n1ko-review-')))
try {
  for (const name of ['behavior.test.ts', 'plugin-lifecycle.test.ts']) {
    copyFileSync(path.join(here, name), path.join(scratch, name))
  }
  symlinkSync(path.join(frontend, 'node_modules'), path.join(scratch, 'node_modules'), 'dir')
  const config = {
    root: frontend,
    resolve: { alias: { '@': path.join(frontend, 'src') } },
    server: { fs: { strict: false, allow: [scratch, frontend] } },
    test: {
      environment: 'happy-dom',
      include: [path.join(scratch, '*.test.ts')],
      fileParallelism: false,
      testTimeout: 10000,
    },
  }
  const configPath = path.join(scratch, 'vitest.config.mjs')
  writeFileSync(configPath, `export default ${JSON.stringify(config, null, 2)}\n`)
  execFileSync(process.execPath, [path.join(frontend, 'node_modules/vitest/vitest.mjs'), 'run', '--config', configPath], {
    cwd: frontend, stdio: 'inherit',
  })
  execFileSync(process.execPath, [path.join(here, 'plugin-data-probes.mjs')], { cwd: repo, stdio: 'inherit' })
  execFileSync('npm', ['run', 'build'], { cwd: path.join(repo, 'backend'), stdio: 'inherit' })
  execFileSync(process.execPath, [path.join(here, 'backend-registration-probe.mjs')], { cwd: repo, stdio: 'inherit' })
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
