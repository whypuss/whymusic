# WhyMusic 自架後端的容器映像。
#
# 兩階段：build 階段用 pnpm 把前端編出來，runtime 階段只留 node + 執行期需要的檔。
# server.mjs 零外部相依，所以 runtime 映像不含任何 node_modules，非常小。
#
# 建置（在 repo 根目錄）：
#   docker build -f deploy/Dockerfile -t whymusic .
# 執行（背後建議再擋一層反代；容器內直接對外時設 HOST=0.0.0.0）：
#   docker run -d -p 8788:8788 -e HOST=0.0.0.0 --name whymusic whymusic

# ── build ────────────────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
# 先只複製 manifest 裝相依，讓這層能被快取
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/web/package.json packages/web/
RUN pnpm install --frozen-lockfile
# 再複製其餘原始碼並建置前端
COPY . .
RUN pnpm build

# ── runtime ──────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8788
# 容器內通常自己就是對外那一層，預設綁全介面；有反代時覆寫成 127.0.0.1
ENV HOST=0.0.0.0
# 只複製執行期真正需要的東西 —— 沒有 node_modules
COPY --from=build /app/packages/web/scripts ./packages/web/scripts
COPY --from=build /app/packages/web/shared  ./packages/web/shared
COPY --from=build /app/packages/web/dist    ./packages/web/dist
COPY --from=build /app/plugins              ./plugins
# 配對碼寫在這裡（server.mjs 的 SYNC_DIR 預設），需可寫
RUN mkdir -p .sync && addgroup -S app && adduser -S app -G app && chown -R app /app
USER app
EXPOSE 8788
# 讓 docker 也能判活
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s \
  CMD wget -qO- "http://127.0.0.1:${PORT}/healthz" >/dev/null 2>&1 || exit 1
CMD ["node", "packages/web/scripts/server.mjs"]
