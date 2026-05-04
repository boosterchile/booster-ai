# FIX-005 — Iconos PWA presentes y servidos

> **Severidad**: 🔴 (impacto bajo, fácil)
> **Issue**: [../issues/005-pwa-icons.md](../issues/005-pwa-icons.md)
> **Test**: `tests/bugs/pwa-manifest.spec.ts`

## 1. Resumen

`/manifest.webmanifest` declara 3 íconos (192, 512, 512-maskable) y los 3
dan 404. Tampoco existe `/icons/icon.svg` referenciado en algún `<link>`.

## 2. Plan

1. Generar los 3 íconos PNG a partir del logo de Booster.
2. Generar el `icon.svg`.
3. Colocarlos en `public/icons/` (Next.js).
4. Verificar que el manifest los sirve.
5. Optional: agregar `apple-touch-icon` y favicon completo.

## 3. Generación de assets

### Opción A: a mano con un editor

Si tienen el logo en SVG:

```bash
# Necesita ImageMagick o un export de Figma/Sketch.
# Tamaños mínimos:
- icons/icon-192.png       192×192   (fondo opaco, padding mínimo)
- icons/icon-512.png       512×512   (fondo opaco)
- icons/icon-maskable.png  512×512   (con safe area de 80% — el ícono ocupa solo el centro 80%)
- icons/icon.svg           vector    (si querés un favicon vectorial)
```

### Opción B: con `pwa-asset-generator`

```bash
npx pwa-asset-generator path/to/logo.svg ./public/icons \
  --background "#1FA058" \
  --maskable
```

### Opción C: online

- <https://realfavicongenerator.net/> — sube el logo, descarga zip con todos los íconos.
- <https://maskable.app/> — específico para maskable icons (con preview de safe area).

### Maskable: detalles

El ícono maskable necesita tener el contenido en el centro 80% (safe
area). Los bordes pueden ser cortados por el sistema operativo. Si el logo
de Booster es la hoja verde, asegurate de que la hoja esté centrada y no
toque los bordes.

## 4. Localización del manifest

```bash
find apps/ src/ public/ -name "manifest*"
# Probable: public/manifest.webmanifest o app/manifest.ts (Next 13+)
```

### Si es estático (`public/manifest.webmanifest`):

Verificar que contenga:
```json
{
  "name": "Booster AI",
  "short_name": "Booster",
  "theme_color": "#1FA058",
  "background_color": "#ffffff",
  "display": "standalone",
  "start_url": "/app",
  "icons": [
    { "src": "/icons/icon-192.png",      "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png",      "sizes": "512x512", "type": "image/png" },
    { "src": "/icons/icon-maskable.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

### Si es dinámico (Next 13+ con `app/manifest.ts`):

```ts
import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Booster AI',
    short_name: 'Booster',
    theme_color: '#1FA058',
    background_color: '#ffffff',
    display: 'standalone',
    start_url: '/app',
    icons: [
      { src: '/icons/icon-192.png',      sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png',      sizes: '512x512', type: 'image/png' },
      { src: '/icons/icon-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
```

## 5. Tags HTML adicionales (recomendado)

En el `<head>` (en `app/layout.tsx`):

```tsx
export const metadata: Metadata = {
  title: 'Booster AI',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/icons/icon.svg', type: 'image/svg+xml' },
      { url: '/favicon.ico' },
    ],
    apple: [
      { url: '/icons/apple-touch-icon.png', sizes: '180x180' },
    ],
  },
  themeColor: '#1FA058',
};
```

## 6. Verificación

### 6.1 Test automático

```bash
npm test -- bugs/pwa-manifest
```

Debe pasar de FAIL a PASS (2 tests).

### 6.2 Manual

```bash
# Cada ícono debe responder 200
for f in icon-192.png icon-512.png icon-maskable.png icon.svg; do
  echo -n "$f: "
  curl -sI "https://app.boosterchile.com/icons/$f" | head -1
done
```

### 6.3 Validador PWA

- DevTools → Application → Manifest. Verificar que los 3 íconos aparezcan
  con preview.
- Lighthouse → PWA score: la métrica "icon" debería pasar.
- Mobile: agregar a home screen → ícono custom aparece.

## 7. Riesgos

Ninguno. Solo adición de assets.

## 8. Definition of Done

- [ ] 3 PNG existentes en `public/icons/`.
- [ ] `icon.svg` existente o referencia removida.
- [ ] Manifest se sirve con 200 y `icons` apunta a los archivos correctos.
- [ ] `tests/bugs/pwa-manifest.spec.ts` → 2/2 pass.
- [ ] Lighthouse PWA score sin warnings de "Icon".
- [ ] Commit `chore(pwa): agrega iconos faltantes (BUG-005)`.
