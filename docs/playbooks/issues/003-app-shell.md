# BUG-003 — AppHeader (banner global) ausente en algunas rutas

| | |
|---|---|
| **Severidad** | 🔴 Crítico (UX) |
| **Componente** | `/app/certificados`, `/app/admin/dispositivos` |
| **Detectado** | 2026-05-04 |
| **Test** | `tests/bugs/layout-shell.spec.ts` |

## Descripción

El banner global (logo "Booster AI" + badge de empresa + nombre usuario +
botón "Salir") está presente en la mayoría de las rutas autenticadas, pero
**ausente** en dos:

- `/app/certificados`
- `/app/admin/dispositivos`

El usuario, al entrar, queda sin acceso visible a "Salir" y a la navegación
principal hasta que vuelve al home con back-arrow.

## Mapeo verificado

| Ruta | Banner global |
|---|---|
| `/app` | ✅ |
| `/app/cargas` | ✅ |
| `/app/cargas/nueva` | ✅ |
| `/app/cargas/<id>` | ✅ |
| `/app/cargas/<id>/track` | ✅ |
| `/app/perfil` | ✅ |
| `/app/ofertas` | ✅ |
| `/app/vehiculos` | ✅ |
| `/app/vehiculos/nuevo` | ✅ |
| `/app/vehiculos/<id>` | ✅ |
| `/app/certificados` | ❌ |
| `/app/admin/dispositivos` | ❌ |

## Repro

1. Login como Generador.
2. Ir a `/app/certificados`.
3. Observar: no hay banner arriba; la única navegación es "← Inicio".

Mismo comportamiento como Transportista en `/app/admin/dispositivos`.

## Causa probable

Estas rutas son más recientes y no quedaron envueltas por el `AppLayout` (o
`layout.tsx` en Next App Router) que aplica al resto.

## Fix

Mover la página de certificados y la de admin/dispositivos bajo el mismo
layout de shell que el resto de `/app/*`. En Next App Router, suele bastar
con que vivan dentro del mismo segmento que tiene `layout.tsx`.

Verificar también que `ProtectedRoute` / middleware se aplica.

## Capturas

Ver `.playwright-mcp/t-dispositivos-pendientes.png` y `g-certificados.png`.
