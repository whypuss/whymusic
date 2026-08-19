# WhyMusic 部署指南

> 用瀏覽器搜尋、播放、下載音樂。基於 [MusicFree](https://github.com/maotoumao/MusicFree) 的插件系統。
> 專案說明見 [README.md](README.md)。

---

## 先選一種

| | **A：Cloudflare Pages** | **B：拖拉 zip** | **C：VPS 自建** |
|---|---|---|---|
| 費用 | 免費 | 免費 | 一臺 VPS |
| 需要裝工具 | Node + pnpm + wrangler | **不需要** | Node + nginx |
| 功能 | 完整 | 完整 | 完整 |
| 更新方式 | `pnpm deploy:cf` | 重新上傳 zip | `git pull` + 重啟 |
| 設定方式 | 改 `packages/web/worker/why.js` 常數 | 同 A | 環境變數 |
| 上游快取 | 只在單一 isolate 內 | 同 A | 全站共用 |

三種方式功能相同 —— CF 版把子源扇出、繁簡歸一化、跨子源救援全部移植過去了。

> **不需要任何金鑰或環境變數。** 兩個子音源（netease / joox）都走公開 API。

**所有方式部署完成後，都要先到「設置」頁安裝音源** —— app 出廠不帶音源，
不裝就搜不到也播不了。網址是 `/plugins/whymusic.js`，該頁點一下會自動填入。

---

## 方式 A：Cloudflare Pages

### 1. 準備

```bash
npm install -g pnpm wrangler
git clone https://github.com/whypuss/musicweb.git
cd musicweb
pnpm install
wrangler login
```

### 2. 建立專案（只需一次）

到 Cloudflare 儀表板 → Workers & Pages → Create → Pages → **Upload assets**，
取一個名字（例如 `whymusicweb`），隨便上傳一次空內容建立專案即可。

然後把 `package.json` 裡 `deploy:cf` 的 `--project-name=whymusicweb` 改成你的名字。

### 3. 部署

```bash
pnpm deploy:cf
```

這一個指令做完四件事：編譯前端 → 把 API 打包成 `dist/_worker.js` →
把音源插件複製進 `dist/plugins/` → 上傳。

完成後開啟 `https://<專案名>.pages.dev`。

### 之後更新

```bash
git pull
pnpm deploy:cf
```

### 換裝置的配對碼（可選）

「設置」→ 換裝置 需要一個 KV 儲存。沒設定的話那一區會整個隱藏，其餘功能不受影響。

```bash
cd packages/web
wrangler kv namespace create SYNC
```

把回傳的 id 填進 `packages/web/wrangler.toml`：

```toml
[[kv_namespaces]]
binding = "SYNC"
id = "你拿到的 id"
```

再 `pnpm deploy:cf` 一次即可。確認方式：`curl -s https://你的站/api/version` 回應裡的
`sync` 應為 `true`。

> **為什麼不是 push 就自動部署**：用 wrangler 建立的專案屬於 Direct Upload，
> Cloudflare 不允許事後改接 Git（官方文件明載這是單向選擇）。
>
> 要 push 自動部署，得在儀表板另建一個 **Git 連動**的專案，並且：
> - 建置指令設成 **`pnpm build:cf`**（不是 `pnpm build`）
> - 輸出目錄設成 **`packages/web/dist`**
>
> 用 `pnpm build` 會踩到一個很難查的坑：它不產生 `_worker.js` 也不複製
> `plugins/`，結果所有 `/api/*` 會落到 SPA fallback 回 index.html，
> 整站搜不到也播不了 —— 但首頁看起來完全正常。

---

## 方式 B：打包 zip 給別人上傳

適合要把站交給不會用命令列的人。

```bash
pnpm install
pnpm build:zip      # → dist-cf/musicweb-cf.zip（約 0.45 MiB，12 個檔）
```

把 zip 交給對方，他只要：

1. Cloudflare 儀表板 → Workers & Pages → Create → Pages
2. 選 **Upload assets**（Direct Upload），取個專案名
3. 把 zip **整包拖進去**（不用解壓）
4. 開啟 `<專案名>.pages.dev`，到「設置」頁安裝音源

zip 內已附 `README.txt` 說明。

> **為什麼要打包成單一 `_worker.js`**：儀表板的拖拉／zip 上傳**不會編譯
> `functions/` 目錄**（官方文件明載那條路必須用 wrangler），但單一 `_worker.js`
> 兩種方式都支援。所以整個專案的後端就統一成一個 `_worker.js`，Git 建置、
> wrangler、zip 三條路走同一份程式碼。
>
> 拖拉上傳的限制：單檔 25 MiB、檔案數 1000 —— 本包遠低於此。

---

## 方式 C：VPS / 自建伺服器

後端 `packages/web/scripts/server.mjs` **零外部依賴**（只用 Node 內建模組），
同時服務前端靜態檔與 API，預設監聽 `:8788`。

### 1. 伺服器準備

```bash
# Node 20+（Alpine 用 apk add nodejs npm）
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs nginx
npm install -g pnpm
```

### 2. 取得程式碼並編譯

```bash
mkdir -p /var/www && cd /var/www
git clone https://github.com/whypuss/musicweb.git musicweb
cd musicweb
pnpm install
pnpm build
```

> **若是從本機上傳而非在機器上 clone，三樣都要傳：**
> - `packages/web/dist/`（前端）
> - `packages/web/scripts/server.mjs`（後端）
> - **`plugins/`（音源插件）**
>
> 少了 `plugins/` 的話 `/plugins/whymusic.js` 會回 404，音源裝不起來，
> 整站不能搜尋或播放。插件目錄預設是 repo 根層的 `plugins/`，可用
> `PLUGINS_DIR` 覆寫。

### 3. 環境變數（全部可選）

```bash
sudo nano /etc/whymusic.env
sudo chmod 600 /etc/whymusic.env
```

| 變數 | 預設 | 說明 |
|------|------|------|
| `PORT` | `8788` | 監聽埠 |
| `PLUGINS_DIR` | repo 的 `plugins/` | 音源插件目錄 |
| `WHY_MUSIC_SOURCES` | `netease,joox` | 啟用的子音源 |
| `WHY_MUSIC_BITRATE` | `320` | 預設音質（kbps，僅 GD 子源適用） |
| `GD_API_URL` | `https://music-api.gdstudio.xyz/api.php` | GD 上游位址 |
| `SYNC_DIR` | repo 的 `.sync/` | 裝置配對碼的暫存目錄 |
| `BUILD_STAMP` | 啟動時問 git | 建置戳記。從本機上傳（機器上沒有 git 工作區）時要傳，否則版本區塊會誤報前後端不一致 |

完整範例見 [.env.example](.env.example)。

### 4. 系統服務

**systemd（Ubuntu / Debian）**

```ini
# /etc/systemd/system/whymusic.service
[Unit]
Description=WhyMusic Server
After=network.target

[Service]
Type=simple
WorkingDirectory=/var/www/musicweb/packages/web
ExecStart=/usr/bin/node scripts/server.mjs
Restart=always
RestartSec=5
EnvironmentFile=-/etc/whymusic.env

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now whymusic
sudo systemctl status whymusic
```

**OpenRC（Alpine）**

```sh
#!/sbin/openrc-run
name="WhyMusic"
command="/usr/bin/node"
command_args="packages/web/scripts/server.mjs"
command_background="true"
directory="/var/www/musicweb"
pidfile="/run/whymusic.pid"
output_log="/var/log/whymusic.log"
error_log="/var/log/whymusic.log"

export PORT=8788

depend() { need net; }
```

```sh
chmod +x /etc/init.d/whymusic
rc-update add whymusic default   # 少了這行重開機不會自動起
rc-service whymusic start
```

> OpenRC 沒有 `command_env` 這個變數 —— 要傳環境變數就用 `export`。
> 曾經踩過：寫成 `command_env="PORT=8443 ..."` 完全沒有生效，PORT 仍是預設值。

### 5. Nginx 反向代理

```nginx
server {
    listen 80;
    server_name music.example.com;

    client_max_body_size 200m;
    # 音頻串流必須關掉緩衝，否則會播到一半斷
    proxy_buffering off;
    proxy_request_buffering off;
    proxy_read_timeout 600s;
    proxy_send_timeout 600s;

    location / {
        proxy_pass http://127.0.0.1:8788;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

```bash
sudo ln -sf /etc/nginx/sites-available/whymusic /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

後端本身就會服務前端靜態檔，所以整站交給它就行，不必另外設 `root`。

### 6. HTTPS

```bash
apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d music.example.com
```

---

## 常見問題

**Q: 開站後搜尋顯示「搜尋需要音源」？**
A: 正常 —— app 出廠不帶音源。到「設置」頁，點「內建音源：/plugins/whymusic.js」
把網址填入，按「安裝」即可。裝過一次會存進 localStorage，之後開啟自動載入。

**Q: 所有 `/api/*` 都回 HTML，首頁卻正常？**
A: `_worker.js` 沒被部署（CF）或 API 路由沒生效。CF 版請確認用的是
`pnpm build:cf` 而非 `pnpm build`。

**Q: `/plugins/whymusic.js` 回 404？**
A: 部署時漏了 `plugins/` 目錄。CF 版用 `build:cf` 會自動複製；自建版要確認
`plugins/` 有上傳，或用 `PLUGINS_DIR` 指到正確位置。

**Q: 換版後看到的還是舊介面／舊行為？**
A: 硬重載一次。API 回應已帶 `Cache-Control: no-store`，前端資源檔名帶內容雜湊，
理論上不會卡快取；但瀏覽器可能還留著舊的 index.html。

**Q: 播放某些歌會失敗？**
A: 部分曲目在兩個子音源都取不到可播的音源。若某個子源給了 URL 但實際播不出來，
會自動換另一個子源重試同一首歌；兩個都不行才放棄。自動續播會跳過它繼續，
你自己點的那首失敗時會彈窗告知。

**Q: 音頻播到一半斷？**
A: 自建版檢查 nginx 有沒有 `proxy_buffering off;`。

**Q: 怎麼確認線上跑的是哪一版？**
A: 「設置」頁底部的「版本」區塊會顯示前端與後端各自的建置戳記。兩者應一致；
不一致代表只部署了一半（例如前端上去了但後端沒有），而不是快取問題。
也可以直接問後端：
```bash
curl -s https://你的站/api/version
```

---

## 故障排除速查

| 問題 | 原因 | 解決 |
|------|------|------|
| 搜尋顯示「需要音源」 | 還沒安裝音源 | 「設置」頁貼 `/plugins/whymusic.js` 安裝 |
| `/api/*` 回 HTML | `_worker.js` 沒部署 | 用 `pnpm build:cf` 重新部署 |
| `/plugins/*.js` 404 | 漏傳 `plugins/` | 補上，或設 `PLUGINS_DIR` |
| 播放中斷 | nginx 緩衝沒關 | 加 `proxy_buffering off;` |
| 重開機後站掛掉 | 服務沒設開機自啟 | `systemctl enable` / `rc-update add` |

---

## License

MIT
