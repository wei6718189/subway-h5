import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: '地铁线路图',
        short_name: '地铁图',
        description: '深圳/广州/香港/南宁 地铁线路图与路径规划（离线可用）',
        lang: 'zh-CN',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0f1115',
        theme_color: '#0f1115',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        // 预缓存所有静态资源 + 城市数据 JSON，确保离线可用
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,json,webmanifest}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: /\/data\/.*\.json$/,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'subway-data-cache' }
          }
        ]
      },
      devOptions: {
        enabled: false
      }
    })
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
