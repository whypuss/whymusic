import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/musicweb/',
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 8894,
    open: false,
  },
})
