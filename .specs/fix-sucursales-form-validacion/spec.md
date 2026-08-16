# Spec — fix: sucursales valida lat/lng client-side + helper 400 compartido

**Slug**: `fix-sucursales-form-validacion` · **Rama**: `fix/sucursales-form-validacion`
(apilada sobre `fix/vehiculos-form-validacion-rangos`, PR #650) · **Fecha**: 2026-08-16

## Problema

Misma clase de bug que el incidente de vehículos (PR #650, spec
`.specs/fix-vehiculos-form-validacion/spec.md`): `SucursalForm` declara
`noValidate`, así que los `min`/`max` HTML5 de **Latitud** y **Longitud** no
bloquean el submit. Una coordenada fuera de rango (ej. lat=100) viaja al API
(`POST/PATCH /sucursales`, `createBodySchema`: lat ∈ [-90, 90], lng ∈ [-180, 180])
y vuelve como 400 opaco de zValidator; el `onError` muestra `err.message` crudo
→ banner `API error 400` sin campo señalado.

Los campos de texto del form NO tienen este hueco (usan reglas RHF `required` que
sí corren). Auditados también `RotarClaveModal.tsx` y `platform-admin.tsx` (otros
forms con `noValidate`): **cero inputs numéricos** — fuera de alcance.

## Alcance

- `apps/web/src/routes/sucursales.tsx`: validación client-side de lat/lng en
  submit + mapeo del 400 del server a banner legible.
- **Regla de tres** (tercer consumidor del shape
  `{success:false, error:{issues}}` de `@hono/zod-validator`): extraer a
  `apps/web/src/lib/form-validation.ts` el schema del payload, el mensaje por
  campos y el validador numérico; migrar `vehiculos.tsx` y
  `solicitar-acceso.tsx` a la lib **sin cambiar su comportamiento** (sus suites
  quedan como red de seguridad).
- API intacta (sus rangos son la fuente de verdad).

## Entradas

- `SucursalFormValues` (lat/lng strings) en submit.
- `ApiError` en `onError` de create/update.

## Salidas / comportamiento esperado

1. lat fuera de [-90, 90] o lng fuera de [-180, 180] → error de campo en español
   («Debe estar entre −90 y 90»), sin llamar al API. Decimales válidos (las
   coordenadas no son enteros).
2. 400 zValidator del server → banner «Revisa los campos: Latitud …» (labels de
   sucursales), nunca `API error 400`. Shape desconocido → mensaje original.
3. `vehiculos.tsx` y `solicitar-acceso.tsx` consumen la lib compartida; cero
   cambio de comportamiento observable (suites existentes verdes sin editar sus
   asserts).

## Criterios de éxito

- [ ] RED exhibido: los 3 tests nuevos de sucursales fallan antes del fix.
- [ ] Suite completa `apps/web` verde post-fix; coverage ≥80% en código nuevo.
- [ ] lint + typecheck + build verdes (node 24).
- [ ] Sin cambios en `apps/api`.
- [ ] PR apilado con base `fix/vehiculos-form-validacion-rangos`; retarget a
      `main` cuando #650 mergee.

## No-objetivos

- Cambiar el shape de error de zValidator en el API (decisión PO aparte, anotada
  en #650).
- Tocar forms sin inputs numéricos (`RotarClaveModal`, `platform-admin`).
