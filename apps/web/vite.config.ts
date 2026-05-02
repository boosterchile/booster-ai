import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// NOTA: TanStackRouterVite (file-based routing codegen) deshabilitado en B.3.b.
// Usamos rutas programáticas en src/router.tsx para evitar el step de
// codegen (routeTree.gen.ts) y que typecheck/CI no dependan de un build
// previo. Si después conviene volver a file-based, descomentar el plugin
// + agregar routeTree.gen.ts al gitignore + correr `tsr generate` en
// pre-build.

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // skipWaiting + clientsClaim → cuando se deploya una version nueva,
        // el nuevo SW se activa inmediatamente (no espera a que se cierren
        // todas las pestañas) y toma control de los clients existentes en
        // el siguiente fetch. Sin esto los usuarios pueden quedar pegados
        // con un index.html viejo apuntando a un bundle JS que ya no
        // existe (404) o que no tiene rutas nuevas.
        skipWaiting: true,
        clientsClaim: true,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-stylesheets',
              expiration: {
                maxEntries: 4,
                maxAgeSeconds: 60 * 60 * 24 * 365,
              },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              expiration: {
                maxEntries: 20,
                maxAgeSeconds: 60 * 60 * 24 * 365,
              },
            },
          },
        ],
      },
      manifest: {
        name: 'Booster AI',
        short_name: 'Booster',
        description: 'Plataforma de logística sostenible',
        theme_color: '#1FA058',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icons/icon-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
