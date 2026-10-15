import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string
}

// https://vite.dev/config/
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    alias: [
      { find: '@', replacement: fileURLToPath(new URL('./src', import.meta.url)) },
      // pdf.js's modern build calls built-ins only the newest browsers have
      // (Map.prototype.getOrInsertComputed, Math.sumPrecise): on an older Chrome for Android
      // every page failed to render. The legacy build of the same version carries polyfills.
      // The worker is imported from legacy/ in PdfViewer.tsx.
      { find: /^pdfjs-dist$/, replacement: 'pdfjs-dist/legacy/build/pdf.mjs' },
      {
        find: /^pdfjs-dist\/web\/pdf_viewer\.mjs$/,
        replacement: 'pdfjs-dist/legacy/web/pdf_viewer.mjs',
      },
    ],
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // The app never reloads itself: an update prompt is shown instead,
      // so an in-progress audio recording is never interrupted.
      registerType: 'prompt',
      includeAssets: ['icon.svg', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: 'BibleNote',
        short_name: 'BibleNote',
        description: 'Notițe pentru studiul Bibliei',
        lang: 'ro',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#faf9f6',
        theme_color: '#faf9f6',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'pwa-maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // App shell, fonts, the pdf.js worker (.mjs) and the Bible JSON (public/bible) are
        // precached. Supabase requests are never cached: there is no runtimeCaching entry;
        // files opened offline come from the app's own IndexedDB cache.
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,woff2,json}'],
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
})
