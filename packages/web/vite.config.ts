import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
// 與 worker 共用同一支戳記程式 —— 兩邊各自實作過一次，結果因為 Vite 的臨時設定檔
// 讓前端多算出一個 `+`，害「前後端不一致」的警示變成天天誤報。改成單一來源。
// （vite.config.ts 不在 tsconfig 的 include 內，import .mjs 不會被型別檢查擋下）
import { buildStamp } from '../../scripts/build-stamp.mjs'

export default defineConfig({
  plugins: [react()],
  define: {
    // 建置戳記編進前端，顯示在「音源」頁 —— 用來判斷線上跑的是哪一版
    __APP_VERSION__: JSON.stringify(buildStamp()),
  },
  server: {
    host: '0.0.0.0',
    port: 8894,
    open: false,
  },
})
