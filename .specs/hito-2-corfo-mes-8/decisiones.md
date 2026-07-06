# Decisiones del PO — hito-2-corfo-mes-8

## D1 · W4a: Opción A confirmada (2026-07-06)

Generalizar `vehiculos` con `categoria_unidad` ∈ {motriz, arrastre} + carrocería/enganche, y `viajes.unidad_arrastre_id` (FK a `vehiculos`, nullable). **Condiciones del PO para el DDL (se presenta antes de aplicar):**

1. **0..1 arrastre** aceptado como deuda declarada — crear follow-up stub en `.specs/_followups/` para 0..N/bitrén y declararlo en el ADR.
2. **Relajar `capacity_kg`** — un tracto no carga solo y el Zod actual lo exige positivo. Definir semántica por categoría también para `curb_weight`/`consumption`.
3. **CHECK tipo↔categoría en BD**; el resto de coherencias en runtime + tests (precedente del espejo): un arrastre nunca puede ser `asignado_a_vehiculo_id`; compatibilidad tracto↔semirremolque / rígido↔remolque se valida al armar la configuración en W4c.
4. **Mapping expand/contract de datos existentes** (`semi_remolque`, `refrigerado`, `tanque`) presentado junto al DDL — la columna `type` vieja **no se dropea hoy**.

## D2 · W2: IMEI en estado `rechazado` (2026-07-06)

Override en dos pasos, nunca silencioso: primer PATCH sobre IMEI `rechazado` → 409 `imei_rechazado` con `rechazado_en`/`motivo`; reintento con `confirmar_reasociacion: true` → procede y mueve `rechazado→aprobado` con log estructurado del override (actor, timestamp, estado previo) y aviso en UI ("fue rechazado el <fecha>, ¿reasociar?"). Además: verificar si el rechazo de pendings es tenant-scoped; si cualquier empresa puede rechazar devices globales, documentar en spec/ADR que por eso el rechazo NO puede ser terminal (denegación cruzada). Fallback si no cabe hoy: opción plana con `reasociado_desde: 'rechazado'` en la respuesta + aviso UI.

## D3 · W2: semántica `reemplazado` (2026-07-06)

`reemplazado` aplica a: cambio X→Y (row de X), desasociar con null (row de X), y asociar IMEI sin row = sin reconciliación (enrollment al conectar). Condiciones: (a) re-asociar desde `reemplazado` procede DIRECTO (el confirm de dos pasos es solo para `rechazado`); (b) verificar que un device desasociado que sigue transmitiendo re-abra `pendiente` aunque exista row `reemplazado` — si el row terminal bloquea el re-enrollment, corregirlo o documentarlo como limitación explícita con el PATCH como único rescate; (c) verificar que el enrollment no crea rows espurios para IMEIs ya asociados.

## Hallazgos de auditoría W1.1 que ajustan el plan

- Segundo consumo de token = **403 anti-oráculo** (no 409): deliberado, documentado en spec de Fase 1. La UI onboarding-admin (W1.3) debe tratar 403 como "token inválido/expirado/consumido" sin distinguir.
- **W1.4 (link copiable) es la única vía de entrega del token** — el approve no lo devuelve hoy y el notifier es stub. Exponerlo en la respuesta del approve está mandatado por el plan del PO.
- Activación (W1.5) bloqueada además por: reaper T1.7 sin agendar en Cloud Scheduler (falta Terraform) y `ONBOARDING_TOKEN_SIGNING_SECRET` sin provisionar en GSM/Terraform.
