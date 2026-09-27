# Detalle de conductor: 500 por `licencia_vencimiento` mapeada como timestamp

**Estado**: aceptada · **Fecha**: 2026-09-14 · **Pedido por**: PO (reporte desde el móvil: «no pude ingresar a través del botón Editar»)

## 1. El problema (medido en producción)

`GET /conductores/:id` respondió **500** para los siete conductores de Transportes Van
Oosterwyk (28 requests desde iPhone, 10:02–10:04 UTC; `logs` del API: «unhandled error»
con `err: {}`). El botón Editar de `/app/conductores` navega bien; es el API el que cae.

Causa (reproducida contra Postgres real): `conductores.licencia_vencimiento` es **DATE**
en la base (migración 0021 lo fija a propósito), pero `schema.ts` la declaraba
`timestamp('licencia_vencimiento', { mode: 'date' })`. El driver de Drizzle entrega
DATE como `"2028-09-22"`; el mapeo de `timestamp` sin zona le pega `"+0000"` y produce un
`Date` inválido. La lista lo escondía con `safeDateString` (devolvía `null`, por eso los
vencimientos no se ven en las tarjetas); el detalle hacía `.toISOString()` directo →
`RangeError: Invalid time value` → 500.

## 2. Entradas y salidas

- Drizzle: `licenseExpiry: date('licencia_vencimiento', { mode: 'string' })` — coincide
  con la columna real; el valor viaja como `"YYYY-MM-DD"` en lecturas y escrituras.
- `GET /conductores/:id`: `license_expiry` = `"YYYY-MM-DD"`; fechas de auditoría con
  `safeIsoString` (mismo tratamiento que la lista). Ningún `toISOString()` directo.
- `POST` / `PATCH`: escriben `body.license_expiry` (ya validado `YYYY-MM-DD` por Zod)
  sin construir `Date`.
- Sin migración: la columna no cambia. Contrato HTTP sin cambios (`YYYY-MM-DD`).

## 3. Criterios de salida

- [x] Rojo exhibido: unitario (Date inválido → 500) e integración contra Postgres real
      (`RangeError: Invalid time value`; lista con vencimiento `null`).
- [x] Verde: detalle 200 con `"2028-09-22"`; lista vuelve a mostrar el vencimiento;
      suite unitaria y de integración de `apps/api`, typecheck, biome.
- [ ] En producción tras el deploy: el botón Editar abre el detalle de cualquier conductor
      y las tarjetas muestran el vencimiento de licencia. — evidencia parcial (2026-09-22): desde api 00587-ruf (919d9bb9, contiene #678) hay 0 × 500 en GET /conductores/:id y 4 × 200, pero todos de 1 de los 7 conductores (df2a728f); los otros 6 que daban 500 no se volvieron a abrir. La lista pasó de 4457 a 4513 B (+56 = 7 × 8, coherente con null → "YYYY-MM-DD"), pero las tarjetas en la UI no se observaron.

## 4. Deuda observada (no se arregla aquí)

- El logger pierde el error: `app.onError` registra `{ err }` pero la redacción por
  valores (`formatters.log`) deja `err: {}` (las propiedades de `Error` no son
  enumerables). Contradice «un catch nunca traga errores en silencio». Followup propio.
