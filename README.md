1|# MusicFree Web
2|
3|用瀏覽器聽音樂。不用安裝 App，打開網頁就能搜、能播。
4|
5|部署後在瀏覽器中訪問你的域名或伺服器地址即可使用。詳細步驟 → [DEPLOY.md](DEPLOY.md)
6|
7|---
8|
9|## 這是什麼
10|
11|基於開源專案 [MusicFree](https://github.com/maotoumao/MusicFree) 的插件系統，做了一個**純 Web 版本**。
12|
13|簡單說：MusicFree 原本是一個 Android 音樂播放器，靠插件接不同音源。這個項目把它搬到瀏覽器裡，功能一樣——搜尋、播放、歌詞、收藏，全部支援。
14|
15|### 支援的音源
16|
17|| 音源 | 狀態 | 說明 |
18||------|------|------|
19|| Audiomack | ✅ 內置 | 歐美音樂為主，無需額外憑證 |
20|| YouTube | ✅ 內置 | 需自建伺服器才能用 |
21|| 猫耳FM | ✅ 內置 | 聲劇、配音、動漫 |
22|
23|> 內置的插件源碼在 `packages/web/src/plugins/bundled/`。也可以自行新增第三方插件。
24|
25|### 為什麼不直接用 MusicFree App
26|
27|- **不用安裝**：手機、電腦、平板，有瀏覽器就行
28|- **跨裝置同步**：伺服器跑起來，哪台裝置都能登入
29|- **插件一次部署，所有裝置共享**：不需要每台手機單獨配
30|
31|---
32|
33|## 快速開始
34|
35|### 想用一下
36|
37|訪問 本地部署後在瀏覽器訪問你的伺服器地址即可。
38|
39|### 想自己跑
40|
41|有兩條路，選一條：
42|
43|**5 分鐘版（免費，僅 Audiomack）：** Cloudflare Pages 部署，具體步驟 → [DEPLOY.md 方式一](DEPLOY.md#方式一cloudflare-pages推薦新手)
44|
45|**完整功能版：** 一臺 VPS + nginx，支援全部音源 → [DEPLOY.md 方式二](DEPLOY.md#方式二vps--自建伺服器完整功能)
46|
47|---
48|
49|## 專案結構
50|
51|```
52|musicweb/
53|├── packages/
54|│   ├── core/                 # 核心：播放器 + 插件管理器
55|│   └── web/                  # Web 前端 + 後端
56|│       ├── src/              # React 前端
57|│       │   └── plugins/bundled/   # 內置音源插件
58|│       ├── functions/api/    # Cloudflare Pages 後端
59|│       ├── scripts/
60|│       │   └── server.mjs    # 自托管伺服器（監聽 :8788）
61|│       └── wrangler.toml     # Cloudflare 設定
62|├── .env.example              # 環境變數範本
63|├── DEPLOY.md                 # 部署指南（詳細步驟）
64|└── package.json
65|```
66|
67|---
68|
69|## 本地開發
70|
71|```bash
72|pnpm install
73|pnpm dev              # 啟動前端開發伺服器
74|pnpm build            # 編譯生產版本
75|pnpm typecheck        # 類型檢查
76|```
77|
78|---
79|
80|## 技術棧
81|
82|| 層 | 技術 |
83||----|------|
84|| 前端 | React 18 + TypeScript + Tailwind CSS |
85|| 核心 | MusicFree 插件系統（PluginManager + Player） |
86|| 自托管後端 | Node.js（`server.mjs`，監聽 `:8788`） |
87|| 免費部署後端 | Cloudflare Pages Functions |
88|| 反代 | nginx（TLS + 靜態檔案） |
89|
90|---
91|
92|## License
93|
94|MIT