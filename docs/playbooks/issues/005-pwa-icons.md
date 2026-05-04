# BUG-005 — Iconos PWA del manifest dan 404

| | |
|---|---|
| **Severidad** | 🔴 (impacto bajo, fácil de arreglar) |
| **Componente** | `/manifest.webmanifest` + `/icons/*` |
| **Detectado** | 2026-05-04 |
| **Test** | `tests/bugs/pwa-manifest.spec.ts` |

## Descripción

El manifest se sirve correctamente (200, JSON válido) pero los 3 íconos
declarados retornan 404:

```json
// /manifest.webmanifest
{
  "name": "Booster AI",
  "short_name": "Booster",
  "theme_color": "#1FA058",
  "background_color": "#ffffff",
  "display": "standalone",
  "icons": [
    { "src": "/icons/icon-192.png",      "sizes": "192x192" },  // 404
    { "src": "/icons/icon-512.png",      "sizes": "512x512" },  // 404
    { "src": "/icons/icon-maskable.png", "sizes": "512x512" }   // 404
  ]
}
```

## Impacto

- Instalación PWA en Android/iOS muestra ícono genérico (favicon escalado).
- Errores recurrentes en consola en cada navegación: ~10–15 entries por
  visita complican el debugging real.
- Lighthouse PWA score reducido.

## Verificación

```bash
curl -I https://app.boosterchile.com/icons/icon-192.png
# HTTP/2 404
```

## Fix

Generar y deployar los 3 íconos. Si se usa Next.js, basta con poner los
archivos en `public/icons/`. Tamaños recomendados:

- `icon-192.png` — 192×192 (homescreen Android).
- `icon-512.png` — 512×512 (splash + install prompt).
- `icon-maskable.png` — 512×512 con safe area (Android adaptive icon).

Generadores: <https://realfavicongenerator.net/> o <https://maskable.app/>.

También revisar que `/icons/icon.svg` (referenciado pero no en manifest)
exista o se elimine la referencia.
