# BUG-007 — Terminología técnica de back-end visible al usuario final

| | |
|---|---|
| **Severidad** | 🟡 Menor (UX / branding) |
| **Componente** | varios |
| **Detectado** | 2026-05-04 |
| **Test** | `tests/bugs/copy-consistency.spec.ts` |

## Ejemplos detectados

| Lugar | Texto actual | Sugerido |
|---|---|---|
| `/app/cargas/nueva` placeholder de Precio | "Dejar vacío si querés que **pricing-engine** sugiera" | "Dejar vacío si quieres que el sistema sugiera un precio" |
| `/app/cargas/<id>` modal cancelación | "El **matching engine** deja de buscar transportistas..." | "El sistema deja de buscar transportistas..." |
| `/app/cargas` subtítulo Cargas activas | "En proceso de **match**, asignadas o en ruta." | "En proceso de búsqueda, asignadas o en ruta." |
| `/app/cargas` subtítulo Historial | "Cargas entregadas, canceladas o sin **match**." | "Cargas entregadas, canceladas o sin asignación." |
| `/app/admin/dispositivos` subtítulo | "**Devices** Teltonika que conectaron al gateway..." | "Dispositivos Teltonika que se conectaron y esperan asociación..." |
| `/recuperar` (forgot password) | "Te enviamos un email con el **link**..." | "Te enviamos un email con el enlace..." |

## Fix

Pasada de copy en una sola PR. Crear un glosario interno:

| Término técnico | Equivalente UX |
|---|---|
| matching engine / pricing engine | el sistema |
| match / matcheo | búsqueda / emparejamiento |
| device | dispositivo |
| link | enlace |
| trip request | carga / pedido |

Considerar usar i18n (`next-intl` / `react-intl`) aunque sea con un solo
locale `es-CL` — facilita auditorías de copy a futuro.
