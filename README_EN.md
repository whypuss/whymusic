<div align="center">

# 🎵 WhyMusic

**A minimalist, modern, browser-native lossless streaming music player.**  
Listen, search, play, favorite, download, and sync playlists directly in your browser without installing native apps.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![React](https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react&logoColor=black)](https://reactjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-CSS-38B2AC?style=flat-square&logo=tailwind-css&logoColor=white)](https://tailwindcss.com/)
[![Cloudflare Pages](https://img.shields.io/badge/Deploy-Cloudflare%20Pages-F38020?style=flat-square&logo=cloudflare&logoColor=white)](https://pages.cloudflare.com/)
[![PWA Ready](https://img.shields.io/badge/PWA-Ready-5A0FC8?style=flat-square&logo=pwa&logoColor=white)](https://web.dev/progressive-web-apps/)

[繁體中文](README.md) • [English](README_EN.md) • [简体中文](README_ZH.md) • [日本語](README_JA.md)

</div>

---

## 🌟 What is WhyMusic?

**WhyMusic** is a high-performance audio player designed to run entirely within modern web browsers. The foundational philosophy of this project is **strict architectural decoupling between the player frontend and music sources**:

- **Zero Built-in Sources**: The repository and its compiled builds contain zero music source APIs, copyrighted tracks, or proprietary keys. The frontend has no intrinsic knowledge of any music provider—it only asks via a plugin interface: *"Give me a playable stream URL."*
- **Micro-Sandboxed Plugins**: User-provided plugins are written in standard CommonJS and execute inside a restricted `new Function` sandbox in the browser. The sandbox permits only `fetch`, timers, `URL`, `btoa/atob`, and `console`, strictly isolating access from `window`, `document`, and sensitive storages.
- **Persistent Mobile Background Playback**: Employs an ingenious **Dual-Audio element alternating buffer** to eliminate session invalidation and playback dropouts when switching tracks on iOS Safari and Android lock screens.

---

## ✨ Key Features

### 1. Dual-Audio Alternating Buffer (Lock-Screen Continuity)
- Changing `audio.src` in the background often tears down the browser's audio session, causing mobile playback to pause automatically when the screen is locked.
- WhyMusic preloads the next song into an idle secondary `<audio>` element while in the foreground. Switching tracks merely invokes `.play()` on the preloaded element without reconnecting network streams.
- Complete **MediaSession API** integration: Full control via lock screen widgets, control center, notifications, and headset buttons, complete with dynamic high-resolution artwork and live lyrics.

### 2. Cross-Source Fallback & Query Normalization
- Plugins support concurrent fan-out across multiple sub-sources, deduplicating identical song titles and artists.
- **Traditional/Simplified Chinese Normalization**: Search queries are normalized so that searching in Traditional Chinese effortlessly hits Simplified Chinese catalog entries.
- **Dynamic Fallback**: If an audio stream fails to decode (e.g. CDN geo-blocking 403 or unsupported container formats), the player dynamically flags the failed sub-source and retries the same track on alternate available sub-sources.

### 3. Apple-Inspired Modern Aesthetic
- Default Apple dark-mode UI: bold typography, blurred frosted glass bottom dock, floating dynamic mini-player card, and fluid animations.
- Dynamic full-screen synchronized lyric roll.

### 4. Playlist Portability & Account-Free Sync
- **Universal Markdown Export/Import**: Export your favorite songs as clean, human-readable Markdown notes. An invisible JSON payload is embedded inside an HTML comment at the bottom, enabling 100% exact restoration of IDs and sources when imported into any WhyMusic instance.
- **Plain-Text Playlist Parser**: Paste any arbitrary plain-text list (up to 200 lines of `Title - Artist`); the system automatically parses and matches each entry.
- **Account-Free 8-Digit Device Sync**: Generate an ephemeral 8-character pairing code to instantly migrate installed plugins to another device within 24 hours. Zero personal data collected.

### 5. Read-Only WebDAV Facade
- Built-in RFC 4918 compliant read-only WebDAV service (`/dav`).
- Easily mountable into native iOS players like **Everplay** or **Evermusic**, exposing charts as directories and songs as standard `.mp3` with matching `.lrc` sidecar lyrics.

---

## 🏗️ Architecture

```
whymusic/
├── packages/
│   └── web/
│       ├── src/
│       │   ├── musicApp.ts        # Global state machine & audio controller
│       │   ├── App.tsx            # Main shell & responsive router
│       │   ├── ui/AppleUI.tsx     # Default Apple-inspired frosted glass UI
│       │   └── core/              # DualPlayer / PluginManager / Sandbox
│       ├── worker/                # Cloudflare Pages Functions backend
│       │   └── index.js           # Route dispatcher & CORS proxy (/api/proxy)
│       ├── scripts/server.mjs     # Standalone Node.js server (zero dependencies)
│       └── wrangler.toml          # Cloudflare Pages & KV bindings
├── scripts/                       # Cross-platform build & packaging scripts
├── capacitor.config.json          # Android native container configuration
└── DEPLOY.md                      # Comprehensive deployment manual
```

### Technology Stack

| Domain | Technology | Purpose |
| :--- | :--- | :--- |
| **Frontend** | React 18 + TypeScript + Vite | Millisecond rendering & strict type safety |
| **Styling** | Tailwind CSS + Lucide Icons | Responsive frosted-glass dark theme |
| **Serverless** | Cloudflare Pages / Workers | Global Anycast edge deployment with zero hosting cost |
| **Self-Hosted** | Native Node.js Server | Single-file launch with zero external npm dependencies |
| **Cross-Platform** | PWA + Capacitor (Android) | Installable home screen app & standalone APK support |

---

## 🚀 Quick Start

### Option 1: Cloudflare Pages (Recommended, 100% Free)

1. **Install dependencies & log in**:
   ```bash
   npm install -g pnpm wrangler
   git clone https://github.com/whypuss/whymusic.git
   cd whymusic
   pnpm install
   wrangler login
   ```

2. **One-command build & deploy**:
   ```bash
   pnpm deploy:cf
   ```

> 💡 **No-tooling Deployment**: Download `musicweb-cf.zip` directly from [Releases](../../releases) and drag-and-drop it into your Cloudflare Pages dashboard.

### Option 2: Linux VPS / Docker Self-Hosting

```bash
# Launch the built-in standalone server (services static assets + /api proxy on port 8788)
node packages/web/scripts/server.mjs
```

See [DEPLOY.md](DEPLOY.md) for full configuration details including Nginx reverse proxy, Systemd service, and WebDAV credentials.

---

## 🧩 Plugin Interface Specification

This repository does not ship with music source plugins. Users must navigate to the **Settings** view and supply their own CommonJS plugin URL:

```javascript
module.exports = {
  platform: "CustomSource",
  version: "1.0.0",
  // 1. Search capability
  async search(query, page, type) {
    // Returns { isEnd: boolean, data: TrackItem[] }
  },
  // 2. Resolve audio media stream URL
  async getMediaSource(musicItem, quality) {
    // Returns { url: "https://..." }
  },
  // 3. Lyrics & Artwork resolution (Optional)
  async getLyric(musicItem) { /* Returns { rawLrc: string } */ },
  async getMusicArtwork(musicItem) { /* Returns { artwork: string } */ }
};
```

---

## 📱 Mobile Recommendations

- **iOS Users**: It is strongly recommended to use **Safari** directly. Add to Home Screen as a shortcut rather than running in standalone mode, as iOS strictly limits background audio sessions in web app standalone containers.
- **Android Users**: Install as a PWA via Chrome/Edge ("Install App" or "Add to Home Screen"). Ensure that "Allow background activity" and "Lock screen notifications" permissions are granted in system settings.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).  
Created, architected, and maintained by [@whypuss](https://github.com/whypuss).
