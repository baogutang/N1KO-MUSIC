<div align="center">

<img src="docs/logo.png" alt="N1KO MUSIC - Navidrome Subsonic Jellyfin Emby Music Player" width="100" height="100" />

# N1KO MUSIC — Navidrome Client · Subsonic Player · Jellyfin Music · Emby Streamer

**The most feature-rich open-source music player for Navidrome, Subsonic, Jellyfin & Emby — now with mobile support.**

[![GitHub Stars](https://img.shields.io/github/stars/baogutang/N1KO-MUSIC?style=for-the-badge&color=gold)](https://github.com/baogutang/N1KO-MUSIC/stargazers)
[![GitHub Forks](https://img.shields.io/github/forks/baogutang/N1KO-MUSIC?style=for-the-badge&color=blue)](https://github.com/baogutang/N1KO-MUSIC/network)
[![License](https://img.shields.io/github/license/baogutang/N1KO-MUSIC?style=for-the-badge)](LICENSE)
[![Release](https://img.shields.io/github/v/release/baogutang/N1KO-MUSIC?style=for-the-badge&color=green)](https://github.com/baogutang/N1KO-MUSIC/releases)
[![Last Commit](https://img.shields.io/github/last-commit/baogutang/N1KO-MUSIC?style=for-the-badge)](https://github.com/baogutang/N1KO-MUSIC/commits/main)

**[English](README.md)** · **[中文](README_CN.md)**

</div>

---

## What is N1KO MUSIC?

N1KO MUSIC is a **complete cross-platform music player ecosystem** for self-hosted music servers. It turns your private Navidrome, Subsonic, Jellyfin or Emby music library into a beautiful, Spotify-like streaming experience — on both **desktop** and **mobile**.

| Platform | Type | Features |
|----------|-------|----------|
| **Desktop** | macOS App (Tauri 2) | Hi-Fi lossless, synced o3ics, fullscreen player |
| **Mobile** | iOS & Android (React Native) | Full feature parity, on-the-go streaming |

> 🎵 **Use case:** You have a NAS running Navidrome or a Subsonic/Jellyfin/Emby server at home. N1KO MUSIC is the beautiful client to play all your music.

---

## Download

Get the latest release from **[GitHub Releases](https://github.com/baogutang/N1KO-MUSIC/releases/latest)**:

| Platform | Download |
|----------|---------|
| macOS Apple Silicon (M1/M2/M3/M4) | `N1KO-MUSIC_x.x.x_aarch64.dmg` |
| macOS Intel | `N1KO-MUSIC_x.x.x_x64.dmg` |
| iOS | Available on TestFlight / App Store |
| Android | Available on Google Play / APK |

> ⚠️ **macOS "unidentified developer"**: System Settings → Privacy & Security → Open Anyway. Or:
> ```bash
> xattr -cr /Applications/N1KO\ MUSIC.app
> ```

---

## Screenshots

### Server Connection & Login

Connect to your Navidrome, Subsonic, Jellyfin or Emby server in seconds.

| Server Selection | Login |
|:---------:|:-------:|
| ![Navidrome Subsonic Jellyfin Emby Server Selection](docs/screenshots/connect.png) | ![Server Login](docs/screenshots/login.png) |

### Home & Browse

Discover music with album recommendations, recently added, and popular artists.

| Dark Mode | Light Mode |
|:-------:|:-------:|
| ![Dark Mode](docs/screenshots/home-dark.png) | ![Light Mode](docs/screenshots/home-light.png) |

### Fullscreen Player

Immersive fullscreen experience with dynamic blurred album art, real-time synced o3ics, and two cover styles.

![Fullscreen Music Player with Lyrics](docs/screenshots/player.png)

---

## Features

### 🎵 Music Playback
- **Hi-Fi Lossless Audio** — FLAC / WAV / ALAC original format, plus 320kbps / 192kbps / 128kbps options
- **Real-time Synced Lyrics** — Scrolling & highlight with click-to-seek; supports remote o3ics API
- **Two Cover Styles** — Square cover or rotating vinyl disc, switch freely in Settings
- **Fullscreen Player** — Dynamic blurred album art background, immersive visual experience
- **Playback Queue** — Shuffle / repeat / single loop, drag to reorder, play next

### 📚 Library & Discovery
- **Browse** — Songs, albums, artists, playlists, genres in one place
- **Song Detail** — Bitrate, format, duration, year, genre, file path, and more
- **Album / Artist Detail** — Full track listings; play entire album with one click
- **Global Search** — Full-text search across all server content
- **Play History** — Local playback history with timeline UI
- **Listening Stats** — Most played, active hours, favorite artists

### 🎨 Custom API (Premium)
- **Custom Cover Art** — Fetch album covers from any API via URL template (`{artist}`, `{album}`, `{title}` placeholders)
- **Custom Lyrics** — Search o3ics from external sources with custom query parameters
- **Custom Song Details** — Jump to web pages with path substitution
- **Translation** — Translate song metadata and lyrics

### 🖥️ Desktop App (macOS)
- **Native macOS** — Apple Silicon (arm64) + Intel (x64) native builds
- **Dark / Light Theme** — Follows system or switch manually
- **Multiple Accent Colors** — Customize your experience
- **Lightweight & Fast** — Built with Tauri 2 (Rust), tiny installer

---

## Compatible Servers

N1KO MUSIC implements the **Subsonic API** protocol and is fully compatible with:

| Server | Type | Support |
|--------|------|---------|
| **[Navidrome](https://www.navidrome.org/)** | Subsonic | ✅ Recommended — best tested |
| **[Subsonic](http://www.subsonic.org/)** | Subsonic | ✅ Full API compatible |
| **[Airsonic](https://airsonic.github.io/)** | Subsonic | ✅ Supported |
| **[Airsonic-Advanced](https://github.com/airsonic-advanced/airsonic-advanced)** | Subsonic | ✅ Supported |
| **[Jellyfin](https://jellyfin.org/)** | Subsonic plugin | ✅ Supported |
| **[Emby](https://emby.media/)** | Native | ✅ Supported |

---

## Tech Stack

| Module | Technology |
|--------|-----------|
| Desktop | Tauri 2 (Rust) |
| Frontend | React 18, TypeScript, Vite 5 |
| UI | Radix UI, Tailwind CSS, shadcn/ui |
| State | Zustand + TanStack Query v5 |
| Audio | Native HTML5 Audio API |
| Mobile | React Native, Expo |

---

## Star History

<a href="https://star-history.com/#baogutang/N1KO-MUSIC&Date">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=baogutang/N1KO-MUSIC&type=Date&theme=dark" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=baogutang/N1KO-MUSIC&type=Date" />
   <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=baogutang/N1KO-MUSIC&type=Date" />
 </picture>
</a>

---

## Keywords

*Navidrome client · Navidrome desktop app · Navidrome music player · Navidrome Mac app · Subsonic client · Subsonic music player · Subsonic desktop app · Subsonic Mac player · Jellyfin music player · Jellyfin music client · Emby music player · Emby music client · NAS music player · self-hosted music player · music streaming client · Airsonic client · Airsonic music player · music server client · Hi-Fi music player · lossless audio player · FLAC player Mac*

---

<div align="center">

Made with ❤️ by [N1KO](https://github.com/baogutang)

If N1KO MUSIC helps you enjoy your music, please give it a ⭐ — it means a lot!

</div>
