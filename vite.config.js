import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
        secure: false,
      }
    }
  },
  build: {
    sourcemap: false,
    chunkSizeWarningLimit: 1600,
  },
  plugins: [
    react(),
    // VitePWA({...}) // DISABLED TO SPEED UP BUILD
  ],
})
