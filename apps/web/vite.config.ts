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
      // injectManifest mode (P3.c): tomamos control del SW para agregar
      // handlers custom de push + notificationclick (ver src/sw.ts).
      // Workbox sigue precaching los assets via injectManifest() que
      // llamamos desde sw.ts.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
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
