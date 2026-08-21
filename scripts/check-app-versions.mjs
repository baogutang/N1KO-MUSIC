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

/**
 * 原生工程的版本号。
 *
 * 之前这个脚本只比对 package.json / tauri.conf.json / Cargo，于是 1.8.0 那次
 * 发版把 Android 的 versionName 和 iOS 的 MARKETING_VERSION 落在了 1.7.0——
 * CI 全绿，装出来的 App 在「关于」里显示的却是上一版。检查漏掉的地方，
 * 正是会悄悄发错版本的地方。
 */
const gradle = fs.readFileSync(path.join(root, 'frontend/android/app/build.gradle'), 'utf8')
const androidVersion = gradle.match(/versionName\s+"([^"]+)"/)?.[1]
const pbxproj = fs.readFileSync(
  path.join(root, 'frontend/ios/App/App.xcodeproj/project.pbxproj'), 'utf8')
const iosVersions = [...pbxproj.matchAll(/MARKETING_VERSION = ([^;]+);/g)].map(m => m[1].trim())
const iosVersion = iosVersions.length && iosVersions.every(v => v === iosVersions[0])
  ? iosVersions[0]
  : `inconsistent:${iosVersions.join('/')}`

/**
 * Android 的 versionCode 必须单调递增，而且要和版本号对得上，
 * 否则商店会拒绝，或者用户装不上升级包。约定：1.8.0 → 10800。
 */
const androidVersionCode = Number(gradle.match(/versionCode\s+(\d+)/)?.[1])
const [major, minor, patch] = rootVersion.split('.').map(Number)
const expectedVersionCode = major * 10000 + minor * 100 + patch
if (androidVersionCode !== expectedVersionCode) {
  console.error(
    `Android versionCode ${androidVersionCode} does not match version ${rootVersion} ` +
    `(expected ${expectedVersionCode})`)
  process.exit(1)
}

const versions = {
  rootVersion, frontendVersion, tauriConfigVersion, cargoVersion, lockVersion,
  androidVersion, iosVersion,
}
const mismatches = Object.entries(versions).filter(([, version]) => version !== rootVersion)
if (mismatches.length > 0) {
  console.error('Application versions are not synchronized:', versions)
  process.exit(1)
}
console.log(`Application versions are synchronized at ${rootVersion}`)
