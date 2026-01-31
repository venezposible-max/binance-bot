import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    react(),
    // VitePWA({...}) // DISABLE PWA TEMPORARILY TO FIX CHROME CACHE
  ],
})
