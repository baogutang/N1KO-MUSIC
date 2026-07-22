import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const readJson = relative => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'))
const rootVersion = readJson('package.json').version
const frontendVersion = readJson('frontend/package.json').version
const tauriConfigVersion = readJson('frontend/src-tauri/tauri.conf.json').version
const cargoToml = fs.readFileSync(path.join(root, 'frontend/src-tauri/Cargo.toml'), 'utf8')
const cargoLock = fs.readFileSync(path.join(root, 'frontend/src-tauri/Cargo.lock'), 'utf8')
const cargoVersion = cargoToml.match(/^version\s*=\s*"([^"]+)"/m)?.[1]
const lockVersion = cargoLock.match(/\[\[package\]\]\s+name = "app"\s+version = "([^"]+)"/m)?.[1]

const versions = { rootVersion, frontendVersion, tauriConfigVersion, cargoVersion, lockVersion }
const mismatches = Object.entries(versions).filter(([, version]) => version !== rootVersion)
if (mismatches.length > 0) {
  console.error('Application versions are not synchronized:', versions)
  process.exit(1)
}
console.log(`Application versions are synchronized at ${rootVersion}`)
