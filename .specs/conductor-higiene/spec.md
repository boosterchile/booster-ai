# Higiene del Modo Conductor (Slot 3, paso 5)

**Estado**: aceptada (PO: «arranca la higiene», 2026-09-15) · **Slot**: 3, paso 5 de `docs/frentes-vivos.md`: «cerrar sesión; gate por rol en `/app/conductor`; sin `window.confirm`; los comandos de voz que no están montados salen de la pantalla de configuración; el smoke E2E obsoleto se corrige».

## 1. Inventario contra el código (2026-09-15)

| Punto | Estado encontrado | Qué se hace |
|---|---|---|
| Cerrar sesión | Ya existe: «Salir» en `/app/conductor/configuracion` con test (`signOutUser`). | Nada; se deja constancia. |
| Gate por rol | `app.tsx` manda al rol `conductor` a `/app/conductor`, pero `/app/conductor` y su configuración aceptan a cualquier usuario onboarded (`require-onboarded`). En prod el conductor (fvp@live.cl) tiene membresía rol `conductor` activa; `auth-driver` la crea al activar. | Si `active_membership.role !== 'conductor'` → `<Navigate to="/app" />` en ambas rutas (mismo criterio que `app.tsx`). |
| `window.confirm` | Dos usos en la tarjeta (recogida y entrega). Bloquea el hilo, no se puede estilar ni probar, y en la PWA de iOS sale como diálogo del sistema. | Confirmación inline: al tocar la acción aparece una franja «¿Confirmas…?» con «Sí, confirmar» y «No». Sin diálogo del navegador. |
| Comandos de voz en configuración | La card «Comandos de voz disponibles» lista 4 intents (`aceptar_oferta`, `confirmar_entrega`, `marcar_incidente`, `cancelar`) y la fila «Micrófono» pide el permiso «para decir…». `VoiceCommandButton` solo está montado en superficies del transportista (`VoiceAcceptOfferControl`, `IncidentReportCard`, `DeliveryConfirmCard`); en `/app/conductor` no hay ningún control de voz. | Salen la card de comandos y la fila de micrófono; el copy de la pantalla deja de prometer voz. La card «Activación por voz» (wake-word, flag) se queda porque ya dice «Próximamente» y no miente. Coherente con «pedir permisos solo al usarlos». |
| Smoke E2E obsoleto | `apps/web/e2e/redis-ratelimit-smoke.spec.ts` (gateado por `RUN_PROD_SMOKE=1`) espera el título «Acceso conductor» en `/login/conductor`; desde ADR-035 esa página es la activación y dice «Activa tu cuenta». El endpoint que golpea (`POST /auth/driver-activate`) sigue vigente. | Se corrige el título esperado y el comentario. |

## 2. Fuera de alcance

- `window.confirm` de `platform-admin-site-settings.tsx` (otro shell).
- Reemplazar `/login/conductor` o el smoke por uno del login universal.

## 3. Criterios de salida

- [x] Rojo exhibido: gate (dueño → `/app`), confirmación inline (sin «Sí, confirmar» no hay PATCH; «No» cancela), configuración sin voz ni micrófono.
- [x] Verde: suite `apps/web`, typecheck, biome, build.
- [x] Preview `/apariencia/conductor`: franja de confirmación inline al tocar «Confirmar recogida».
