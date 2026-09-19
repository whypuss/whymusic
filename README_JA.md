<div align="center">

# 🎵 WhyMusic

**ミニマルでモダン、ブラウザネイティブなロスレス・ストリーミング音楽プレイヤー**  
アプリのインストール不要。検索、再生、お気に入り、ダウンロード、プレイリスト同期をワンストップで。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![React](https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react&logoColor=black)](https://reactjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-CSS-38B2AC?style=flat-square&logo=tailwind-css&logoColor=white)](https://tailwindcss.com/)
[![Cloudflare Pages](https://img.shields.io/badge/Deploy-Cloudflare%20Pages-F38020?style=flat-square&logo=cloudflare&logoColor=white)](https://pages.cloudflare.com/)
[![PWA Ready](https://img.shields.io/badge/PWA-Ready-5A0FC8?style=flat-square&logo=pwa&logoColor=white)](https://web.dev/progressive-web-apps/)

[繁體中文](README.md) • [English](README_EN.md) • [简体中文](README_ZH.md) • [日本語](README_JA.md)

</div>

---

## 🌟 WhyMusic とは？

**WhyMusic** は、現代のウェブブラウザ上で完全に動作する高性能な音楽プレイヤーです。本プロジェクトの中核思想は、**「プレイヤーコアと音源アーキテクチャの完全な分離（疎結合）」**にあります：

- **出荷時音源ゼロ（Zero Built-in Sources）**：リポジトリやビルド成果物には、著作権で保護された音源やプロプライエタリな API キーは一切含まれていません。フロントエンドは特定の音楽サービスを直接認識せず、標準化されたプラグインインターフェースを通じて「再生可能な URL を返してください」と要求するだけです。
- **極小セキュアサンドボックス（Micro Sandbox）**：ユーザーが提供するプラグインは標準的な CommonJS 形式であり、ブラウザ内の制御された `new Function` サンドボックス内で安全に隔離実行されます。サンドボックスは `fetch`、タイマー、`URL`、`btoa/atob`、`console` のみを許可し、`window` や `document`、機密ストレージへのアクセスを完全に遮断します。
- **モバイルバックグラウンド再生の完全維持（Dual-Audio Buffering）**：独自の**デュアル Audio 要素による交互バッファリング機構**を採用し、iOS Safari や Android でロック画面やバックグラウンド移行時にセッションが切れて再生停止する問題を根本から解決しました。

---

## ✨ 主な機能と特徴

### 1. デュアル Audio 要素によるシームレス切り替え（ロック画面再生の中断防止）
- バックグラウンドで `audio.src` を切り替えるとブラウザのオーディオセッションが無効化され、ロック画面での再生停止の原因となります。
- WhyMusic はフォアグラウンドのアイドル状態にある 2 つ目の Audio 要素に次の楽曲を事前読み込みします。曲切り替え時は準備完了した要素の `.play()` を呼ぶだけで、ネットワーク接続の切断を防ぎます。
- **MediaSession API** に完全対応：ロック画面、コントロールセンター、通知バー、ヘッドフォンリモコン（再生/一時停止/スキップ）操作に対応し、高解像度アートワークや歌詞をダイナミックに表示します。

### 2. マルチ音源フェイルオーバー＆繁体・簡体字の正規化検索
- プラグインは複数ソースへの同時リクエストとマージに対応し、同一曲名・同一アーティストを自動で重複排除します。
- **文字コードの正規化**：繁体字・簡体字の正規化により、繁体字で検索しても簡体字音源の楽曲をヒットさせることが可能です。
- **自動フォールバック**：CDN の地域制限（403 エラー）や非対応フォーマットにより再生できない場合、プレイヤーは自動的に他の利用可能なサブ音源に切り替えて再試行します。

### 3. Apple 風の洗練されたモダン UI
- デフォルトでミニマルなダークテーマを採用：美しい半透明のすりガラスドック（Frosted Glass）、フローティングミニプレイヤーカード、滑らかなアニメーション。
- 全画面表示でのリアルタイム同期歌詞スクロールに対応。

### 4. プレイリスト管理とアカウント不要のデバイス同期
- **Markdown エクスポート／インポート**：プレイリストを人間が読めるクリーンな Markdown テキストとして出力可能。末尾の HTML コメント内に非表示の JSON データを内包しており、他の WhyMusic インスタンスに再インポートした際、ID や音源情報を 100% 正確に復元できます。
- **プレーンテキスト自動認識**：「曲名 - アーティスト名」のテキストリスト（最大 200 行）を貼り付けるだけで、自動でマッチング検索を行います。
- **8 桁ペアリングコードによるデバイス同期**：アカウント登録不要で 24 時間有効な 8 桁コードを発行し、別のデバイスで入力するだけでインストール済み音源プラグインを即座に同期できます。個人情報は一切保持しません。

### 5. 読み取り専用 WebDAV ファサード
- RFC 4918 準拠の読み取り専用 WebDAV サービス（`/dav`）を内蔵。
- iOS ネイティブプレイヤー（**Everplay** や **Evermusic** など）に直接マウント可能で、ディレクトリをプレイリスト、楽曲を `.mp3`、歌詞を `.lrc` としてネイティブ環境でストリーミング再生できます。

---

## 🏗️ システム構造

```
whymusic/
├── packages/
│   └── web/
│       ├── src/
│       │   ├── musicApp.ts        # グローバルステートマシン＆オーディオ制御
│       │   ├── App.tsx            # メインシェル＆レスポンシブルーティング
│       │   ├── ui/AppleUI.tsx     # デフォルトのモダンすりガラス UI
│       │   └── core/              # DualPlayer / PluginManager / サンドボックス
│       ├── worker/                # Cloudflare Pages Functions バックエンド
│       │   └── index.js           # ルートディスパッチャ＆CORS プロキシ (/api/proxy)
│       ├── scripts/server.mjs     # VPS 用スタンドアローン Node.js サーバー (外部依存ゼロ)
│       └── wrangler.toml          # Cloudflare Pages ＆ KV 設定
├── scripts/                       # ビルド＆パッケージングスクリプト
├── capacitor.config.json          # Android ネイティブコンテナ設定
└── DEPLOY.md                      # 詳細なデプロイガイド
```

### 技術スタック

| 分野 | 採用技術 | 特徴 |
| :--- | :--- | :--- |
| **フロントエンド** | React 18 + TypeScript + Vite | 高速レンダリング、厳格な型安全性 |
| **スタイリング** | Tailwind CSS + Lucide Icons | モダンダークテーマ、すりガラスエフェクト、レスポンシブ |
| **サーバーレス** | Cloudflare Pages / Workers | グローバル Anycast CDN による超低遅延、完全無料運用 |
| **セルフホスト** | Node.js ネイティブサーバー | 外部 npm 依存ゼロ、単一ファイルで起動 |
| **マルチプラットフォーム** | PWA + Capacitor (Android) | ホーム画面への追加（PWA）＆ネイティブ APK パッケージング |

---

## 🚀 クイックスタート

### デプロイ方法 1：Cloudflare Pages（推奨、完全無料）

1. **依存関係のインストールとログイン**：
   ```bash
   npm install -g pnpm wrangler
   git clone https://github.com/whypuss/whymusic.git
   cd whymusic
   pnpm install
   wrangler login
   ```

2. **ビルド＆デプロイ**：
   ```bash
   pnpm deploy:cf
   ```

> 💡 **ツール不要の ZIP アップロード**：[Releases](../../releases) から `musicweb-cf.zip` をダウンロードし、Cloudflare Pages のダッシュボードにドラッグ＆ドロップするだけでデプロイが完了します。

### デプロイ方法 2：Linux VPS / Docker によるセルフホスト

```bash
# スタンドアローンサーバーの起動（静的ファイルと /api プロキシをポート 8788 で提供）
node packages/web/scripts/server.mjs
```

Nginx リバースプロキシや Systemd 設定、WebDAV の詳細設定については [DEPLOY.md](DEPLOY.md) をご覧ください。

---

## 🧩 音源プラグイン仕様

本プレイヤーには音源があらかじめ組み込まれていません。デプロイ後、**「設定」** 画面から互換性のある CommonJS 音源プラグインの URL を登録してください。

```javascript
module.exports = {
  platform: "カスタム音源名",
  version: "1.0.0",
  // 1. 楽曲検索
  async search(query, page, type) {
    // { isEnd: boolean, data: TrackItem[] } を返す
  },
  // 2. 音声ストリーム URL の解決
  async getMediaSource(musicItem, quality) {
    // { url: "https://..." } を返す
  },
  // 3. 歌詞およびアートワークの取得 (オプション)
  async getLyric(musicItem) { /* { rawLrc: string } を返す */ },
  async getMusicArtwork(musicItem) { /* { artwork: string } を返す */ }
};
```

---

## 📱 モバイル環境での利用に関する推奨事項

- **iOS ユーザー**：**Safari** ブラウザで直接開くことを強く推奨します。ホーム画面に追加してショートカットとして起動してください。スタンドアローン（全画面 PWA）モードでは iOS のバックグラウンドオーディオ維持制限が厳しいため、ブラウザタブでの利用が最適です。
- **Android ユーザー**：Chrome または Edge から「アプリをインストール」または「ホーム画面に追加」して PWA としてご利用ください。システムの「バックグラウンドでのアクティビティを許可」および「ロック画面の通知」を有効にしてください。

---

## 📄 ライセンス

本プロジェクトは [MIT License](LICENSE) のもとで公開されています。  
Created, architected, and maintained by [@whypuss](https://github.com/whypuss).
