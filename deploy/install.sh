#!/bin/sh
# WhyMusic 一鍵安裝 —— VPS / LXC / 裸機 Linux 通用。
#
# 做的事：檢查 Node → 確認前端已建置（沒有就嘗試建置）→ 建立設定檔 →
# 偵測 systemd 或 OpenRC → 安裝對應的服務單元 → 啟用並啟動 → 驗證健康檢查。
#
# 用 POSIX sh 寫（不是 bash）：Alpine 與多數 LXC 容器預設只有 busybox ash，
# 沒有 bash。避免所有 bashism。
#
# 用法（在 repo 根目錄，需要 root 或 sudo）：
#   sudo sh deploy/install.sh
# 可用環境變數覆寫：
#   SERVICE_USER=whymusic   服務執行身分（預設 root；非 root 需自行確保該帳號存在）
#   ENV_FILE=/etc/whymusic.env   設定檔位置
#   NODE_BIN=/usr/bin/node       node 執行檔（預設從 PATH 找）
set -eu

# ── 定位 repo 根目錄（本腳本在 deploy/ 底下）──────────────────────────
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/.." && pwd)
cd "$REPO_ROOT"

SERVICE_USER="${SERVICE_USER:-root}"
ENV_FILE="${ENV_FILE:-/etc/whymusic.env}"
NODE_BIN="${NODE_BIN:-$(command -v node || true)}"

say() { printf '%s\n' "$*"; }
die() { printf '✘ %s\n' "$*" >&2; exit 1; }

# ── 必須以 root 跑（要寫 /etc 與安裝服務）──────────────────────────────
[ "$(id -u)" = "0" ] || die "請用 root 執行：sudo sh deploy/install.sh"

# ── 檢查 Node ≥ 20.11 ─────────────────────────────────────────────────
[ -n "$NODE_BIN" ] || die "找不到 node。請先安裝 Node.js ≥ 20.11（可用環境變數 NODE_BIN 指定路徑）"
NODE_VER=$("$NODE_BIN" -p 'process.versions.node')
NODE_MAJOR=$(echo "$NODE_VER" | cut -d. -f1)
NODE_MINOR=$(echo "$NODE_VER" | cut -d. -f2)
if [ "$NODE_MAJOR" -lt 20 ] || { [ "$NODE_MAJOR" -eq 20 ] && [ "$NODE_MINOR" -lt 11 ]; }; then
  die "需要 Node.js ≥ 20.11，目前是 $NODE_VER"
fi
say "✓ Node $NODE_VER（$NODE_BIN）"

# ── 確認前端已建置；沒有就嘗試建置 ────────────────────────────────────
# server.mjs 只用 Node 內建模組、零相依，但它供應的前端 dist/ 需要先 build 出來。
# dist/ 是建置產物、不進版控，所以剛 clone 的 repo 沒有它。
if [ ! -f packages/web/dist/index.html ]; then
  say "▸ 前端尚未建置，嘗試建置…"
  # 這是個 pnpm workspace，根目錄的 build script 會呼叫 pnpm。取得 pnpm 的順序：
  #   1) 現成的 pnpm
  #   2) Node 自帶的 corepack（Node ≥16.9 都有）—— 不必全域安裝任何東西，
  #      呼應「有 Node 就能部署」的承諾
  # 兩者都沒有才退回 npm：此時繞過根 script（它會叫 pnpm），直接在 web 套件裡
  # 用 npm 建置（packages/web 的 build 是 tsc && vite build，自洽）。
  PNPM=""
  if command -v pnpm >/dev/null 2>&1; then
    PNPM="pnpm"
  elif command -v corepack >/dev/null 2>&1; then
    corepack enable pnpm >/dev/null 2>&1 || true
    if corepack pnpm --version >/dev/null 2>&1; then PNPM="corepack pnpm"; fi
  fi
  if [ -n "$PNPM" ]; then
    say "  用 $PNPM 建置"
    $PNPM install --frozen-lockfile && $PNPM build
  elif command -v npm >/dev/null 2>&1; then
    say "  用 npm 建置（在 packages/web 內，繞過需要 pnpm 的根 script）"
    ( cd packages/web && npm install && npm run build )
  else
    die "前端未建置，且找不到 pnpm/corepack/npm。請在有工具的機器上 build 後，
    把 packages/web/dist/ 複製到這台的同一位置，再重跑本腳本。"
  fi
fi
[ -f packages/web/dist/index.html ] || die "建置後仍找不到 packages/web/dist/index.html"
say "✓ 前端已就緒"

# ── 建置戳記（服務啟動時透過設定檔傳入，前端顯示用以判斷是否同一版）────────
if command -v git >/dev/null 2>&1 && git -C "$REPO_ROOT" rev-parse --short HEAD >/dev/null 2>&1; then
  SHA=$(git -C "$REPO_ROOT" rev-parse --short HEAD)
  test -n "$(git -C "$REPO_ROOT" status --porcelain)" && SHA="$SHA+"
else
  SHA="nogit"
fi
STAMP="$SHA · $(date '+%m-%d %H:%M')"

# ── 設定檔：不存在就從範例建立；每次都更新 BUILD_STAMP 那行、保留其餘 ─────
if [ ! -f "$ENV_FILE" ]; then
  cp deploy/whymusic.env.example "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  say "✓ 已建立設定檔 $ENV_FILE（預設 HOST=127.0.0.1，請搭配反向代理）"
else
  say "✓ 沿用既有設定檔 $ENV_FILE"
fi
# 抽掉舊的 BUILD_STAMP 行再補新的，不動使用者其他設定
TMP_ENV=$(mktemp)
grep -v '^BUILD_STAMP=' "$ENV_FILE" > "$TMP_ENV" || true
printf "BUILD_STAMP='%s'\n" "$STAMP" >> "$TMP_ENV"
cat "$TMP_ENV" > "$ENV_FILE"
rm -f "$TMP_ENV"
say "✓ 建置戳記：$STAMP"

# ── 渲染服務單元的共用替換 ────────────────────────────────────────────
render() {
  sed -e "s|__WORKDIR__|$REPO_ROOT|g" \
      -e "s|__NODE__|$NODE_BIN|g" \
      -e "s|__USER__|$SERVICE_USER|g" \
      -e "s|__ENVFILE__|$ENV_FILE|g" \
      "$1"
}

# ── 偵測 init 系統並安裝 ──────────────────────────────────────────────
if command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then
  say "▸ 偵測到 systemd"
  render deploy/whymusic.service > /etc/systemd/system/whymusic.service
  systemctl daemon-reload
  systemctl enable whymusic >/dev/null 2>&1 || true
  systemctl restart whymusic
  INIT=systemd
elif command -v rc-update >/dev/null 2>&1; then
  say "▸ 偵測到 OpenRC"
  render deploy/whymusic.openrc > /etc/init.d/whymusic
  chmod +x /etc/init.d/whymusic
  rc-update add whymusic default >/dev/null 2>&1 || true
  rc-service whymusic restart
  INIT=openrc
else
  die "認不出 init 系統（既非 systemd 也非 OpenRC）。
  可手動用：$NODE_BIN packages/web/scripts/server.mjs（設定見 $ENV_FILE）"
fi
say "✓ 服務已安裝並啟動（$INIT）"

# ── 驗證健康檢查 ──────────────────────────────────────────────────────
PORT=$(grep '^PORT=' "$ENV_FILE" | cut -d= -f2 | tr -d ' ' || true)
PORT="${PORT:-8788}"
HOSTC=$(grep '^HOST=' "$ENV_FILE" | cut -d= -f2 | tr -d ' ' || true)
HOSTC="${HOSTC:-127.0.0.1}"
[ "$HOSTC" = "0.0.0.0" ] && HOSTC=127.0.0.1
sleep 2
if command -v curl >/dev/null 2>&1; then
  if curl -fsS -m 5 "http://$HOSTC:$PORT/healthz" >/dev/null 2>&1; then
    say "✓ 健康檢查通過：http://$HOSTC:$PORT/healthz"
  else
    say "⚠ 健康檢查未通過，看一下日誌：" && print_logs=1
  fi
fi

say ""
say "完成。接下來："
if [ "$INIT" = systemd ]; then
  say "  狀態：systemctl status whymusic"
  say "  日誌：journalctl -u whymusic -f"
else
  say "  狀態：rc-service whymusic status"
  say "  日誌：tail -f /var/log/whymusic.log"
fi
say "  設定：$ENV_FILE（改完重啟服務生效）"
say "  反向代理範例：deploy/nginx.conf.example"
say "  預設 HOST=127.0.0.1，請務必架一層反向代理對外（見 DEPLOY.md）。"
