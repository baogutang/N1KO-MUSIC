#!/usr/bin/env node
/**
 * 给原生插件的源码打补丁（frontend 的 postinstall，npm ci / npm install 之后自动跑）。
 *
 * capacitor-music-controls-plugin 8.0.0 的 iOS 实现，建锁屏封面时有三处强制解包：
 * 封面地址回来的不是一张能解码的图（404 页、空内容、Subsonic 的错误 XML），
 * `UIImage(data:)!` 拿到 nil，整个 App 直接崩（EXC_BREAKPOINT）。
 * App 启动会恢复上次的歌并立刻建封面，于是表现为一打开就闪退
 * （v1.12.0 在 iPadOS 27.2 上的崩溃日志：CapacitorMusicControls.createCoverArtwork）。
 * 上游最新版仍是 8.0.0，没修；这里改成「拿不到图就不放封面」，播放照常。
 *
 * 只做精确的字符串替换：插件升级后原文对不上、也看不到已打过的痕迹，就报错退出，
 * 不让补丁静默失效。Pods 直接编译 node_modules 里的源码，所以改这里就够了。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const PATCHES = [
  {
    file: 'node_modules/capacitor-music-controls-plugin/ios/Plugin/Plugin.swift',
    edits: [
      ['let coverImageUrl = URL(string: coverUri)!;', 'guard let coverImageUrl = URL(string: coverUri) else { return nil };'],
      ['coverImage = UIImage(data:coverImageData)!;', 'coverImage = UIImage(data:coverImageData);'],
      ['coverImage = UIImage(contentsOfFile: fullCoverImagePath)!', 'coverImage = UIImage(contentsOfFile: fullCoverImagePath) '],
    ],
  },
]

let failed = false
for (const patch of PATCHES) {
  const path = resolve(frontendRoot, patch.file)
  if (!existsSync(path)) {
    console.log(`[patch-native-plugins] 跳过：${patch.file} 不存在`)
    continue
  }
  let source = readFileSync(path, 'utf8')
  let changed = 0
  for (const [from, to] of patch.edits) {
    if (source.includes(from)) {
      source = source.replace(from, to)
      changed++
    } else if (!source.includes(to)) {
      console.error(`[patch-native-plugins] ${patch.file} 里找不到要改的原文，插件可能升级了，请核对：\n  ${from}`)
      failed = true
    }
  }
  if (changed) {
    writeFileSync(path, source)
    console.log(`[patch-native-plugins] ${patch.file}：改了 ${changed} 处`)
  }
}
if (failed) process.exit(1)
