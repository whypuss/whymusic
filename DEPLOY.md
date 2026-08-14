# MusicFree Web 部署指南

> 用浏览器搜尋和播放音樂。支援 Audiomack、YouTube、猫耳FM 等多個音源。
> 基於開源專案 [MusicFree](https://github.com/maotoumao/MusicFree) 的插件系統。

---

## 先看這個：兩種部署方式，揀一個

| | **方案 A：VPS / 自建伺服器** | **方案 B：Cloudflare Pages** |
|---|---|---|
| 費用 | 一臺 VPS（$3-5/月） | **免費** |
| 音源 | ✅ 全部（Audiomack + YouTube + 猫耳FM + 更多） | ⚠️ 僅 Audiomack |
| 插件系統 | ✅ 支援第三方插件 | ❌ 不支援 |
| 難易度 | 中等（要配 nginx） | 簡單（幾條命令） |
| 適合 | 想要完整功能 | 只想快速用起來聽歌 |

> **新手建議：** 先試 Cloudflare Pages（免費、5 分鐘搞定）。想要全部音源再升級到 VPS。

---

## 方式一：Cloudflare Pages（推薦新手）

### 你需要

- 一個 Cloudflare 帳號（[註冊](https://dash.cloudflare.com/sign-up)）
- 一臺電腦（Mac / Windows / Linux 都行）
- 會用終端機（Terminal / PowerShell）

### 第一步：準備工具（3 分鐘）

```bash
# 安裝 Node.js（如果還沒有）
# 去 https://nodejs.org 下載 LTS 版本

# 安裝 pnpm 和 wrangler
npm install -g pnpm wrangler
```

### 第二步：克隆程式碼

```bash
git clone https://github.com/whypuss/musicweb.git
cd musicweb
pnpm install
```

### 第三步：設定 Cloudflare

```bash
# 用瀏覽器登入你的 Cloudflare 帳號
wrangler login
```

### 第四步：設定 Audiomack 憑證

Audiomack 的搜尋功能需要 OAuth 憑證。程式碼內建了占位符，需要你自己填：

```bash
cd packages/web

# 設定搜尋憑證（按提示輸入）
wrangler secret put AUDIOMACK_OAUTH_CONSUMER_KEY
wrangler secret put AUDIOMACK_OAUTH_SECRET
```

> **Consumer Key 填 `audiomack-js`**（Audiomack 官方 App 使用的公開 Key）。
> **Secret** 需要從 audiomack.com 取得——程式碼裡的占位符 `"REPLACE_WITH_YOUR_AUDIOMACK_SECRET"` 不能直接用。如果沒有自己的 secret，Audiomack 搜尋功能會返回 401 錯誤。

### 第五步：部署

```bash
pnpm build
wrangler pages deploy dist --project-name=musicweb
```

部署成功後，你會得到一個類似 `https://musicweb-xxxx.pages.dev` 的網址。用瀏覽器打開就能用了！

### 之後更新程式碼

```bash
git pull
pnpm build
wrangler pages deploy dist --project-name=musicweb
```

---

## 方式二：VPS / 自建伺服器（完整功能）

### 你需要

- 一臺 Linux 伺服器（VPS），推薦 Ubuntu 22.04 / 20.04
- SSH 登入權限
- 一個域名（可选，但建議有——用 HTTPS）

### 第一步：伺服器基本準備

SSH 登入你的 VPS：

```bash
ssh root@你的伺服器IP
```

然後安裝基本工具：

```bash
# 更新系統
apt update && apt upgrade -y

# 安裝 Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# 安裝 pnpm 和 nginx
npm install -g pnpm
apt install -y nginx

# 確認安裝成功
node -v        # 應該顯示 v20.x
pnpm -v        # 應該顯示 8.x 或更高
nginx -v       # 應該顯示 nginx 版本
```

### 第二步：準備程式碼

```bash
# 建立目錄並克隆
mkdir -p /var/www
cd /var/www
git clone https://github.com/whypuss/musicweb.git musicweb
cd musicweb

# 安裝依賴並編譯
pnpm install
pnpm build
```

編譯完成後，前端檔案在 `packages/web/dist/`。

### 第三步：設定環境變數

```bash
# 建立環境變數檔案（別人看不到）
sudo nano /etc/musicweb.env
```

輸入以下內容，然後按 `Ctrl+O` 儲存、`Ctrl+X` 離開：

```
AUDIOMACK_SEARCH_CONSUMER_KEY=audiomack-js
AUDIOMACK_SEARCH_SECRET=你的搜尋secret
AUDIOMACK_MEDIA_CONSUMER_KEY=audiomack-web
AUDIOMACK_MEDIA_SECRET=你的媒體secret
```

> ⚠️ **不要留空！** `REPLACE_WITH_YOUR_SECRET` 是占位符，不是真實密碼。如果你沒有自己的 Audiomack OAuth 憑證，搜尋功能會出錯。

設定檔案權限（防止其他人讀取）：

```bash
sudo chmod 600 /etc/musicweb.env
```

### 第四步：建立系統服務（讓程式自動運行）

建立服務檔案：

```bash
sudo nano /etc/systemd/system/musicweb.service
```

複製貼上以下內容：

```ini
[Unit]
Description=MusicFree Web Server
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/musicweb/packages/web
ExecStart=/usr/bin/node scripts/server.mjs
Restart=always
RestartSec=5
EnvironmentFile=/etc/musicweb.env

[Install]
WantedBy=multi-user.target
```

啟動服務：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now musicweb
sudo systemctl status musicweb
```

看到 `active (running)` 就成功了！

> 伺服器現在監聽 **`http://你的IP:8788`**。先不用管，下面配 nginx 會幫你改成正常端口。

### 第五步：設定 Nginx（HTTPS + 反向代理）

如果有域名，先把域名指向你的伺服器 IP（在域名管理後台加一條 A 記錄）。

建立 Nginx 配置：

```bash
sudo nano /etc/nginx/sites-available/musicweb
```

複製以下配置（**記得改 `server_name` 為你的域名**）：

```nginx
server {
    listen 443 ssl http2;
    server_name music.yourdomain.com;    # ← 改成你的域名

    ssl_certificate     /etc/letsencrypt/live/music.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/music.yourdomain.com/privkey.pem;

    root /var/www/musicweb/packages/web/dist;
    index index.html;

    # API 請求轉發給後端伺服器
    location /api/ {
        proxy_pass http://127.0.0.1:8788;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;

        # 音頻串流需要關閉緩衝
        proxy_buffering off;
        proxy_request_buffering off;
        proxy_read_timeout 60s;
        proxy_send_timeout 60s;

        # 允許跨域
        add_header Access-Control-Allow-Origin "*" always;
        add_header Access-Control-Allow-Methods "GET, POST, OPTIONS" always;
        add_header Access-Control-Allow-Headers "*" always;
    }

    # 靜態檔案緩存
    location /assets/ {
        try_files $uri =404;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # 前端頁面
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

儲存後啟用：

```bash
sudo ln -sf /etc/nginx/sites-available/musicweb /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

### 第六步：設定 HTTPS 憑證（免費）

```bash
# 安裝 certbot
apt install -y certbot python3-certbot-nginx

# 申請憑證（會自動修改 nginx 配置）
sudo certbot --nginx -d music.yourdomain.com
```

按提示輸入 Email，然後選 2（自動重定向 HTTP 到 HTTPS）。

### 完成！

用瀏覽器訪問 `https://music.yourdomain.com`，開始聽歌！

---

## 常見問題

**Q: 搜尋沒有結果，顯示 401 錯誤？**
A: Audiomack 憑證沒有設定正確。檢查 `/etc/musicweb.env` 或 Cloudflare secrets 是否填了真實的 secret（不能是 `REPLACE_WITH_YOUR_SECRET`）。

**Q: 音頻播放到一半斷了？**
A: 如果是 VPS 部署，檢查 nginx 配置中的 `proxy_buffering off;` 和 `proxy_read_timeout 60s;` 有沒有設定。

**Q: Cloudflare Pages 能搜尋 YouTube 嗎？**
A: 不行。Pages 版本只支援 Audiomack。想搜尋 YouTube、猫耳FM 等其他音源，需要 VPS 部署。

**Q: 怎麼更新程式碼？**
A:
```bash
cd /var/www/musicweb
git pull
pnpm build
sudo systemctl restart musicweb
```

**Q: 沒有 Audiomack OAuth 憑證能用嗎？**
A: 前端頁面能打開，但搜尋和播放 Audiomack 歌曲時會失敗。其他透過後端代理的音源（YouTube 等）也需要各自的憑證。建議至少找到 Audiomack 的 OAuth secret。

---

## 故障排除速查

| 問題 | 原因 | 解決方法 |
|------|------|---------|
| 頁面打不開 | nginx 沒啟動 | `sudo systemctl status nginx` |
| API 404 | nginx `proxy_pass` 地址錯誤 | 確認是 `http://127.0.0.1:8788` |
| 搜尋 401 | OAuth 憑證錯誤 | 檢查 `.env` / secrets |
| 播放中斷 | nginx 緩衝沒關 | 加 `proxy_buffering off;` |
| HTTPS 不通 | SSL 憑證沒設定 | 跑 `certbot --nginx` |

---

## License

MIT