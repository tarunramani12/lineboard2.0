import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  define: { __BUILD_ID__: JSON.stringify(Date.now().toString(36)) },   // a saved offline copy is only read by the build that saved it
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      // The fonts are part of the app, so they work offline. Only the Latin sets are kept; other scripts load from the network if ever needed.
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest,woff2}'],
        globIgnores: ['**/*-{cyrillic,cyrillic-ext,vietnamese,greek,greek-ext}-*.woff2'],
        // Pictures (storyboard, locations, moodboard) come from private Supabase storage through signed links whose token changes every hour.
        // Without this, every view downloads the picture again (and every download is billed as egress). Files are never overwritten (upsert: false,
        // random names), so one saved copy per file path is always right. The cache key drops the token. The cache name must match lib/pictureCache.ts.
        runtimeCaching: [
          {
            // Supabase is another site, and Workbox only matches another site's address when the pattern starts at the very beginning of the URL.
            urlPattern: /^https?:\/\/[^/]+\/storage\/v1\/object\/sign\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'lb-pictures-v1',
              expiration: { maxEntries: 400, maxAgeSeconds: 30 * 24 * 60 * 60, purgeOnQuotaError: true },
              cacheableResponse: { statuses: [200] },
              plugins: [
                {
                  // Same file, any token: one cache entry.
                  cacheKeyWillBeUsed: async ({ request }: { request: Request }) => {
                    const u = new URL(request.url)
                    return u.origin + u.pathname
                  },
                  // Ask with CORS so a failed or empty answer is never saved as an opaque response (browsers count those as 7 MB each).
                  requestWillFetch: async ({ request }: { request: Request }) =>
                    new Request(request.url, { mode: 'cors', credentials: 'omit' }),
                },
              ],
            },
          },
        ],
      },
      manifest: {
        id: '/',   // a fixed identity, so the installed app stays the same app if the start address ever changes
        name: 'LineBoard',
        short_name: 'LineBoard',
        description: 'From script to call sheet.',
        categories: ['productivity', 'entertainment'],
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
