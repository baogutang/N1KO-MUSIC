/** Starts the actual backend against a disposable, empty database on loopback. */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { once } from 'node:events'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const scratch = mkdtempSync(path.join(tmpdir(), 'n1ko-registration-review-'))
process.env.DATA_DIR = scratch
process.env.NODE_ENV = 'test'
process.env.ALLOW_REGISTRATION = 'first-user'
process.env.BCRYPT_ROUNDS = '10'
const require = createRequire(path.join(repo, 'backend/package.json'))
const app = require(path.join(repo, 'backend/dist/app.js')).default
const db = require(path.join(repo, 'backend/dist/db/database.js')).default
const server = app.listen(0, '127.0.0.1')
await once(server, 'listening')
try {
  const url = `http://127.0.0.1:${server.address().port}/api/auth/register`
  const results = await Promise.all(['audit_fixture_a', 'audit_fixture_b'].map(username => fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'Fixture-password-only-9!' }),
  })))
  const statuses = results.map(res => res.status)
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM users').get()
  console.log('first-user concurrent registration statuses:', statuses, '; stored account count:', count)
  assert.deepEqual(statuses, [201, 201])
  assert.equal(count, 2)
  console.log('REPRODUCED: first-user default admits two concurrent distinct accounts.')
} finally {
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
  db.close()
  rmSync(scratch, { recursive: true, force: true })
}
