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

## D4 · W4a: DDL 0048 APROBADO con FK en asignaciones (2026-07-06)

El PO aprueba la migración 0048 expand-only (enums `categoria_unidad`/`tipo_unidad`/`tipo_carroceria`, columnas nuevas en `vehiculos` con CHECK tipo↔categoría tolerante a NULL, backfill según mapping, `asignaciones.unidad_arrastre_id` FK a vehiculos ON DELETE RESTRICT + índice parcial) **con la corrección de FK en `asignaciones`** (el plan original atribuyó mal el `asignado_a_vehiculo_id`, que pertenece a `dispositivos_pendientes`). **Cinco condiciones antes del apply:**

1. El caveat "revisar rows reales del piloto en W4b UI" se extiende a **`camion_pesado→camion_rigido`**: el enum viejo no tenía tracto — los tractos del piloto están casi seguro registrados como `camion_pesado`. (Aplica también a refrigerado/tanque como ya estaba.)
2. **Zod exige `tipo_unidad` en toda escritura nueva** (NULL solo para rows legacy); la fase **contract** endurece la columna a NOT NULL — dejarlo escrito en el plan de contract (del ADR/migración).
3. **CHECK same-row en `asignaciones`**: `unidad_arrastre_id IS NULL OR unidad_arrastre_id <> vehiculo_id`.
4. Follow-up stub 0..N/bitrén: ✅ ya existe (`.specs/_followups/flota-bitren-0-n-arrastres.md`, commit cd73e95).
5. **`curb_weight_kg` sigue requerido para `arrastre`** (tara del semi = insumo GVW/GLEC); solo `consumption_l_per_100km_baseline` y `fuel_type` van null.

Semántica Zod por categoría aprobada: `tracto_camion` → `capacity_kg = 0` permitido y consumo requerido; `arrastre` → capacity > 0, consumo/fuel null, IMEI opcional (asset-tracker); demás motrices como hoy. Coherencias runtime+tests (D1.3): arrastre nunca en `vehiculo_id` de asignaciones; compatibilidad tracto↔semirremolque / rígido↔remolque al armar la configuración (W4c). Clase GLEC por configuración: con arrastre → articulado (HDV); motriz sola → por GVW (curb+capacity); derivada en el service y pasada explícita al carbon-calculator (su API ya acepta `categoria`).

## Hallazgos de auditoría W1.1 que ajustan el plan

- Segundo consumo de token = **403 anti-oráculo** (no 409): deliberado, documentado en spec de Fase 1. La UI onboarding-admin (W1.3) debe tratar 403 como "token inválido/expirado/consumido" sin distinguir.
- **W1.4 (link copiable) es la única vía de entrega del token** — el approve no lo devuelve hoy y el notifier es stub. Exponerlo en la respuesta del approve está mandatado por el plan del PO.
- Activación (W1.5) bloqueada además por: reaper T1.7 sin agendar en Cloud Scheduler (falta Terraform) y `ONBOARDING_TOKEN_SIGNING_SECRET` sin provisionar en GSM/Terraform.

## D2b · Verificado: el rechazo de pending devices NO es tenant-scoped (2026-07-06, W2a)

`dispositivos_pendientes` no tiene `empresaId` (by design, open enrollment global): cualquier `dueno|admin` de CUALQUIER empresa puede listar (`admin-dispositivos.ts:60-78`) y rechazar (`admin-dispositivos.ts:191-216`) pending devices ajenos. **Por eso el rechazo no puede ser terminal**: sería un vector de denegación cruzada (empresa A rechaza el device que empresa B está por reclamar). El PATCH de W2 lo mitiga con el override en dos pasos de D2 (409 `imei_rechazado` + `confirmar_reasociacion: true`), que convierte el rechazo en un obstáculo reversible por el dueño legítimo, con log estructurado del override. Deuda relacionada (no de hoy): evaluar rate-limit o scoping del reject en el panel.

## D2c · Adición de contrato W2 (2026-07-06, fix round): 409 `pending_device_conflict`

El CAS de la reconciliación agrega un código residual fuera del enum original de D2: cuando el CAS pierde la carrera y el estado fresco NO es `rechazado` (p.ej. aprobado por otra tx concurrente o row ausente), el PATCH responde **409 `pending_device_conflict`** (neutro: no filtra tenant/patente; informacionalmente equivalente a `imei_en_uso`). W2b debe manejarlo deliberadamente: mensaje "el estado del dispositivo cambió mientras guardábamos — reintenta" + refetch. Registrado aquí para que el contrato no viva solo en código (`vehiculos.ts:619-627`).

## D5 · Régimen de autonomía (2026-07-06, ~21:00)

- **(a)** El texto original del régimen ("Configura tú mismo el régimen de autonomía", 5 reglas) **nunca llegó a la sesión** — el PO lo re-enviará; `.specs/policy-decisiones.md` queda pendiente de esa transcripción (NO se inventan reglas). El **punto 3 del régimen (auto-merge) queda REVOCADO** por el propio PO al adoptar la objeción por ADR-072.
- **(b)** Deny rules duras aplicadas a `.claude/settings.local.json` (17 reglas: terraform apply, gcloud run update/deploy/update-traffic, secrets add/create, scheduler run/resume, gh pr merge, push a main/force, gh api mutante, agent-query -y) DESPUÉS del squash-merge de #565 autorizado explícitamente (secuencia definida por el PO). Verificadas en vivo con probe denegado.
- **(c)** ADR-072 se mantiene: merge a `main` = decisión del PO por mensaje explícito, sin auto-merge. Con las deny rules activas, la EJECUCIÓN del merge también es del PO (el agente ya no puede ejecutar `gh pr merge` ni autorizado — la deny rule es dura a propósito).
