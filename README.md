<div align="center">

<img src="docs/logo.png" alt="N1KO MUSIC" width="96" height="96" />

# N1KO MUSIC

**A music magazine you can play**

Connect to Navidrome / Subsonic / Jellyfin / Emby and read your private library like a beautifully typeset issue.

<br/>

[![Release](https://img.shields.io/github/v/release/baogutang/N1KO-MUSIC?style=flat-square&color=b8442a&label=release)](https://github.com/baogutang/N1KO-MUSIC/releases/latest)
[![Stars](https://img.shields.io/github/stars/baogutang/N1KO-MUSIC?style=flat-square&color=b8442a&label=stars)](https://github.com/baogutang/N1KO-MUSIC/stargazers)
[![License](https://img.shields.io/github/license/baogutang/N1KO-MUSIC?style=flat-square&color=555)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS%20·%20Windows%20·%20Linux%20·%20Android%20·%20iOS-555?style=flat-square)](https://github.com/baogutang/N1KO-MUSIC/releases/latest)

<br/>

**[⬇ Download](https://github.com/baogutang/N1KO-MUSIC/releases/latest)** · **[English](README.md)** · **[中文](README_CN.md)**

</div>

<br/>

## From the same author · N1KO-API

[![N1KO-API — one key, every model: Claude / GPT / Gemini, OpenAI-compatible, pay as you go](docs/n1ko-api-banner.svg)](https://token.baogutang.top)

> If you build with AI, this one is for you: **[N1KO-API](https://token.baogutang.top)** — a subscription-to-API relay platform. One key for Claude, GPT and Gemini flagships, smart routing with instant failover, 99.9% SLA, transparent pay-as-you-go billing. Support QQ: 783246411.

<br/>

## Design philosophy

Most music clients look like admin dashboards. N1KO MUSIC is built as **a magazine you can play**:

- **Typography is the interface** — no cards, no stacked shadows, no pill buttons. Typesetting, hairlines and whitespace do all the structural work
- **Artwork is the content** — album covers are the only large color fields; everything else keeps the restraint of paper
- **Serif voices** — self-hosted Source Serif 4 / Hanken Grotesk / JetBrains Mono (the Claude-style pairing): serifs for music, monospace for data
- **Paper, ink, vermilion** — a warm paper canvas `#f4efe3`, ink text, and a single vermilion accent `#b8442a`. Dark mode is a variant of the same voice, not a simple inversion

Sound is not compromised either: FLAC / WAV / ALAC lossless passthrough, with 320 / 192 / 128kbps transcoding tiers for when bandwidth matters.

N1KO MUSIC is fully free and open source. Every feature works out of the box.

<br/>

## Interface

### Now playing

Artwork-derived ambience, a serif lyric stream with a vermilion marker on the current line — tap any line to seek.

![Now playing](docs/screenshots/v2/player.gif)

### Home · the cover page

A featured-album headline, a numbered recently-added list, a typographic artist index — the table of contents of your library.

![Home](docs/screenshots/v2/home.png)

### Album · the dossier page

Oversized cover, archival metadata, a hairline tracklist.

![Album detail](docs/screenshots/v2/album.png)

### Connect your server

Navidrome / Subsonic / Jellyfin / Emby, connected in seconds.

![Connect](docs/screenshots/v2/login.png)

<br/>

## Features

**Playback**

- Magazine-style fullscreen player: cover-derived ambience, serif lyric stream, tap-to-seek
- Lossless passthrough (FLAC / WAV / ALAC) plus 320 / 192 / 128kbps transcoding tiers,
  with **separate Wi-Fi and cellular tiers** switched automatically — no more pulling
  original files over your home uplink while you are out
- **ReplayGain normalisation** using the gain your server already computed, so masters
  from different eras stop jumping in loudness
- **Real whole-library shuffle**: a random sample drawn from the server rather than a
  reshuffle of the loaded page, and a queue panel that shows the **actual play order**
- **The queue keeps going** — similar tracks are appended when it runs dry, and any
  song, artist or genre can seed a radio
- Next-track preloading, fade on pause, playback speed 0.5–3x with pitch correction
- **Sleep timer** (duration or end-of-track) that fades out instead of cutting
- **Cross-device resume**: start on the desktop, pick it up on your phone
- Full queue control: shuffle, repeat, repeat-one, drag reorder, play-next insertion
- Global keyboard shortcuts, a **⌘K command palette**, and system media keys (MediaSession)

**Library and discovery**

- Songs, albums, artists and playlists in one place, with **virtualised** long lists
  that stay smooth on a ten-thousand-track library
- Instant library-wide search; For-You picks shaped by listening, favorites and skips —
  and a refresh button that genuinely returns a new batch
- **Liner notes**: personnel credits, album notes, ISRC and MusicBrainz pressing details
- **Spec plate**: bit depth, sample rate, codec, channels, real bitrate
- Shelves your server already computes: most played, recently played
- Local listening history and statistics set in editorial data layouts
- Scrobbling based on real listening time (Last.fm compatible via your server)

**Custom integrations**

- Custom cover and lyrics APIs with `{artist}` / `{album}` / `{title}` placeholders
- Configurable priority between server data and custom sources; manual lyric search with local cache
- Trigger a server-side library rescan straight from the client

**Details**

- Thin spaces inserted automatically between CJK and Latin runs; hanging punctuation;
  slashed-zero tabular numerals
- A persistent banner with a retry action when the device or the server goes offline —
  not a toast that vanishes
- Player toggles expose `aria-pressed` so screen readers can tell whether shuffle is on;
  text contrast meets WCAG AA

**Desktop app**

- Native builds for macOS (Apple Silicon + Intel), Windows and Linux
- Light and dark themes that follow the system; vinyl or square cover player modes
- Built on Tauri 2: ~4MB installers, far lighter than Electron

**Mobile app**

- The same editorial interface, reshaped for touch: bottom navigation, mini player, safe-area aware
- Background playback with lock-screen / notification controls on Android and iOS
- Android back gesture, theme-aware status bar, haptic feedback on transport controls
- Built on Capacitor 8 — one React codebase across desktop and mobile

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

**Mobile** (built by the [Mobile workflow](https://github.com/baogutang/N1KO-MUSIC/actions/workflows/mobile.yml), download from the latest run's Artifacts):

| Platform | Package | Notes |
|------|--------|------|
| Android | `N1KO-MUSIC-android-debug` → `app-debug.apk` | Debug build, installs directly (allow unknown sources) |
| iOS | `N1KO-MUSIC-ios-unsigned` → `.zip` | Unsigned; sideload with AltStore / Sideloadly |

> Release-signed mobile builds (Play keystore / Apple Developer) are not set up yet — the workflow slots them in without structural changes.

> On macOS, if you see "cannot verify the developer" on first launch, allow the app under System Settings → Privacy & Security.

<br/>

## Tech stack

| Layer | Technology |
|------|-----|
| Frontend | React 18 · TypeScript · Vite 5 · Tailwind CSS |
| UI | Radix UI · Phosphor Icons · self-hosted fonts (Source Serif 4 / Hanken Grotesk / JetBrains Mono) |
| State and data | Zustand · TanStack Query v5 |
| Audio engine | Native HTML5 Audio |
| Desktop shell | Tauri 2 (Rust) |
| Mobile shell | Capacitor 8 (Android · iOS) |
| Optional sync service | Node.js 24 · Express · SQLite |

### Mobile (Android / iOS)

The same React frontend runs inside a Capacitor shell with native background playback and lock-screen controls.

```bash
cd frontend
npm run cap:sync            # build web assets + sync native projects
npx cap open android        # requires Android Studio / SDK
npx cap open ios            # requires Xcode + CocoaPods
```

The `Mobile` GitHub Actions workflow (tag `v*` push or manual dispatch) builds an Android debug APK, an iOS simulator build and an unsigned iOS device package as downloadable artifacts. Release signing (Play keystore / Apple Developer certificate) can be added later without changing the workflow structure.

### Development

```bash
git clone https://github.com/baogutang/N1KO-MUSIC.git
cd N1KO-MUSIC/frontend
npm install
npm run dev          # web dev mode
npm run tauri:dev    # desktop dev mode
```

### Optional sync service

`backend/` exposes account, local-playlist, favourite and listening-history APIs for cross-device sync.
It is **entirely optional**: music always streams straight from your own music server, and with no sync service
configured the app keeps its full feature set, storing listening history locally in IndexedDB.

Once you have deployed it, open **Settings › 跨设备同步 (SYNC)**, enter the service address and sign in.
The client then mirrors listening history and favourites to the service and merges records written by your
other devices, so recommendations do not restart from scratch on a new device.

```bash
cd backend
npm ci
npm test
JWT_SECRET="replace-with-a-long-random-value" DATA_DIR=./data npm start
```

Docker deployments must mount `/app/data`; otherwise recreating the container loses both the database and the generated JWT secret:

```bash
docker build -t n1ko-music-backend backend
docker run -d --name n1ko-music-backend \
  -p 3001:3001 \
  -v n1ko-music-data:/app/data \
  -e JWT_SECRET="replace-with-a-long-random-value" \
  n1ko-music-backend
```

Supported environment variables include `PORT`, `DATA_DIR`, `JWT_SECRET`, comma-separated `FRONTEND_URLS`,
`TRUST_PROXY_HOPS`, `RATE_LIMIT_MAX`, `AUTH_RATE_LIMIT_MAX`, `ALLOW_REGISTRATION`,
`LOGIN_ATTEMPT_MAX`, and `LOGIN_ATTEMPT_WINDOW_MS`. A consistent backup is created in the
data directory before database migrations.

> **Registration policy (changed in v1.7.0)**: `ALLOW_REGISTRATION` defaults to
> `first-user` — registration is open until the first account exists, then closes
> automatically. This matters as soon as you expose the sync service to the internet.
> **Existing deployments that need to add a household member should set it to `open`
> temporarily**, or use `closed` to lock it down entirely.
>
> **JWT secret**: leave `JWT_SECRET` unset and the service generates a 48-byte random key
> and persists it with mode 0600 — safer than picking one by hand. If you do set it, it
> must be at least 32 characters or the service refuses to start.

### Web client via Docker

If you would rather not install a desktop or mobile app:

```bash
docker build -t n1ko-music-web frontend
docker run -d --name n1ko-music-web -p 8080:80 \
  -e DEFAULT_SERVER_URL=https://music.example.com \
  -e DEFAULT_SERVER_TYPE=navidrome \
  n1ko-music-web
```

<br/>

## Contributing

Pull requests are welcome. Please read **[CONTRIBUTING.md](CONTRIBUTING.md)** first —
especially the design-contract section. This project has a deliberate visual stance
(one accent colour, no card stacking, Phosphor icons only), and colours always come from
the tokens in `frontend/src/index.css`.

You do not need your own server to develop against: point the app at
`https://demo.navidrome.org` with username and password `demo`.

<br/>

## Acknowledgements

N1KO MUSIC stands on the shoulders of these excellent projects:

- [StreamMusic](https://github.com/gitbobobo/StreamMusic) a beautifully designed Flutter NAS music player whose UI and UX inspired this project
- [Navidrome](https://www.navidrome.org/) the outstanding open-source Subsonic server
- [Radix UI](https://www.radix-ui.com/) · [TanStack Query](https://tanstack.com/query) · [Zustand](https://github.com/pmndrs/zustand)

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

Built by [N1KO](https://github.com/baogutang) · also check out **[N1KO-API](https://token.baogutang.top)**

If N1KO MUSIC is useful to you, a ⭐ means the world.

</div>
