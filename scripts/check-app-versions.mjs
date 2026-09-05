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

/**
 * Tauri 的 Rust crate 与 npm 包必须在同一个 major.minor 上：
 * `tauri build` 开头就会做这道检查，不一致直接退出——v1.11.0 第一次打标签
 * 就是这么在四个桌面平台上全红的（crate 2.10.3 对 @tauri-apps/api 2.11.1，
 * 一次 npm install 在 ^ 范围内悄悄漂上去的）。package.json 已改成 ~ 锁住小版本，
 * 这里再钉一次，让漂移在本地 check:versions 就暴露，而不是等 CI 编到一半。
 */
const frontendLock = readJson('frontend/package-lock.json')
const tauriApiVersion = frontendLock.packages?.['node_modules/@tauri-apps/api']?.version
const tauriCrateVersion = cargoLock.match(/\[\[package\]\]\nname = "tauri"\nversion = "([^"]+)"/)?.[1]
const minorOf = v => (v ?? '').split('.').slice(0, 2).join('.')
if (!tauriApiVersion || !tauriCrateVersion || minorOf(tauriApiVersion) !== minorOf(tauriCrateVersion)) {
  console.error(
    `Tauri version mismatch: crate tauri ${tauriCrateVersion} vs @tauri-apps/api ${tauriApiVersion} ` +
    '(must share major.minor; pin @tauri-apps/api with ~ in frontend/package.json)')
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
