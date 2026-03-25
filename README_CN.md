<div align="center">

<img src="docs/logo.png" alt="N1KO MUSIC - Navidrome Subsonic Jellyfin Emby 音乐播放器" width="100" height="100" />

# N1KO MUSIC — Navidrome 客户端 · Subsonic 播放器 · Jellyfin / Emby 音乐流媒体

**专为 Navidrome、Subsonic、Jellyfin、Emby 打造的跨平台开源音乐播放器，桌面 + 移动端全覆盖。**

[![GitHub Stars](https://img.shields.io/github/stars/baogutang/N1KO-MUSIC?style=for-the-badge&color=gold)](https://github.com/baogutang/N1KO-MUSIC/stargazers)
[![GitHub Forks](https://img.shields.io/github/forks/baogutang/N1KO-MUSIC?style=for-the-badge&color=blue)](https://github.com/baogutang/N1KO-MUSIC/network)
[![License](https://img.shields.io/github/license/baogutang/N1KO-MUSIC?style=for-the-badge)](LICENSE)
[![版本](https://img.shields.io/github/v/release/baogutang/N1KO-MUSIC?style=for-the-badge&color=green)](https://github.com/baogutang/N1KO-MUSIC/releases)
[![Last Commit](https://img.shields.io/github/last-commit/baogutang/N1KO-MUSIC?style=for-the-badge)](https://github.com/baogutang/N1KO-MUSIC/commits/main)

**[English](README.md)** · **[中文](README_CN.md)**

</div>

---

## N1KO MUSIC 是什么？

N1KO MUSIC 是一款专为**自建音乐服务器**设计的跨平台音乐播放客户端。支持连接 **Navidrome**、**Subsonic**、**Jellyfin** 和 **Emby**，把 NAS 上的私人音乐库变成类 Spotify 的流媒体体验——桌面和手机都能用。

| 平台 | 类型 | 亮点 |
|------|------|------|
| **桌面端** | macOS (Tauri 2) | Hi-Fi 无损播放、同步歌词、全屏播放器 |
| **移动端** | iOS & Android (React Native) | 与桌面端功能对等，随时随地听歌 |

> 🎵 **使用场景：** 你的 NAS 上跑了 Navidrome，或者自建了 Subsonic / Jellyfin / Emby 音乐服务器？N1KO MUSIC 就是为你量身打造的精美客户端。

---

## 下载安装

前往 **[GitHub Releases](https://github.com/baogutang/N1KO-MUSIC/releases/latest)** 下载最新版：

| 平台 | 安装包 |
|------|--------|
| macOS Apple Silicon (M1/M2/M3/M4) | `N1KO-MUSIC_x.x.x_aarch64.dmg` |
| macOS Intel | `N1KO-MUSIC_x.x.x_x64.dmg` |
| iOS | TestFlight / App Store |
| Android | Google Play / APK |

> ⚠️ **macOS 首次打开提示「无法验证开发者」**：前往「系统设置 → 隐私与安全性」，点击「仍要打开」即可。或终端执行：
> ```bash
> xattr -cr /Applications/N1KO\ MUSIC.app
> ```

---

## 界面预览

### 连接服务器

支持 **Navidrome**、**Subsonic**、**Jellyfin**、**Emby** 四种主流音乐服务器，一键连接。

| 选择服务器 | 登录连接 |
|:---------:|:-------:|
| ![Navidrome Subsonic Jellyfin Emby 服务器选择](docs/screenshots/connect.png) | ![登录连接](docs/screenshots/login.png) |

### 首页

精美首页设计，最新专辑推荐、最近添加、热门歌手。支持深色 / 浅色双主题。

| 深色模式 | 浅色模式 |
|:-------:|:-------:|
| ![深色模式](docs/screenshots/home-dark.png) | ![浅色模式](docs/screenshots/home-light.png) |

### 全屏播放器

沉浸式全屏体验，专辑封面动态模糊背景，实时同步滚动歌词，支持点击歌词跳转。支持方形封面和圆形旋转黑胶两种风格。

![全屏播放器](docs/screenshots/player.png)

---

## 核心功能

### 🎵 音乐播放
- **Hi-Fi 无损音质** — FLAC / WAV / ALAC 原始格式，支持 320kbps / 192kbps / 128kbps 多档可选
- **实时同步歌词** — 滚动高亮，点击跳转；支持自定义远程歌词 API
- **双封面风格** — 方形封面 / 圆形旋转黑胶，在设置中自由切换
- **全屏播放器** — 专辑封面动态模糊渐变背景，沉浸式视觉体验
- **播放队列** — 随机 / 列表循环 / 单曲循环，拖拽排序，下一首插队

### 📚 音乐库与发现
- **音乐库** — 歌曲、专辑、歌手、歌单、流派一体化浏览
- **歌曲详情页** — 完整标签信息（码率、格式、时长、年份、流派等）
- **专辑 / 歌手详情** — 完整曲目列表，一键播放整张专辑
- **全局搜索** — 跨全部内容的全文搜索
- **最近播放** — 本地播放历史，精美时间轴展示
- **听歌统计** — 可视化数据：最常播放、活跃时段、最爱歌手

### 🎨 自定义 API（会员专属）
- **自定义封面** — 用自己的 API 替换专辑封面（支持 `{artist}`、`{album}`、`{title}` 占位符）
- **自定义歌词** — 从外部来源获取歌词，URL 模板灵活配置
- **歌曲详情跳转** — 配置后可在详情页跳转至对应网页
- **翻译接口** — 翻译歌曲元信息和歌词

### 🖥️ 桌面应用（macOS）
- **原生 macOS** — Apple Silicon (arm64) + Intel (x64) 双架构原生构建
- **深色 / 浅色主题** — 跟随系统或手动切换，多种主题色可选
- **轻量快速** — 基于 Tauri 2 (Rust)，安装包体积小

---

## 兼容服务器

N1KO MUSIC 实现了 **Subsonic API** 协议，完整兼容以下主流音乐服务器：

| 服务器 | 类型 | 状态 |
|--------|------|------|
| **[Navidrome](https://www.navidrome.org/)** | Subsonic | ✅ 推荐 — 最佳体验，完整测试 |
| **[Subsonic](http://www.subsonic.org/)** | Subsonic | ✅ 支持 — 完整 API 兼容 |
| **[Airsonic](https://airsonic.github.io/)** | Subsonic | ✅ 支持 |
| **[Airsonic-Advanced](https://github.com/airsonic-advanced/airsonic-advanced)** | Subsonic | ✅ 支持 |
| **[Jellyfin](https://jellyfin.org/)** | Subsonic 插件 | ✅ 支持 |
| **[Emby](https://emby.media/)** | 原生 | ✅ 支持 |

---

## 技术栈

| 模块 | 技术 |
|------|------|
| 桌面端 | Tauri 2 (Rust) |
| 前端框架 | React 18, TypeScript, Vite 5 |
| UI 组件 | Radix UI, Tailwind CSS, shadcn/ui |
| 状态管理 | Zustand + TanStack Query v5 |
| 音频引擎 | 原生 HTML5 Audio API |
| 移动端 | React Native, Expo |

---

## Star 趋势

<a href="https://star-history.com/#baogutang/N1KO-MUSIC&Date">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=baogutang/N1KO-MUSIC&type=Date&theme=dark" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=baogutang/N1KO-MUSIC&type=Date" />
   <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=baogutang/N1KO-MUSIC&type=Date" />
 </picture>
</a>

---

## 关键词

*Navidrome 客户端 · Navidrome 桌面应用 · Navidrome 音乐播放器 · Navidrome Mac 客户端 · Subsonic 客户端 · Subsonic 音乐播放器 · Subsonic Mac 应用 · Jellyfin 音乐播放器 · Jellyfin 音乐客户端 · Emby 音乐播放器 · NAS 音乐播放器 · 自建音乐服务器播放器 · 音乐流媒体客户端 · Airsonic 客户端 · Hi-Fi 音乐播放器 · 无损音乐播放器 · FLAC 播放器 Mac*

---

<div align="center">

用 ❤️ 打造，作者 [N1KO](https://github.com/baogutang)

如果 N1KO MUSIC 对你有帮助，请给个 ⭐ — 这对我来说意义非凡！

</div>
