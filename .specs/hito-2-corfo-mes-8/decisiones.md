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

---

## Estado de cierre de sesión — 2026-07-07 ~04:06 America/Santiago

**Hito 2 CORFO técnicamente cerrado esta noche.** Batch W1+W2+W3+W4a en `main` y desplegado a prod con activación de usuarios aplicada.

### Desplegado y verificado por REST
- **W1** (PR #565, merge `62453ae`): alta de usuarios E2E, flip de ambos flags APLICADO (revisión `booster-ai-api-00375-wkx`, `ADMIN_PROVISIONED_ONBOARDING_ENABLED=true` + `SIGNUP_REQUEST_FLOW_ACTIVATED=true`, `EMPRESA_SELF_ONBOARDING` ausente/false SC3, secret v2 real montado). Acta del PO firmada (runbook Paso 4).
- **W2** (PR #566): IMEI self-service + reconciliación pending_devices + CAS anti-TOCTOU + 1ª métrica de negocio del API.
- **W3** (PR #567): telemetría de temperatura Dallas (catálogo + simulador + endpoint + UI).
- **W4a** (PR #568, merge `43a5af0`): tipologías de flota + GLEC por configuración; **migración 0048 aplicada en prod** (15 vehículos backfilleados a `motriz/camion_rigido`, columna `asignaciones.unidad_arrastre_id` creada). ADR-073.
- Infra: secret `onboarding-token-signing-secret` (v2 real) + scheduler `reap-orphan-onboarding-firebase` (PAUSED) creados por targeted apply + gcloud.
- Gobernanza: 17 deny rules en `.claude/settings.local.json` (D5); régimen de autonomía con auto-merge revocado.

### Pendiente inmediato (smoke matinal 2026-07-07 AM — ver `docs/corfo/hito-2/smoke-test-manana.md`)
- **Paso 6**: tick manual del reaper (resume→run→pause) + revisar summary dry-run. Higiene, no bloqueante.
- **Paso 7**: E2E del alta (signup→approve→link→onboarding→/me) + cadena demo (IMEI UI→simulador W3→screenshot posición+temperatura). Diferido por regla de parada (flujo multi-tap, 04:06).
- **Paso 8**: llenar el placeholder `[PENDIENTE — smoke AM]` del trace E2E en `informe-hito-2.md` y `meta-1-crud-auth.md` con el resultado real + monitoreo 2h post-deploy.

### Pendientes fechados (mes 9 salvo indicado)
- **W4b** (mañana AM si alcanza, si no mes 9): registro de arrastres/carrocerías en la UI de flota; **retira la derivación temporal C1** (`.specs/_followups/retiro-derivacion-unit-type-create.md`) y revisa los 15 rows backfilleados (caveat D4.1: posibles tractos como `camion_rigido`).
- **W4c** (mes 9): acción "Iniciar viaje" del conductor + medición de huella anclada al inicio; implementa las 12 tareas restantes de `.specs/medicion-huella-segmento` y agrega el test de integración del FK RESTRICT de `unidad_arrastre_id`.
- **Import del scheduler a Terraform** (diurno próximo): `terraform import google_cloud_scheduler_job.reap_orphan_onboarding_firebase ...` validando params (schedule/uri/oidc/retries) → apply sin diff. El recurso ya existe en prod idéntico al TF.
- **Reconciliación TF diurna** (fuera de la ruta crítica nocturna): el `terraform plan` traía 18 add / 15 change (drift de PRs mergeados sin aplicar). Aplicar con runbook propio y verificación de operación Redis real (lección ADR-058): monitoring/SLO (#535), scheduler memberships (#530), `datadog-api-key` (decidir crear vía TF o corregir ADR-071 — el secret NO existe en GSM), y **migración `redis-auth`** servicio-por-servicio (blast radius 7 services, clase #520 ya corregida en código pero no aplicada).
- **Fase 2 email notifier** (mes 9): swap `EmailSignupRequestNotifier` para entrega automática del link (hoy manual — desviación 8).
- Otros follow-ups creados esta noche en `.specs/_followups/`: `login-universal-redirect-param`, `login-retiro-boton-crea-una-legacy`, `router-mocks-audit-critical-flows`, `runbook-tuteo`, `solicitar-acceso-cleanup`, `login-link-url-https`, `imei-reconciliacion-integration-test-postgres`, `vehiculos-router-otel-spans`, `flota-bitren-0-n-arrastres`.
