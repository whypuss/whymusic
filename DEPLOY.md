# WhyMusic 部署指南

> 用瀏覽器搜尋、播放、收藏、下載音樂。
> 專案說明見 [README.md](README.md)。

---

## 先選一種

| | **A：Cloudflare Pages** | **B：拖拉 zip** | **C：VPS / LXC / 自建** |
|---|---|---|---|
| 費用 | 免費 | 免費 | 一臺 Linux 主機 |
| 需要裝工具 | Node + pnpm + wrangler | **不需要** | Node + nginx |
| 安裝 | `pnpm deploy:cf` | 上傳 zip | `sh deploy/install.sh`（自動偵測 systemd/OpenRC） |
| 功能 | 完整 | 完整 | 完整 |
| 更新方式 | `pnpm deploy:cf` | 重新上傳 zip | `git pull` + 重跑 install.sh |
| 設定方式 | 音源自己的設定 | 同 A | 環境變數（`/etc/whymusic.env`） |
| 上游快取 | 只在單一 isolate 內 | 同 A | 全站共用 |

三種方式功能相同。音源邏輯（子源扇出、繁簡歸一化、跨子源救援）在插件裡、由瀏覽器
執行，所以三種部署共用同一份；後端只負責供應靜態檔、跨域代抓與配對碼。

> **前端與後端本身不需要任何金鑰或環境變數。** 音源要不要金鑰是那個音源的事。

**所有方式部署完成後，都要先到「設置」頁安裝音源。** 這個專案**不隨附音源**，
產物與 repo 裡都沒有任何音源檔 —— 播放器不預設任何來源，音源要用哪一個由你提供。
到「設置」頁貼上你自己的音源網址（要能被瀏覽器抓到：同源、或對方送 CORS 標頭）。

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

這一個指令做完三件事：編譯前端 → 把 API 打包成 `dist/_worker.js` → 上傳。
（不含音源 —— 產物裡不會有任何音源檔。）

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
> 用 `pnpm build` 會踩到一個很難查的坑：它不產生 `_worker.js`，
> 結果所有 `/api/*` 會落到 SPA fallback 回 index.html —— 但首頁看起來完全正常。

---

## 方式 B：打包 zip 給別人上傳

適合要把站交給不會用命令列的人。

```bash
pnpm install
pnpm build:zip      # → dist-cf/musicweb-cf.zip（不含音源）
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

## 方式 C：VPS / LXC / 自建 Linux 伺服器

後端 `packages/web/scripts/server.mjs` **零外部依賴**（只用 Node 內建模組），
同時服務前端靜態檔與 API。因此不管是 VPS、LXC 容器還是裸機 Linux，只要有
**Node ≥ 20.11**，不必編譯任何原生模組就能跑。

### 一鍵安裝

`deploy/install.sh` 會自動偵測 systemd 或 OpenRC、裝好對應的服務、建立設定檔、
啟動並做健康檢查。

```bash
# 1) 準備 Node（三選一，看你的系統）
apt install -y nodejs npm nginx          # Debian/Ubuntu（需 Node 20.11+，太舊就用 nodesource）
apk add nodejs npm nginx                 # Alpine / 多數 LXC
# dnf install -y nodejs nginx            # Fedora/RHEL

# 2) 取得程式碼
git clone https://github.com/whypuss/musicweb.git /opt/whymusic
cd /opt/whymusic

# 3) 安裝（要 root）。會自動建置前端、裝服務、啟動
sudo sh deploy/install.sh
```

裝完服務就跑起來了，預設綁 `127.0.0.1:8788`（只收本機，準備讓反向代理接手）。

> **建置需要 pnpm/npm。** install.sh 若發現前端還沒 build，會用 pnpm 或 npm 建置。
> 記憶體很小的機器（如 256MB 的 LXC）在本機建置可能吃力 —— 那就在別台先
> `pnpm build`，把 `packages/web/dist/` 複製到伺服器同一位置，再跑 install.sh，
> 它偵測到 dist 已存在就跳過建置。

可用環境變數調整安裝行為：

```bash
sudo SERVICE_USER=whymusic ENV_FILE=/etc/whymusic.env sh deploy/install.sh
```

| 變數 | 預設 | 說明 |
|------|------|------|
| `SERVICE_USER` | `root` | 服務執行身分（非 root 需自行先建好該帳號） |
| `ENV_FILE` | `/etc/whymusic.env` | 設定檔位置 |
| `NODE_BIN` | 從 PATH 找 | node 執行檔路徑 |

### 設定

設定檔在 `/etc/whymusic.env`（install.sh 從 [`deploy/whymusic.env.example`](deploy/whymusic.env.example)
建立）。改完重啟服務生效。全部可選：

| 變數 | 預設 | 說明 |
|------|------|------|
| `PORT` | `8788` | 監聽埠 |
| `HOST` | `127.0.0.1` | 監聽位址。有反代時維持 `127.0.0.1`；無反代要直接對外才設 `0.0.0.0` |
| `TRUST_PROXY` | `1` | 有反代時設 `1`，讓限流讀 `X-Forwarded-For` 拿真實 IP。無反代設 `1` 危險（XFF 可偽造） |
| `PROXY_ALLOWED_HOSTS` | 空（不限制） | `/api/proxy` 網域白名單，逗號分隔。私有網段永遠擋，不受此影響 |
| `PROXY_RATE_CAPACITY` | `60` | `/api/proxy` 每 IP 限流容量。設 `0` 關閉（公開時不建議） |
| `PROXY_RATE_REFILL` | `5` | 每秒回補（≈長期每秒上限） |
| `SYNC_DIR` | repo 的 `.sync/` | 裝置配對碼的暫存目錄 |
| `BUILD_STAMP` | install.sh 填 | 建置戳記，每次安裝自動更新，不必手改 |

### 反向代理

**務必**在前面架一層反代對外 —— 服務預設只綁 `127.0.0.1`。範例見
[`deploy/nginx.conf.example`](deploy/nginx.conf.example)：

```bash
cp deploy/nginx.conf.example /etc/nginx/http.d/whymusic.conf   # Alpine
# cp deploy/nginx.conf.example /etc/nginx/sites-available/whymusic  # Debian，再 ln 到 sites-enabled
# 改好 server_name 後：
nginx -t && rc-service nginx reload      # 或 systemctl reload nginx
```

HTTPS 用 certbot：`certbot --nginx -d music.example.com`（Alpine 先 `apk add certbot certbot-nginx`）。

### 管理服務

```bash
# systemd
systemctl status whymusic          # 狀態
journalctl -u whymusic -f          # 日誌
systemctl restart whymusic         # 改設定後重啟

# OpenRC
rc-service whymusic status
tail -f /var/log/whymusic.log
rc-service whymusic restart
```

更新版本：`git pull` 後重跑 `sudo sh deploy/install.sh`（會重新建置、更新戳記、重啟）。

### Docker（可選）

因為零相依，容器映像很小。見 [`deploy/Dockerfile`](deploy/Dockerfile)：

```bash
docker build -f deploy/Dockerfile -t whymusic .
docker run -d -p 8788:8788 -e HOST=0.0.0.0 --name whymusic whymusic
```

---

## 常見問題

**Q: 開站後搜尋顯示「搜尋需要音源」？**
A: 正常 —— 這個專案不隨附音源。到「設置」頁貼上你自己的音源網址並按「安裝」。
裝過一次會存進 localStorage，之後開啟自動載入。

**Q: 所有 `/api/*` 都回 HTML，首頁卻正常？**
A: `_worker.js` 沒被部署（CF）或 API 路由沒生效。CF 版請確認用的是
`pnpm build:cf` 而非 `pnpm build`。

**Q: 音源網址裝不上，說「回應不是插件代碼」？**
A: 那個網址沒有回傳插件原始碼。常見原因：路徑不存在（伺服器把它當前端路由、
回了 index.html），或對方站點沒送 CORS 標頭。確認該網址用瀏覽器直接開會看到
JS 原始碼。

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
| 搜尋顯示「需要音源」 | 還沒安裝音源 | 「設置」頁貼上你自己的音源網址 |
| `/api/*` 回 HTML | `_worker.js` 沒部署 | 用 `pnpm build:cf` 重新部署 |
| 音源裝不上 | 網址不回 JS 或無 CORS | 用瀏覽器直接開那個網址確認 |
| 播放中斷 | nginx 緩衝沒關 | 加 `proxy_buffering off;` |
| 重開機後站掛掉 | 服務沒設開機自啟 | `systemctl enable` / `rc-update add` |

---

## License

MIT
