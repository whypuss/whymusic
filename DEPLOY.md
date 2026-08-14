# MusicFree Web 部署指南

> **MusicFree Web** — 基於 MusicFree 插件系統的 Web 版音樂播放器  
> 搜尋 → 播放音樂，支援 Audiomack / YouTube / 猫耳FM 等多音源

---

## 目錄

- [專案結構](#專案結構)
- [方式一：自托管伺服器（推薦，完整功能）](#方式一自托管伺服器推薦完整功能)
- [方式二：Cloudflare Pages（免費，僅前端+Edge API）](#方式二cloudflare-pages免費僅前端edge-api)
- [環境變數說明](#環境變數說明)
- [常見問題](#常見問題)

---

## 專案結構

```
musicweb/
├── packages/
│   ├── core/                 # 共享核心（Player、PluginManager）
│   └── web/                  # Web 前端 + 後端
│       ├── src/              # React + TypeScript 前端
│       ├── functions/api/    # Cloudflare Pages Functions（Edge API）
│       ├── scripts/
│       │   ├── server.mjs    # ★ 自托管伺服器（Node.js 全功能後端）
│       │   └── dev-proxy.mjs # 本地開發用代理
│       ├── wrangler.toml     # Cloudflare Pages 設定
│       └── package.json
├── .env.example              # 環境變數範本（複製為 .env 使用）
├── DEPLOY.md                 # 本文件
└── package.json              # pnpm workspace 根設定
```

### 兩種部署差異

| 特性 | 自托管 (VPS) | Cloudflare Pages |
|------|-------------|-----------------|
| 插件系統（全插件搜索） | ✅ | ❌ |
| 音源代理（`/api/play` 流式播放） | ✅ | ❌ |
| Audiomack OAuth 搜尋 | ✅ | ✅ |
| 靜態前端 | ✅ | ✅ |
| 費用 | 自付伺服器 | 免費 |
| 適合 | 完整功能生產環境 | 僅需要 Audiomack 搜尋 |

---

## 方式一：自托管伺服器（推薦，完整功能）

> 適用於 VPS / 家庭伺服器 / Docker。需要 **Node.js 18+**、**nginx**。

### 前置條件

- Node.js ≥ 18（推薦 20 LTS）
- nginx 作為反代 + TLS 終止
- pnpm (`npm install -g pnpm`)

### Step 1 — 克隆並安裝依賴

```bash
git clone https://github.com/whypuss/musicweb.git
cd musicweb
pnpm install
```

### Step 2 — 設定環境變數

```bash
cp .env.example .env
# 編輯 .env，填入你的 Audiomack OAuth 憑證
# 如果沒有自己的憑證，可以保留預設的 audiomack-js / audiomack-web（Audiomack 官方公開範例）
```

需要的環境變數：

| 變數 | 用途 | 預設值 |
|------|------|--------|
| `AUDIOMACK_SEARCH_CONSUMER_KEY` | 搜尋 API 的 Consumer Key | `audiomack-js` |
| `AUDIOMACK_SEARCH_SECRET` | 搜尋 API 的 Secret | （必填） |
| `AUDIOMACK_MEDIA_CONSUMER_KEY` | 媒體/API 的 Consumer Key | `audiomack-web` |
| `AUDIOMACK_MEDIA_SECRET` | 媒體/API 的 Secret | （必填） |

### Step 3 — 編譯前端

```bash
pnpm build
```

編譯輸出在 `packages/web/dist/`。

### Step 4 — 啟動伺服器

```bash
cd packages/web
node scripts/server.mjs
```

伺服器預設監聽 **`:8788`**，同時提供：
- 靜態前端檔案服務
- `/api/search` — Audiomack OAuth 搜尋
- `/api/media` — 取得音源 URL
- `/api/album` — 專輯詳情
- `/api/play` — 統一音源流代理（Audiomack / YouTube / 猫耳FM）
- `/api/proxy` — 通用 CORS 代理

如需修改端口，編輯 `scripts/server.mjs` 頂部的 `PORT` 常數。

### Step 5 — 配置 nginx

將以下配置存為 `/etc/nginx/sites-available/musicweb`，並修改 `server_name` 和你的域名：

```nginx
server {
    listen 443 ssl http2;
    server_name music.example.com;    # ← 改成你的域名

    ssl_certificate     /path/to/fullchain.pem;
    ssl_certificate_key /path/to/privkey.pem;

    root /var/www/musicweb;    # ← 改成 dist 的實際路徑
    index index.html;

    # ── API 反向代理到後端 ──
    location /api/ {
        proxy_pass http://127.0.0.1:8788;    # ← 如改了端口請同步
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # 流式播放需要關閉緩衝
        proxy_buffering off;
        proxy_request_buffering off;
        proxy_read_timeout 60s;
        proxy_send_timeout 60s;

        # CORS（外部前端訪問時需要）
        add_header Access-Control-Allow-Origin "*" always;
        add_header Access-Control-Allow-Methods "GET, POST, OPTIONS" always;
        add_header Access-Control-Allow-Headers "*" always;
    }

    # ── 靜態前端 ──
    location = /index.html {
        try_files $uri /index.html;
        add_header Cache-Control "no-cache, no-store, must-revalidate";
    }

    location /assets/ {
        try_files $uri =404;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

啟用並重載：

```bash
ln -sf /etc/nginx/sites-available/musicweb /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

> **注意：** 如果你把 nginx 的 `root` 指向 `dist/`，則 API 反向代理的目標應該是後端的實際端口（`:8788`）。
> 或者參考 Maxwell 的實際做法——用 `server.mjs` 直接監聽端口並同時服務靜態檔案 + API，nginx 只做 TLS 終止和單一端口反代，可減少一個轉發層。

### Step 6 — 用 systemd 守護進程（推薦）

建立 `/etc/systemd/system/musicweb.service`：

```ini
[Unit]
Description=MusicFree Web Server
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/musicweb
ExecStart=/usr/bin/node scripts/server.mjs
Restart=always
RestartSec=5
EnvironmentFile=-/etc/musicweb.env

[Install]
WantedBy=multi-user.target
```

> 使用 `EnvironmentFile=/etc/musicweb.env` 單獨存放憑證，避免把 secret 放在 repo 中。

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now musicweb
sudo systemctl status musicweb
```

### 驗證

```bash
# 本機測試
curl http://127.0.0.1:8895/        # 應返回 200 + HTML
curl http://127.0.0.1:8895/api/search?q=drake
# 外部測試（用 4G 手機或 VPN，不要從同一台 VPS curl 自己）
curl https://music.example.com/api/search?q=drake
```

---

## 方式二：Cloudflare Pages（免費，僅 Audiomack）

> 適用於只需要 Audiomack 搜尋+播放、不需要全插件系統的使用者。
> 免費額度：10 萬次請求/天。

### 前置條件

- Cloudflare 帳號
- Wrangler CLI (`npm install -g wrangler`)
- 一個已託管在 Cloudflare 的域名

### Step 1 — 安裝依賴

```bash
pnpm install
```

### Step 2 — 設定 Cloudflare 環境變數

```bash
# 登入 Cloudflare
wrangler login

# 設定 Pages Functions 使用的 secret（不會出現在 Git 中）
wrangler secret put AUDIOMACK_OAUTH_SECRET
wrangler secret put AUDIOMACK_OAUTH_CONSUMER_KEY
```

> `wrangler secret put` 比環境變數更安全——secret 只在 Cloudflare 後端儲存，不會進入部署包。

### Step 3 — 部署

```bash
cd packages/web
pnpm build
wrangler pages deploy dist --project-name=musicweb
```

部署後會得到一個類似 `https://musicweb.pages.dev` 的網址。

如需自訂域名，在 Cloudflare Dashboard 的 Pages 項目中綁定你的域名。

### 更新部署

修改程式後重新執行 Step 3 即可。

---

## 環境變數說明

| 變數名 | 部署方式 | 必填 | 說明 |
|--------|---------|------|------|
| `AUDIOMACK_SEARCH_CONSUMER_KEY` | VPS | 否（預設 audiomack-js） | 搜尋 API 的 OAuth Consumer Key |
| `AUDIOMACK_SEARCH_SECRET` | VPS | 是 | 搜尋 API 的 OAuth Secret |
| `AUDIOMACK_MEDIA_CONSUMER_KEY` | VPS | 否（預設 audiomack-web） | 媒體 API 的 OAuth Consumer Key |
| `AUDIOMACK_MEDIA_SECRET` | VPS | 是 | 媒體 API 的 OAuth Secret |
| `AUDIOMACK_OAUTH_CONSUMER_KEY` | CF Pages | 否 | CF Pages Functions 統一 key |
| `AUDIOMACK_OAUTH_SECRET` | CF Pages | 是 | CF Pages Functions 統一 secret |

> **如何取得 Audiomack OAuth 憑證？**
> Audiomack 官方未提供正式开发者申請入口。`audiomack-js` / `audiomack-web` 是其官方網站和官方 App 公開使用的 Consumer Key，對應的 Secret 已透過逆向取得並寫入程式碼。如果你希望更換，請自行逆向 audiomack.com 的最新憑證。

---

## 常見問題

### Q: 搜尋返回 400 Bad Request 或無結果？

檢查 `AUDIOMACK_*_SECRET` 是否正確設定。錯誤的 secret 會導致 OAuth 簽名失敗，Audiomack 返回 401/400。

### Q: 播放按鈕沒反應？

自托管模式下，檢查 `/api/play` 是否正常回應。用 `curl http://localhost:8788/api/play?id=<song_id>&platform=Audiomack` 測試。

### Q: 前端顯示但搜尋無結果（Cloudflare Pages）？

Pages 僅支援 Audiomack 搜尋。如果 Audiomack 搜尋無結果，嘗試中文關鍵字以外的英文關鍵字。多音源搜尋需使用自托管模式。

### Q: nginx 反代後音源播放中斷？

確保 nginx 配置中已關閉 `proxy_buffering` 和 `proxy_request_buffering`，並設定足夠的 `proxy_read_timeout`（至少 60s）。

### Q: 如何重構 `node_modules` 被錯誤 commit？

`node_modules/` 曾在早期 commit 中被誤提交。清理方式：

```bash
git rm -r --cached node_modules/
git commit -m "chore: remove node_modules from git tracking"
```

`.gitignore` 已包含 `node_modules/`，此後不會再被追蹤。

---

## 貢獻

歡迎提交 Issue 和 Pull Request。提交前請執行：

```bash
pnpm typecheck
pnpm build
```

## License

MIT