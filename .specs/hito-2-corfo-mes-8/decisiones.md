# Decisiones del PO — hito-2-corfo-mes-8

## D1 · W4a: Opción A confirmada (2026-07-06)

Generalizar `vehiculos` con `categoria_unidad` ∈ {motriz, arrastre} + carrocería/enganche, y `viajes.unidad_arrastre_id` (FK a `vehiculos`, nullable). **Condiciones del PO para el DDL (se presenta antes de aplicar):**

1. **0..1 arrastre** aceptado como deuda declarada — crear follow-up stub en `.specs/_followups/` para 0..N/bitrén y declararlo en el ADR.
2. **Relajar `capacity_kg`** — un tracto no carga solo y el Zod actual lo exige positivo. Definir semántica por categoría también para `curb_weight`/`consumption`.
3. **CHECK tipo↔categoría en BD**; el resto de coherencias en runtime + tests (precedente del espejo): un arrastre nunca puede ser `asignado_a_vehiculo_id`; compatibilidad tracto↔semirremolque / rígido↔remolque se valida al armar la configuración en W4c.
4. **Mapping expand/contract de datos existentes** (`semi_remolque`, `refrigerado`, `tanque`) presentado junto al DDL — la columna `type` vieja **no se dropea hoy**.

## Hallazgos de auditoría W1.1 que ajustan el plan

- Segundo consumo de token = **403 anti-oráculo** (no 409): deliberado, documentado en spec de Fase 1. La UI onboarding-admin (W1.3) debe tratar 403 como "token inválido/expirado/consumido" sin distinguir.
- **W1.4 (link copiable) es la única vía de entrega del token** — el approve no lo devuelve hoy y el notifier es stub. Exponerlo en la respuesta del approve está mandatado por el plan del PO.
- Activación (W1.5) bloqueada además por: reaper T1.7 sin agendar en Cloud Scheduler (falta Terraform) y `ONBOARDING_TOKEN_SIGNING_SECRET` sin provisionar en GSM/Terraform.
