# Spec — Registro de cargas de combustible

**Slug:** `registro-cargas-combustible`
**Pedido:** PO, 2026-11-27, decisión D4 de `.specs/desviacion-combustible-confiable/spec.md`: «como una forma de ir mejorando la precisión debería haber un lugar donde se carguen litros y fechas». Entrega 2 de ese método. Frente fuera de slot por pedido del PO.
**Estado:** aceptada por el PO (D4, 2026-11-27).

## Por qué

La extracción indebida es de a poco, bidones de 10 o 20 L. El sensor de nivel no la ve: en 30 días el piso de detección va de ~140 L a ~600 L según el camión. Lo único que llega a 10–20 L es comparar **litros cargados contra litros quemados por el motor (IO 83)** en el período (`reconcilePeriod` de `packages/fuel-deviation`). Para eso Booster necesita los litros cargados, y hoy no los tiene en ninguna parte.

## Entradas

`POST /vehiculos/:id/cargas-combustible`, body (Zod `crearCargaCombustibleBodySchema`):

| Campo | Tipo | Regla |
|---|---|---|
| `cargada_en` | ISO 8601 con zona | No más de 5 min en el futuro; no antes de 2024-01-01. |
| `litros` | número | > 0 y ≤ 2000, un decimal. |
| `lugar` | texto opcional | Hasta 200 caracteres; vacío = null. |

Quién: el que gestiona la flota (`puedeGestionarFlota`: dueño, admin, despachador) de la empresa dueña del vehículo, o el personal de Booster impersonando (el `impersonation-write-guard` ya decide si la empresa admite escrituras). Listar exige lo mismo, y la lectura filtra por vehículo y empresa.

## Salidas

- `201 { carga }` con `id`, `vehiculo_id`, `cargada_en`, `litros`, `lugar`, `registrada_en`.
- `GET /vehiculos/:id/cargas-combustible` → `{ cargas }`: las 100 más recientes sin anular, de la más nueva a la más vieja.
- `DELETE /vehiculos/:id/cargas-combustible/:cargaId` → `200 { carga }` anulada. No se borra: queda `anulada_en` y `anulada_por`, para que el balance de un período ya revisado se pueda reconstruir. Anular dos veces devuelve la misma.
- Errores: vehículo o carga de otra empresa → `404`; rol sin gestión de flota → `403 write_role_required`; misma carga ya registrada (mismo vehículo, misma fecha y hora al minuto y mismos litros, sin anular) → `409 carga_duplicada`; body inválido → `400`.
- Observabilidad: span `carga_combustible.{registrar,listar,anular}` y métricas `carga_combustible_registrada_total` y `carga_combustible_anulada_total`.

## Datos

Tabla nueva `cargas_combustible` (migración 0093, expand-only): `id`, `empresa_id`, `vehiculo_id`, `cargada_en`, `litros numeric(7,1)` con check `> 0 AND <= 2000`, `lugar varchar(200)`, `registrada_por`, `registrada_en`, `anulada_en`, `anulada_por`. Índice único parcial `(vehiculo_id, cargada_en, litros) WHERE anulada_en IS NULL`; índice `(vehiculo_id, cargada_en DESC)`. Reverse en `drizzle/down/0093_…down.sql`.

## Interfaz

Ficha del vehículo (`/app/vehiculos/$id`), sección «Cargas de combustible»:

- Formulario: «Fecha y hora» (hora local del navegador, como el historial del vehículo; parte con la hora actual), «Litros» (acepta coma decimal), «Lugar (opcional)» y botón «Registrar carga». Mensaje de éxito y de error en español; el 409 dice «Esa carga ya está registrada».
- La lista muestra la fecha y hora en hora de Santiago.
- Lista de las cargas registradas con fecha y hora, litros y lugar, y «Anular» con confirmación.
- Texto de ayuda: «Con las cargas registradas, Booster compara lo que se cargó con lo que quemó el motor. Así se ven las pérdidas chicas que el sensor de nivel no alcanza a ver.»
- Solo la ve quien gestiona la flota.

## Criterios de éxito

1. Tests unitarios de la ruta (rojo exhibido antes de implementar): crear, listar, anular, 404 de otra empresa, 403 sin rol, 409 duplicada, 400 por litros fuera de rango y fecha futura.
2. Test de integración contra Postgres: la carga queda guardada, el índice único rechaza la duplicada y la anulada ya no bloquea registrarla de nuevo.
3. Tests de la sección web: registra, muestra la lista, anula con confirmación y muestra el error de duplicada.
4. Probado en local con la app (api + web + emulador): se registra una carga, aparece en la lista y se anula.
5. `pnpm run ci` en verde.

## Fuera de alcance

Que el conductor registre la carga desde el móvil; foto de la boleta; importar boletas desde un archivo o la tarjeta de combustible; usar las cargas en Booster Fleet y en el panel (entrega 3, con `reconcilePeriod`/`reconcileRefuels`).
