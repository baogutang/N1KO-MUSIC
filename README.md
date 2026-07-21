<div align="center">

<img src="docs/logo.png" alt="N1KO MUSIC" width="88" height="88" />

# N1KO MUSIC

**The modern Hi-Fi music player built for your NAS**

Connect to Navidrome / Subsonic / Jellyfin / Emby and turn your private library into a first-class streaming experience.

<br/>

[![Release](https://img.shields.io/github/v/release/baogutang/N1KO-MUSIC?style=flat-square&color=2ec27e&label=release)](https://github.com/baogutang/N1KO-MUSIC/releases/latest)
[![Stars](https://img.shields.io/github/stars/baogutang/N1KO-MUSIC?style=flat-square&color=2ec27e&label=stars)](https://github.com/baogutang/N1KO-MUSIC/stargazers)
[![License](https://img.shields.io/github/license/baogutang/N1KO-MUSIC?style=flat-square&color=555)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS%20·%20Windows%20·%20Linux-555?style=flat-square)](https://github.com/baogutang/N1KO-MUSIC/releases/latest)

<br/>

**[⬇ Download](https://github.com/baogutang/N1KO-MUSIC/releases/latest)** · **[English](README.md)** · **[中文](README_CN.md)**

</div>

<br/>

## Design philosophy

N1KO MUSIC is not just another tool that plays files. It is crafted with the aesthetics of high-end audio equipment: an ink-dark canvas, a single emerald accent, monospaced timecodes, a floating glass playback console, and ambient light extracted in real time from the album artwork. Light and dark themes share one design language, and every screen keeps the same restraint and precision.

On the sound side it streams FLAC / WAV / ALAC losslessly, with 320kbps down to 128kbps transcoding tiers for when bandwidth matters.

N1KO MUSIC is fully free and open source. Every feature works out of the box.

<br/>

## Screenshots

### Connect your server

Navidrome, Subsonic, Jellyfin and Emby are supported out of the box.

| Choose a server | Sign in |
|:---------:|:-------:|
| ![Server selection](docs/screenshots/connect.png) | ![Login](docs/screenshots/login.png) |

### Home

Latest albums, recently added and top artists at a glance, in light or dark.

| Dark | Light |
|:-------:|:-------:|
| ![Dark mode](docs/screenshots/home-dark.png) | ![Light mode](docs/screenshots/home-light.png) |

### Fullscreen player

Immersive ambience derived from the cover art, synced scrolling lyrics, tap any line to seek.

![Fullscreen player](docs/screenshots/player.png)

### Listening stats

Your personal music report: play counts, total time, favorite songs, artists and albums.

![Stats](docs/screenshots/stats.png)

### Settings

Server management, themes and accent colors, quality tiers, custom cover and lyrics APIs.

![Settings](docs/screenshots/settings.png)

<br/>

## Features

**Playback**

- Immersive fullscreen player with artwork-derived ambience and synced lyrics
- Lossless passthrough (FLAC / WAV / ALAC) plus 320 / 192 / 128kbps transcoding tiers
- Full queue control: shuffle, repeat, repeat-one, drag reorder, play-next insertion
- Global keyboard shortcuts and system media keys (MediaSession)

**Library and discovery**

- Songs, albums, artists and playlists in one place, with infinite scrolling
- Instant library-wide search and randomized recommendations
- Local listening history and visualized statistics
- Scrobbling based on real listening time (Last.fm compatible via your server)

**Custom integrations**

- Custom cover and lyrics APIs with `{artist}` / `{album}` / `{title}` placeholders
- Configurable priority between server data and custom sources

**Desktop app**

- Native builds for macOS (Apple Silicon + Intel), Windows and Linux
- Light and dark themes that follow the system, five accent presets
- Built on Tauri 2: small installers, far lighter than Electron

<br/>

## Supported servers

| Server | Status | Notes |
|--------|------|------|
| [Navidrome](https://www.navidrome.org/) | ✅ Recommended | Best experience, fully tested |
| [Subsonic](http://www.subsonic.org/) | ✅ Supported | Full Subsonic API compatibility |
| [Airsonic](https://airsonic.github.io/) / [Airsonic-Advanced](https://github.com/airsonic-advanced/airsonic-advanced) | ✅ Supported | Subsonic-compatible forks |
| [Jellyfin](https://jellyfin.org/) | ✅ Supported | Native API integration |
| [Emby](https://emby.media/) | ✅ Supported | Native API integration |

<details>
<summary>Related searches</summary>
<sub>Navidrome client · Navidrome desktop app · Subsonic client · Subsonic music player · Jellyfin music player · Emby music player · NAS music player · self-hosted music player · music streaming client · Airsonic client</sub>
</details>

<br/>

## Download

Grab the installer for your platform from **[Releases](https://github.com/baogutang/N1KO-MUSIC/releases/latest)**:

| Platform | Package |
|------|--------|
| macOS (Apple Silicon) | `N1KO.MUSIC_x.x.x_aarch64.dmg` |
| macOS (Intel) | `N1KO.MUSIC_x.x.x_x64.dmg` |
| Windows | `N1KO.MUSIC_x.x.x_x64-setup.exe` / `.msi` |
| Linux | `.AppImage` / `.deb` |

> On macOS, if you see "cannot verify the developer" on first launch, allow the app under System Settings → Privacy & Security.

<br/>

## Tech stack

| Layer | Technology |
|------|-----|
| Frontend | React 18 · TypeScript · Vite 5 · Tailwind CSS |
| UI | Radix UI · shadcn/ui · Phosphor Icons |
| State and data | Zustand · TanStack Query v5 |
| Audio engine | Native HTML5 Audio |
| Desktop shell | Tauri 2 (Rust) |
| Data backend | Node.js (Express) · SQLite |

### Development

```bash
git clone https://github.com/baogutang/N1KO-MUSIC.git
cd N1KO-MUSIC/frontend
npm install
npm run dev          # web dev mode
npm run tauri:dev    # desktop dev mode
```

<br/>

## Acknowledgements

N1KO MUSIC stands on the shoulders of these excellent projects:

- [StreamMusic](https://github.com/gitbobobo/StreamMusic) a beautifully designed Flutter NAS music player whose UI and UX inspired this project
- [Navidrome](https://www.navidrome.org/) the outstanding open-source Subsonic server
- [Radix UI](https://www.radix-ui.com/) · [shadcn/ui](https://ui.shadcn.com/) · [TanStack Query](https://tanstack.com/query) · [Zustand](https://github.com/pmndrs/zustand)

<br/>

## Star history

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

Built by [N1KO](https://github.com/baogutang)

If N1KO MUSIC is useful to you, a ⭐ means the world.

</div>
