import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    vue(),
    VitePWA({
      // prompt 模式：发现新 SW 不直接激活，由前端 onNeedRefresh 弹窗提示用户
      registerType: 'prompt',
      // 不自动注入注册脚本，改由 App.vue 手动 import 'virtual:pwa-register' 以拿到回调
      injectRegister: false,
      // 让图标随 SW 预缓存，离线也能显示
      includeAssets: [
        'icons/icon.svg',
        'icons/apple-touch-icon.png',
        'icons/icon-192.png',
        'icons/icon-512.png',
        'icons/icon-maskable-512.png'
      ],
      manifest: {
        name: '地铁线路图',
        short_name: '地铁图',
        description: '深圳 / 广州 / 香港 / 南宁 地铁线路图，纯前端离线可用',
        lang: 'zh-CN',
        theme_color: '#ffffff',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait',
        start_url: './',
        scope: './',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,wasm}'],
        navigateFallback: 'index.html',
        runtimeCaching: [
          {
            // 数据 JSON 走网络优先，保证线上更新后数据及时生效（避免被 SW 永久缓存）
            urlPattern: ({ url }) => url.pathname.includes('/data-'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'subway-data',
              networkTimeoutSeconds: 10,
              expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 }
            }
          }
        ]
      },
      // 开发环境不注册 SW，避免干扰 HMR 与本地缓存调试
      devOptions: {
        enabled: false
      }
    })
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

