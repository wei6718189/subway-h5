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
    strictPort: true,   // 端口被占时直接报错，避免静默漂移到别的端口
    headers: {
      'Cache-Control': 'no-store'  // 强制禁止浏览器缓存 dev 资源，普通刷新即可拿到最新，无需硬刷
    }
  },
  build: {
    outDir: 'dist',
    target: 'es2018',
    chunkSizeWarningLimit: 1500
  },
  preview: {
    port: 4173,
    strictPort: true,
    headers: {
      // 关掉 preview 的强缓存（默认 immutable 一年），避免改完代码重新 build 后浏览器仍用旧版
      'Cache-Control': 'no-store'
    }
  }
})

