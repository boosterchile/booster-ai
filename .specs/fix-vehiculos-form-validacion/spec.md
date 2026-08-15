# Spec — fix: el form de vehículos señala errores de rango en vez de "API error 400"

**Slug**: `fix-vehiculos-form-validacion` · **Rama**: `fix/vehiculos-form-validacion-rangos` · **Fecha**: 2026-08-15

## Problema (reproducido en prod, 2026-08-15)

Un transportista creando un vehículo en `/app/vehiculos/nuevo` con **Capacidad (m³) = 10000**
recibe un banner opaco `API error 400` sin indicación de qué campo falló.

Causa raíz (dos bugs encadenados en `apps/web`):

1. **`<form noValidate>` anula la validación HTML5** en la que el código confía.
   El comentario en `VehicleForm` dice que capacidad/año/etc. "quedan cubiertos por
   los attributes HTML5 (`required`, `min`, `max`)", pero el form declara `noValidate`,
   así que esos atributos no bloquean el submit. La única validación cliente real es
   la de patente. Valores fuera de rango viajan al server.
2. **El 400 de Zod llega opaco al usuario.** `zValidator` (Hono) responde el
   `SafeParseError` crudo, sin los campos `error`/`code` que `api-client.ts` usa para
   armar mensajes → `ApiError` cae al genérico `API error 400`. El mutation handler
   lo muestra tal cual.

Referencias: `apps/api/src/routes/vehiculos.ts` (`createBodySchema`, `capacity_m3
max 500`), `apps/web/src/routes/vehiculos.tsx` (`VehicleForm`, `vehicleFormToBody`),
`apps/web/src/lib/api-client.ts` (`ApiError`). Precedente del mismo problema resuelto
para RUT en `apps/web/src/routes/equipo.tsx`.

## Alcance

Solo `apps/web` (form de vehículos, create + edit — comparten `VehicleForm` y
mutation handlers). **No** se toca el contrato de la API ni sus schemas: los rangos
del server son la fuente de verdad y quedan intactos.

## Entradas

- `VehicleFormValues` (strings del form RHF) en submit.
- `ApiError` (status, code, details) en `onError` de las mutations create/update.

## Salidas / comportamiento esperado

1. **Validación cliente de rangos numéricos en `submit()`**, espejo de
   `createBodySchema` del API, con mensajes en español por campo (vía
   `setError(field, …)`, mismo patrón que patente):
   - `capacity_kg`: entero 1–100.000 (form exige ≥1 como hoy vía `min={1}`)
   - `capacity_m3`: entero 1–500 (opcional)
   - `year`: entero 1980–2100 (opcional)
   - `curb_weight_kg`: entero 1–50.000 (opcional)
   - `consumption_l_per_100km_baseline`: número > 0 y ≤ 99.99 (opcional)
   Un valor fuera de rango NO llega a `api.post`/`api.patch`.
2. **Fallback legible para 400 de validación del server**: si igual llega un
   `ApiError` 400 cuyo `details` trae issues Zod (shape de `zValidator`), el banner
   nombra el/los campos con etiqueta en español (ej. "Capacidad (m³): fuera de
   rango") en vez de `API error 400`. Si el shape no es reconocible, se mantiene el
   mensaje actual (no se inventa contenido).

## Criterios de éxito

- [ ] Test RED exhibido: submit con `capacity_m3=10000` muestra error de campo y no
      llama al API (falla antes del fix).
- [ ] Test RED exhibido: `ApiError` 400 con issues Zod produce mensaje legible en el
      banner (falla antes del fix).
- [ ] Suite `apps/web` verde post-fix; coverage ≥80% en código tocado.
- [ ] `pnpm lint` + `typecheck` + `build` verdes (node 24).
- [ ] El flujo del bug original (m³=10000) queda bloqueado client-side con mensaje
      que nombra el campo y el rango permitido.
- [ ] Sin cambios en `apps/api` ni en `packages/*`.

## No-objetivos

- Cambiar el shape de error de `zValidator` en el API (contrato público — decisión
  PO aparte; ver followup).
- Tocar otros forms con el mismo patrón (`equipo.tsx` ya tiene su fix de RUT; un
  barrido general es frente aparte).
- Sincronizar los rangos vía schema compartido en `packages/shared-schemas`
  (deseable a futuro; hoy los rangos ya viven duplicados en los attributes HTML del
  form — este fix los centraliza en UN lugar del form, no agrega tercera copia).
