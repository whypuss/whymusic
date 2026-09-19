<div align="center">

# 🎵 WhyMusic

**极简、现代、纯浏览器运行的无损流媒体音乐播放器**  
无需安装 App，即开即用。搜索、播放、收藏、下载、歌单同步一站式体验。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![React](https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react&logoColor=black)](https://reactjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-CSS-38B2AC?style=flat-square&logo=tailwind-css&logoColor=white)](https://tailwindcss.com/)
[![Cloudflare Pages](https://img.shields.io/badge/Deploy-Cloudflare%20Pages-F38020?style=flat-square&logo=cloudflare&logoColor=white)](https://pages.cloudflare.com/)
[![PWA Ready](https://img.shields.io/badge/PWA-Ready-5A0FC8?style=flat-square&logo=pwa&logoColor=white)](https://web.dev/progressive-web-apps/)

[繁體中文](README.md) • [English](README_EN.md) • [简体中文](README_ZH.md) • [日本語](README_JA.md)

</div>

---

## 🌟 这是什么？

**WhyMusic** 是一个直接运行在现代浏览器中的高性能音乐播放器。本项目核心设计理念是**“播放器核心与音源架构彻底解耦”**：

- **出厂纯净零音源（Zero Built-in Sources）**：项目本身不携带、不托管、不提供任何版权音频文件或第三方音源接口。前端不认识任何具体音乐平台，仅通过一层标准化插件接口询问：“请给我一个可播放的 URL”。
- **极致安全微沙箱（Micro Sandbox）**：用户自行提供的插件为标准 CommonJS 规范，在浏览器端受控的 `new Function` 沙箱中隔离运行。沙箱严格限制权限（仅开放 `fetch`、定时器、`URL`、`btoa/atob` 与 `console`），彻底阻断对 `window`、`document` 与敏感存储区的直接访问。
- **手机后台持久播放（Dual-Audio Buffering）**：独创**双 Audio 元素双缓冲轮替机制**，彻底解决 iOS Safari 与 Android 浏览器在后台/锁屏切换 URL 时 Session 中断暂停的痛点。

---

## ✨ 核心亮点

### 1. 双 Audio 元素无缝轮替（攻克锁屏断播）
- 浏览器在后台切换音频 `src` 会导致音频会话失效，这正是手机锁屏播放容易断音的元凶。
- WhyMusic 在前台预先将下一首歌加载至空闲的 Audio 元素中，切换曲目时直接触发已就绪元素的 `play()`，不中断网络与音频通道。
- 完整接入系统级 **MediaSession API**：锁屏界面、控制中心、下拉通知栏、耳机线控（上一首/下一首/暂停/播放/快进）全功能支持，并动态呈现高品质专辑封面与实时歌词。

### 2. 跨子源自动救援与繁简智能归一化
- 插件支持并发扇出与多子源聚合，同名同歌手智能去重。
- **繁简归一化**：搜索时自动转化，查询繁体“浮誇”能无缝匹配简体源“浮夸”。
- **动态播放救援**：当某一子源给出的 URL 在特定地区被 CDN 403 阻挡或格式不支持时，播放器会自动将该子源标记并回退重试其他可用子源。

### 3. Apple 现代质感 UI
- 默认采用简约克制的 Apple 深色质感界面：大字号标题、精致半透明毛玻璃底栏（Frosted Glass Dock）、悬浮微型播放卡片与流畅转场。
- 支持全屏动态歌词滚动展开。

### 4. 歌单管理与无账号换机同步
- **无依赖 Markdown 导入/导出**：歌单可一键导出为通用的 Markdown 文本，任何文本编辑器均可打开阅读；文末内嵌隐藏式 JSON 标记，在任何 WhyMusic 实例重新导入即可 100% 精准还原歌曲 ID 与指定子源。
- **纯文本歌单解析**：支持粘贴任意“歌名 - 歌手”纯文本清单（上限 200 首），系统自动匹配解析。
- **无账号 8 码换机配对**：生成 24 小时有效配对码，另一台设备输入即可自动同步已安装的音源插件，不收集任何用户隐私。

### 5. 只读 WebDAV 串流门面
- 内置符合 RFC 4918 规范的只读 WebDAV 服务（`/dav`）。
- 可直接挂载至 iOS 原生播放器（如 **Everplay**、**Evermusic**），将在线曲库与推荐榜单映射为本地音乐文件夹与 `.lrc` 歌词外挂，在原生播放器中享受流媒体。

---

## 🏗️ 技术架构

```
whymusic/
├── packages/
│   └── web/
│       ├── src/
│       │   ├── musicApp.ts        # 全局状态机与核心播放控制器
│       │   ├── App.tsx            # 主外壳与响应式路由
│       │   ├── ui/AppleUI.tsx     # 默认 Apple 现代毛玻璃深色界面
│       │   └── core/              # DualPlayer 播放器 / PluginManager 插件沙箱
│       ├── worker/                # Cloudflare Pages Functions 后端
│       │   └── index.js           # 路由分发与跨域代理 (/api/proxy)
│       ├── scripts/server.mjs     # 私有 VPS 专用 Node.js 服务器 (零外部依赖)
│       └── wrangler.toml          # Cloudflare Pages 与 KV Binding 配置
├── scripts/                       # 跨端构建与打包脚本
├── capacitor.config.json          # Android 原生容器配置
└── DEPLOY.md                      # 完整部署指南
```

### 技术栈一览

| 维度 | 选型 | 特性 |
| :--- | :--- | :--- |
| **前端应用** | React 18 + TypeScript + Vite | 毫秒级极速渲染、严格类型安全 |
| **样式系统** | Tailwind CSS + Lucide Icons | 现代深色主题、流畅磨砂玻璃质感、全端自适应 |
| **无服务器** | Cloudflare Pages / Workers | 全球 Anycast CDN 低延迟分发、完全免费部署 |
| **私有部署** | Node.js 原生服务器 | 零外部 npm 依赖，单文件极速启动 |
| **跨端支持** | PWA + Capacitor (Android) | 支持添加到主屏幕与原生 APK 打包 |

---

## 🚀 快速开始

### 部署方式一：Cloudflare Pages（推荐，完全免费）

1. **安装依赖并登录**：
   ```bash
   npm install -g pnpm wrangler
   git clone https://github.com/whypuss/whymusic.git
   cd whymusic
   pnpm install
   wrangler login
   ```

2. **一键构建并部署**：
   ```bash
   pnpm deploy:cf
   ```

> 💡 **免工具直接部署**：前往项目 [Releases](../../releases) 下载现成的 `musicweb-cf.zip`，在 Cloudflare Pages 仪表盘拖拽上传即可完成部署。

### 部署方式二：Linux VPS / Docker 私有化自建

```bash
# 启动自托管原生服务（同时提供前端静态页面与 /api 代理，默认端口 8788）
node packages/web/scripts/server.mjs
```

完整部署环境（含 Nginx 反向代理、Systemd 服务托管与 WebDAV 配置）请查阅 [DEPLOY.md](DEPLOY.md)。

---

## 🧩 音源插件规范

本播放器出厂不随附任何音源。用户部署后，需前往 **“设置”** 界面粘贴兼容的 CommonJS 音源插件链接。插件核心接口定义如下：

```javascript
module.exports = {
  platform: "自定义音源名称",
  version: "1.0.0",
  // 1. 搜索接口
  async search(query, page, type) {
    // 返回 { isEnd: boolean, data: TrackItem[] }
  },
  // 2. 音频直链解析
  async getMediaSource(musicItem, quality) {
    // 返回 { url: "https://..." }
  },
  // 3. 歌词与封面解析 (可选)
  async getLyric(musicItem) { /* 返回 { rawLrc: string } */ },
  async getMusicArtwork(musicItem) { /* 返回 { artwork: string } */ }
};
```

---

## 📱 移动端使用建议

- **iOS 用户**：强烈建议直接使用 **Safari** 浏览器聆听，点击分享按钮“添加到主屏幕”作为快捷方式。切勿开启独立全屏 standalone 模式（iOS 限制 standalone 模式后台音频保活）。
- **Android 用户**：建议在 Chrome / Edge 中点击“安装应用”或“添加到主屏幕”为 PWA 应用，并确保授予该应用“允许后台活动”与“锁屏通知”权限。

---

## 📄 开源许可证

本项目基于 [MIT License](LICENSE) 协议开源发布。  
由 [@whypuss](https://github.com/whypuss) 独立构思、架构设计并维护。
