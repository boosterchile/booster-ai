# Fechas de los documentos de vehículo y conductor

**Fecha**: 2026-11-25 · **Pedido**: PO, en la sesión del frente 1 («Sí, arréglala»). Complementa [`spec.md`](./spec.md) §1.6.

## Qué pasaba

`documentos_vehiculo` y `documentos_conductor` guardan `fecha_emision` y `fecha_vencimiento` como `date`, pero el esquema de drizzle las declaraba `timestamp` en modo `Date`. Al leerlas, drizzle entregaba `Invalid Date`:

- `POST`, `PATCH` y `GET` de `/documentos/vehiculo*` y `/documentos/conductor*` respondían 500 (`RangeError: Invalid time value` al serializar con `toISOString`). En `POST` la fila sí quedaba guardada.
- Booster Fleet mostraba todo documento con fecha como «sin fecha» (corregido antes en #1097 con una lectura como texto, que este cambio reemplaza).

Los tests unitarios no lo veían: el stub de la base entregaba objetos `Date` válidos.

## Salida

- El esquema declara las cuatro columnas `date` en modo texto (`AAAA-MM-DD`), que es lo que son en la base. Sin migración.
- Las rutas guardan y devuelven la fecha tal cual; el estado (`vigente`, `por_vencer`, `vencido`) se sigue calculando con `calcularEstadoDocumento`.

## Criterios de éxito

1. `test/integration/documentos-fechas.integration.test.ts`, contra Postgres real: crear, listar y editar un documento de vehículo y uno de conductor responde 2xx y devuelve las fechas guardadas. Falla con el esquema anterior.
2. `test/integration/documental-flota.integration.test.ts` sigue en verde.
3. `pnpm run ci` en verde.
