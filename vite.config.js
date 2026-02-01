import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'logo-192.png'],
      manifest: {
        name: 'Binance Sentinel AI',
        short_name: 'Sentinel',
        description: 'Autonomous Crypto Trading Bot',
        theme_color: '#1E2329',
        background_color: '#1E2329',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          {
            src: 'logo-192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'logo-192.png', // Fallback to 192 if 512 missing, or use same
            sizes: '512x512',
            type: 'image/png'
          }
        ]
      }
    })
  ],
})
