import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [
    vue()
  ],
  base: './',
  server: {
    host: '0.0.0.0',   // 监听所有网卡，局域网可访问
    port: 4173,         // 固定端口：让 dev 直接占用 4173，HMR 实时生效，与预览地址一致
    strictPort: true    // 端口被占时直接报错，避免静默漂移到别的端口
  },
  build: {
    outDir: 'dist',
    target: 'es2018',
    chunkSizeWarningLimit: 1500
  }
})

