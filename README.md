<div align="center">

<img src="docs/logo.png" alt="N1KO MUSIC - Music Player for Navidrome Subsonic Jellyfin Emby" width="100" height="100" />

# N1KO MUSIC

### A Modern Desktop Music Player for Navidrome, Subsonic, Jellyfin & Emby

**The best self-hosted NAS music streaming client you'll ever use.**

[![GitHub Stars](https://img.shields.io/github/stars/baogutang/N1KO-MUSIC?style=for-the-badge&color=gold)](https://github.com/baogutang/N1KO-MUSIC/stargazers)
[![GitHub Forks](https://img.shields.io/github/forks/baogutang/N1KO-MUSIC?style=for-the-badge&color=blue)](https://github.com/baogutang/N1KO-MUSIC/network)
[![License](https://img.shields.io/github/license/baogutang/N1KO-MUSIC?style=for-the-badge)](LICENSE)
[![Version](https://img.shields.io/badge/version-1.0.16-green?style=for-the-badge)](https://github.com/baogutang/N1KO-MUSIC/releases)

**[English](README.md)** · **[中文](README_CN.md)**

</div>

---

## What is N1KO MUSIC?

N1KO MUSIC is a **cross-platform desktop music player** designed for self-hosted music servers. It connects to **Navidrome**, **Subsonic**, **Jellyfin**, and **Emby** — turning your private music library into a beautiful, Spotify-like streaming experience.

Built with **Tauri 2 + React + TypeScript**, it offers a native macOS desktop app with Hi-Fi lossless playback (FLAC/WAV/ALAC), real-time synced lyrics, and a stunning fullscreen player.

> **Looking for a Navidrome desktop client? A Subsonic music player? A Jellyfin or Emby music streaming app?**
> N1KO MUSIC is built exactly for that.

---

## Screenshots

### Server Connection

Connect to **Navidrome**, **Subsonic**, **Jellyfin**, or **Emby** servers with one click.

| Select Server | Login |
|:---------:|:-------:|
| ![Navidrome Subsonic Jellyfin Emby Server Selection](docs/screenshots/connect.png) | ![Server Login](docs/screenshots/login.png) |

### Home

Beautiful home page with album recommendations, recently added, and popular artists. Supports dark & light themes.

| Dark Mode | Light Mode |
|:-------:|:-------:|
| ![Dark Mode](docs/screenshots/home-dark.png) | ![Light Mode](docs/screenshots/home-light.png) |

### Fullscreen Player

Immersive fullscreen experience with dynamic blurred album art background and real-time synced scrolling lyrics.

![Fullscreen Music Player with Lyrics](docs/screenshots/player.png)

### Listening Stats

Your music data report: total plays, listening time, top songs, top artists, and top albums.

![Music Listening Statistics](docs/screenshots/stats.png)

### Settings

Server management, theme customization, audio quality (Lossless/High/Standard/Low), custom API integration, and more.

![Settings](docs/screenshots/settings.png)

---

## Features

### 🎵 Music Playback
- **Fullscreen Player** — Album art with dynamic blur gradient background, smooth animations
- **Real-time Lyrics** — Synced scrolling & highlighting, click-to-seek, custom remote lyrics API support
- **Hi-Fi Lossless Audio** — FLAC / WAV / ALAC original format playback, plus 320kbps & low bitrate options
- **Playback Queue** — Shuffle / repeat / single loop, drag to reorder, play next

### 📚 Music Library & Discovery
- **Music Library** — Browse songs, albums, artists, and playlists in one place
- **Recommendations** — Discover music from your library with smart random picks
- **Global Search** — Full-text search across all content
- **Play History** — Local playback history with beautiful timeline UI
- **Listening Stats** — Visual data: most played, active hours, favorite artists

### 🎨 Custom API Integration
- **Custom Cover Art** — Replace album covers with your own API (supports `{artist}`, `{album}`, `{title}` placeholders)
- **Custom Lyrics** — Fetch lyrics from any external source via URL template
- **Priority Control** — Choose server data or custom API first

### 🖥️ Desktop App
- **macOS** — Native window style, Apple Silicon (arm64) + Intel (x64)
- **Dark / Light Theme** — Follow system or switch manually, multiple accent colors
- **Built with Tauri 2** — Lightweight, fast, native performance

---

## Compatible Servers

N1KO MUSIC implements the **Subsonic API** protocol and is compatible with the following music servers:

| Server | Status | Notes |
|--------|--------|-------|
| [**Navidrome**](https://www.navidrome.org/) | ✅ Recommended | Best experience, fully tested |
| [**Subsonic**](http://www.subsonic.org/) | ✅ Supported | Full Subsonic API compatibility |
| [**Airsonic**](https://airsonic.github.io/) | ✅ Supported | Subsonic-compatible fork |
| [**Airsonic-Advanced**](https://github.com/airsonic-advanced/airsonic-advanced) | ✅ Supported | Enhanced Airsonic fork |
| [**Jellyfin**](https://jellyfin.org/) | ✅ Supported | Via Subsonic plugin |
| [**Emby**](https://emby.media/) | ✅ Supported | Native support |

> **Keywords:** Navidrome client, Navidrome desktop app, Navidrome music player, Subsonic client, Subsonic desktop player, Jellyfin music player, Jellyfin music client, Emby music player, Emby music client, NAS music player, self-hosted music player, music streaming client, Airsonic client

---

## Premium

N1KO MUSIC is free for basic features. Upgrade to Premium to unlock:

- 🎶 **Lossless Audio** — FLAC / WAV / ALAC original format playback
- ✨ **Recommendations** — Smart music discovery from your library
- ❤️ **Favorites** — Save your favorite songs
- 📊 **Listening Stats** — Detailed playback data visualization

### How to Upgrade

1. Scan the QR code below with Alipay and transfer **¥59.9** (lifetime membership)
2. Leave your **Alipay account** or **contact info** in the transfer note
3. Contact the payee (Nikooh) via Alipay to get the **activation code**
4. Enter the activation code in N1KO MUSIC Settings page

<div align="center">

<img src="docs/screenshots/alipay.jpg" alt="Alipay QR Code" width="300" />

**Scan with Alipay · Contact for activation code**

</div>

---

## Tech Stack

| Module | Technology |
|--------|-----------|
| Frontend | React 18, TypeScript, Vite 5 |
| UI Components | Radix UI, Tailwind CSS, shadcn/ui |
| State Management | Zustand |
| Data Fetching | TanStack Query v5 |
| Audio Engine | Native HTML5 Audio API |
| Desktop Framework | Tauri 2 (Rust) |
| License Backend | Spring Boot 3, JPA, H2/MySQL |

---

## Acknowledgments

N1KO MUSIC is inspired by and built upon these amazing open-source projects:

- **[StreamMusic](https://github.com/gitbobobo/StreamMusic)** — An excellent Flutter-based mobile NAS music player. Its refined UI/UX design inspired this project 🫡
- [Navidrome](https://www.navidrome.org/) — Outstanding open-source Subsonic server
- [Radix UI](https://www.radix-ui.com/) — Unstyled, accessible UI primitives
- [shadcn/ui](https://ui.shadcn.com/) — Beautiful React UI components
- [TanStack Query](https://tanstack.com/query) — Powerful async state management
- [Zustand](https://github.com/pmndrs/zustand) — Lightweight global state management

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

<div align="center">

Made with ❤️ by [N1KO](https://github.com/baogutang)

If N1KO MUSIC helps you, please give it a ⭐ — it means a lot!

</div>
