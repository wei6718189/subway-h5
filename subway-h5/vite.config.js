import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [
    vue()
  ],
  base: './',
  server: {
    host: '0.0.0.0',   // 监听所有网卡，局域网可访问
    port: 5173,         // 固定端口，避免漂移
    strictPort: false   // 端口被占时自动换
  },
  build: {
    outDir: 'dist',
    target: 'es2018',
    chunkSizeWarningLimit: 1500
  }
})

