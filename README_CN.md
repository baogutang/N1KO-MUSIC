<div align="center">

<img src="docs/logo.png" alt="N1KO MUSIC" width="96" height="96" />

# N1KO MUSIC

**一本可以播放的音乐杂志**

连接 Navidrome / Subsonic / Jellyfin / Emby，把你的私人曲库，读成一本编排精良的刊物。

<br/>

[![Release](https://img.shields.io/github/v/release/baogutang/N1KO-MUSIC?style=flat-square&color=b8442a&label=release)](https://github.com/baogutang/N1KO-MUSIC/releases/latest)
[![Stars](https://img.shields.io/github/stars/baogutang/N1KO-MUSIC?style=flat-square&color=b8442a&label=stars)](https://github.com/baogutang/N1KO-MUSIC/stargazers)
[![License](https://img.shields.io/github/license/baogutang/N1KO-MUSIC?style=flat-square&color=555)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS%20·%20Windows%20·%20Linux%20·%20Android%20·%20iOS-555?style=flat-square)](https://github.com/baogutang/N1KO-MUSIC/releases/latest)

<br/>

**[⬇ 下载最新版](https://github.com/baogutang/N1KO-MUSIC/releases/latest)** · **[English](README.md)** · **[中文](README_CN.md)**

</div>

<br/>

## 由同一作者出品 · N1KO-API

[![N1KO-API · 一个密钥，无限模型 — Claude / GPT / Gemini 全系接入，OpenAI 兼容，按量计费](docs/n1ko-api-banner.svg)](https://token.baogutang.top)

> 写代码的、做产品的、折腾 AI 的，大概率用得上：**[N1KO-API](https://token.baogutang.top)** —— 订阅转 API 中转平台。一个密钥调用 Claude、GPT、Gemini 全系顶级模型，智能路由 + 故障秒切，SLA 99.9%，按量计费无月费。技术支持 QQ：783246411。

<br/>

## 设计哲学

大多数音乐客户端长得像管理后台。N1KO MUSIC 想做的是一本**可以播放的杂志**：

- **文字即界面** —— 没有卡片、没有阴影堆叠、没有圆角药丸按钮。排版、发丝线与留白承担全部结构职责
- **封面即内容** —— 专辑封面是唯一的大面积色块，其余位置保持纸面的克制
- **衬线排印** —— 自托管 Source Serif 4 / Hanken Grotesk / JetBrains Mono（Claude 同款字腔），歌名用衬线，数据用等宽
- **纸 · 墨 · 朱** —— 米白纸面 `#f4efe3`、墨色文字、唯一朱红强调色 `#b8442a`；深色模式是同气质变体，不是简单反色

音质同样不妥协：FLAC / WAV / ALAC 无损直通，外出时可选 320 / 192 / 128kbps 转码档。

N1KO MUSIC 完全免费开源，所有功能开箱即用。

<br/>

## 界面预览

### 正在播放

封面晕染氛围、衬线歌词流、当前句朱红标记，点击任意一句跳转。

![正在播放](docs/screenshots/v2/player.gif)

### 首页 · 杂志封面

本期封面头条、最近添加编号列表、热门歌手文字索引——像翻开一本刊物的目录页。

![首页](docs/screenshots/v2/home.png)

### 专辑 · 内页档案

大封面、档案式元信息、发丝线曲目表。

![专辑详情](docs/screenshots/v2/album.png)

### 连接服务器

Navidrome / Subsonic / Jellyfin / Emby，即连即用。

![连接服务器](docs/screenshots/v2/login.png)

<br/>

## 核心功能

**播放体验**

- 杂志式全屏播放器：封面取色晕染、衬线歌词流、点击歌词跳转
- 无损直通（FLAC / WAV / ALAC）与 320 / 192 / 128kbps 转码档位
- 完整播放队列：随机、循环、单曲循环、拖拽排序、下一首插队
- 全局键盘快捷键与系统媒体键（MediaSession）

**音乐库与发现**

- 歌曲、专辑、歌手、歌单一体化浏览，无限滚动
- 跨全库即时搜索；「为你推荐」按收听、收藏与跳过行为动态生成
- 本地播放历史与杂志数据版式的听歌统计
- 播放行为按真实收听时长上报服务器（兼容 Last.fm Scrobble）

**自定义接口**

- 自定义封面与歌词 API，支持 `{artist}` / `{album}` / `{title}` 占位符
- 服务器数据与自定义接口优先级可控，歌词可手动搜索并缓存

**桌面应用**

- macOS（Apple Silicon + Intel）、Windows、Linux 原生构建
- 深浅主题跟随系统；黑胶 / 方形封面两种播放器形态
- 基于 Tauri 2：安装包 ~4MB，内存占用远低于 Electron

**移动应用**

- 同一套杂志化界面，为触控重塑：底部导航、迷你播放器、安全区适配
- Android / iOS 后台播放，锁屏与通知栏媒体控制
- Android 返回手势、状态栏随主题、播放控制触感反馈
- 基于 Capacitor 8，桌面与移动共用一套 React 代码

<br/>

## 兼容服务器

| 服务器 | 状态 | 说明 |
|--------|------|------|
| [Navidrome](https://www.navidrome.org/) | ✅ 推荐 | 最佳体验，完整测试 |
| [Subsonic](http://www.subsonic.org/) | ✅ 支持 | 完整 Subsonic API 兼容 |
| [Airsonic](https://airsonic.github.io/) / [Airsonic-Advanced](https://github.com/airsonic-advanced/airsonic-advanced) | ✅ 支持 | Subsonic 兼容分支 |
| [Jellyfin](https://jellyfin.org/) | ✅ 支持 | 原生 API 接入 |
| [Emby](https://emby.media/) | ✅ 支持 | 原生 API 接入 |

<details>
<summary>相关搜索</summary>
<sub>Navidrome 客户端 · Navidrome 桌面应用 · Subsonic 客户端 · Subsonic 音乐播放器 · Jellyfin 音乐播放器 · Emby 音乐播放器 · NAS 音乐播放器 · 自建音乐播放器 · 音乐流媒体客户端 · Airsonic 客户端</sub>
</details>

<br/>

## 下载安装

前往 **[Releases](https://github.com/baogutang/N1KO-MUSIC/releases/latest)** 下载对应平台安装包：

| 平台 | 安装包 |
|------|--------|
| macOS (Apple Silicon) | `N1KO.MUSIC_x.x.x_aarch64.dmg` |
| macOS (Intel) | `N1KO.MUSIC_x.x.x_x64.dmg` |
| Windows | `N1KO.MUSIC_x.x.x_x64-setup.exe` / `.msi` |
| Linux | `.AppImage` / `.deb` |

**移动端**（由 [Mobile 工作流](https://github.com/baogutang/N1KO-MUSIC/actions/workflows/mobile.yml)构建，在最新一次运行的 Artifacts 中下载）：

| 平台 | 安装包 | 说明 |
|------|--------|------|
| Android | `N1KO-MUSIC-android-debug` → `app-debug.apk` | Debug 包，直接安装（需允许未知来源） |
| iOS | `N1KO-MUSIC-ios-unsigned` → `.zip` | 未签名，需用 AltStore / Sideloadly 自签安装 |

> 移动端的正式签名构建（Play keystore / Apple 开发者证书）暂未配置，工作流已预留扩展位。

> macOS 首次打开如提示「无法验证开发者」，请在「系统设置 → 隐私与安全性」中允许打开。

<br/>

## 技术栈

| 模块 | 技术 |
|------|-----|
| 前端 | React 18 · TypeScript · Vite 5 · Tailwind CSS |
| UI | Radix UI · Phosphor Icons · 自托管字体（Source Serif 4 / Hanken Grotesk / JetBrains Mono） |
| 状态与数据 | Zustand · TanStack Query v5 |
| 音频引擎 | 原生 HTML5 Audio |
| 桌面框架 | Tauri 2 (Rust) |
| 移动框架 | Capacitor 8 (Android · iOS) |
| 可选同步服务 | Node.js 24 · Express · SQLite |

### 本地开发

```bash
git clone https://github.com/baogutang/N1KO-MUSIC.git
cd N1KO-MUSIC/frontend
npm install
npm run dev          # Web 开发模式
npm run tauri:dev    # 桌面应用开发模式
```

### 移动端（Android / iOS）

同一套 React 前端跑在 Capacitor 壳内，带原生后台播放与锁屏控制。

```bash
cd frontend
npm run cap:sync            # 构建 Web 资源并同步原生工程
npx cap open android        # 需要 Android Studio / SDK
npx cap open ios            # 需要 Xcode + CocoaPods
```

`Mobile` GitHub Actions 工作流（推 `v*` tag 或手动触发）产出 Android debug APK、iOS 模拟器构建与未签名设备包，可在 Artifacts 直接下载。

### 可选同步服务

`backend/` 提供账号、本地歌单、收藏和播放历史 API，用于跨设备同步。

它是**完全可选**的：音乐始终直连你自己的音乐服务器，不部署同步服务时功能不受任何影响，
收听历史保存在本地 IndexedDB 中。

部署完成后，在 **设置 › 跨设备同步（SYNC）** 里填写服务地址并登录即可。
客户端会把收听历史与收藏镜像上去，并合并其他设备写入的记录，
换设备后推荐画像不必从零重建。

```bash
cd backend
npm ci
npm test
JWT_SECRET="请替换为足够长的随机值" DATA_DIR=./data npm start
```

Docker 部署时必须挂载 `/app/data`，否则容器重建后数据库与自动生成的 JWT 密钥会丢失：

```bash
docker build -t n1ko-music-backend backend
docker run -d --name n1ko-music-backend \
  -p 3001:3001 \
  -v n1ko-music-data:/app/data \
  -e JWT_SECRET="请替换为足够长的随机值" \
  n1ko-music-backend
```

可用环境变量：`PORT`、`DATA_DIR`、`JWT_SECRET`、`FRONTEND_URLS`（逗号分隔）、
`TRUST_PROXY_HOPS`、`RATE_LIMIT_MAX`、`AUTH_RATE_LIMIT_MAX`。数据库升级前会在数据目录自动创建一致性备份。

<br/>

## 鸣谢

N1KO MUSIC 的诞生离不开以下优秀开源项目的启发与支持：

- [StreamMusic](https://github.com/gitbobobo/StreamMusic) 一款优秀的 Flutter 移动端 NAS 音乐播放器，精良的 UI 与 UX 给了本项目很多灵感
- [Navidrome](https://www.navidrome.org/) 出色的开源 Subsonic 服务端
- [Radix UI](https://www.radix-ui.com/) · [TanStack Query](https://tanstack.com/query) · [Zustand](https://github.com/pmndrs/zustand)

<br/>

## Star 趋势

<a href="https://star-history.com/#baogutang/N1KO-MUSIC&Date">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=baogutang/N1KO-MUSIC&type=Date&theme=dark" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=baogutang/N1KO-MUSIC&type=Date" />
   <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=baogutang/N1KO-MUSIC&type=Date" />
 </picture>
</a>

<br/>
<br/>

<div align="center">

由 [N1KO](https://github.com/baogutang) 打造 · 顺便看看 **[N1KO-API](https://token.baogutang.top)**

如果 N1KO MUSIC 对你有帮助，请点一个 ⭐，这对我意义非凡。

</div>
