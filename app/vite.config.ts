import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      // The fonts are part of the app, so they work offline. Only the Latin sets are kept; other scripts load from the network if ever needed.
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest,woff2}'],
        globIgnores: ['**/*-{cyrillic,cyrillic-ext,vietnamese,greek,greek-ext}-*.woff2'],
      },
      manifest: {
        name: 'LineBoard',
        short_name: 'LineBoard',
        description: 'From script to call sheet.',
        display: 'standalone',
        start_url: '/',
        background_color: '#f3f3f3',
        theme_color: '#f3f3f3',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  test: { environment: 'node' },
})
