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

## Defecto 2b corregido — audience OIDC del reaper (URL vanity vs número de proyecto) — 2026-07-07 AM

Al crear el scheduler `reap-orphan-onboarding-firebase` por gcloud (paso 2b, 2026-07-06 noche), se usó la forma **vanity** de la URL de Cloud Run (`booster-ai-api-wbfevjot4q-tl.a.run.app`, tomada del campo `.uri` del servicio) como `uri` y `oidc.audience`. El `cronAuthMiddleware` de la app verifica el `aud` del token OIDC contra la forma con **número de proyecto** (`booster-ai-api-469283083998.southamerica-west1.run.app`, = `local.cloud_run_api_url` en TF, la que usan todos los jobs creados por Terraform). Mismatch → el primer tick devolvió **HTTP 401** (rechazado en auth, sin ejecutar la lógica: no hubo summary, no hubo scan ni borrados).

**Fix (PO, 2026-07-07 12:55:55Z)**: `gcloud scheduler jobs update http` con `uri` + `oidc-token-audience` en la forma con número de proyecto. Re-tick 12:57:00Z → **HTTP 200** + summary `{scanned:0, deleted:0, deferred:0, alreadyGone:0, errors:0, destructive:false}` (dry-run confirmado, 0 huérfanos — esperado, no ha habido approves reales todavía). Job de vuelta en `PAUSED`.

**Lección para el import a TF** (pendiente fechado): `local.cloud_run_api_url` YA trae la forma correcta (número de proyecto) — el `terraform import` del scheduler reconciliará `uri`+`audience` sin diff SOLO si el estado de prod ya usa esa forma (ahora sí, tras el fix). Verificar que el plan post-import sea no-op en esos dos campos. NO usar nunca la URL vanity `.uri` para audiences OIDC en jobs manuales.

## Corrección de diagnóstico — el panel admin NO falta (error de URL del agente) — 2026-07-07 AM

Durante el smoke E2E (paso 7a) el agente indicó la URL `/platform-admin/signup-requests` (sin prefijo `/app`) → el PO obtuvo "Not Found" y se planteó como posible gap de W1 ("UI del panel no desplegada"). **Verificado contra `origin/main`: la premisa es falsa, la UI existe y está ruteada.**

Evidencia:
- Página `apps/web/src/routes/platform-admin-signup-requests.tsx` (+ `.test.tsx`) presente en main (PR #565).
- Ruta registrada: `router.tsx:264` (`createRoute`, path **`/app/platform-admin/signup-requests`**) + en el `routeTree` (`addChildren`, línea 418).
- Gate: `BOOSTER_PLATFORM_ADMIN_EMAILS` (allowlist server-side, 403 si no está). **Verificado en prod: = `dev@boosterchile.com`** (el PO ES el platform admin). NO es un rol de login (los 5 roles del login son de empresa/tenant, ortogonales).
- Endpoint de aprobación existe: `POST /admin/signup-requests/:id/approve` (`admin-signup-requests.ts:153`, gate `requirePlatformAdmin` + `requireFlowActivated`), su respuesta devuelve `onboarding_link` (W1.4).

**Raíz del bloqueo**: error del agente al citar la ruta (omitió el prefijo `/app`), no un defecto de W1. Camino correcto para aprobar: login como `dev@boosterchile.com` → `/app/platform-admin/signup-requests` → Aprobar → link copiable de un solo uso. Sin trabajo de UI pendiente.

**Lección**: no citar rutas de UI sin verificarlas contra el router (regla del contrato: "cita solo lo que verificaste"). El agente asumió la URL en vez de leer `router.tsx`.

## Evidencia protegida Meta 2 — dispositivo Teltonika real (INTOCABLE) — 2026-07-07 AM

**Único dispositivo real de la operación, evidencia crítica de telemetría en producción. NO reasignar su IMEI, NO apuntarle el simulador, NO tocar su empresa/vehículo en ningún E2E.**

- **Empresa**: Transportes Van Oosterwyk (RUT `76653720-0`, empresa_id `60c344e0-b925-43a6-a7b3-aa6b07fac721`).
- **Vehículo**: patente **VFZH-68** (vehiculo_id `6487dac2-600e-4655-a20e-2ea77a6b1017`).
- **IMEI**: `863238075489155` (sin espejo).
- **Ventana de datos** (verificada read-only 2026-07-07): **239.148 puntos** totales, primer punto 2026-05-05 12:00 UTC, último 2026-07-07 13:53 UTC (emitiendo en vivo), **105.856 puntos en 30 días** continuos.
- **Sensores**: **solo GPS** — `io_data` reciente = `{16,21,24,66,67,68,69,80,181,182,199,200,239,240,241,388}` (Low-Priority estándar: ignición 239, movimiento 240, voltajes 66-69, GSM 21, odómetro 16). **NO tiene IO Dallas Temperature (72-75)** → `tiene_dallas_temp=false` en todos los puntos.

**Consecuencia para la cadena demo (W3 / Meta 2)**: la demostración de temperatura DEBE correr el simulador W3 sobre un **vehículo de prueba con IMEI de demo distinto** — nunca el `863238075489155`. El simulador prueba la **habilitación** del pipeline de temperatura (codec8 → io_data['72'] → interpretación °C → UI vehiculo-live), NO operación real de un sensor físico.

**Para la matriz W5 (dos evidencias SEPARADAS, no confundir)**:
1. **Operación real (GPS)**: Van Oosterwyk / VFZH-68 / IMEI 863238075489155 — 105.856 puntos/30d. Prueba telemetría GPS en producción real. Evidencia dura de Meta 2 (IoT).
2. **Habilitación de temperatura**: simulador W3 sobre vehículo de prueba + IMEI demo. Prueba que el pipeline de temperatura funciona end-to-end (posición + °C en vehiculo-live), NO que exista un sensor físico de temperatura en la flota hoy.

## Regla dura — IMEI real de Van Oosterwyk NO se reutiliza para la demo (2026-07-07)

**El IMEI real `863238075489155` (Van Oosterwyk / VFZH-68) NO se reutiliza para la demo bajo ninguna circunstancia** — evidencia de operación real protegida. Razones verificadas:
- **(a) No daría realismo**: el dispositivo real no emite temperatura (`tiene_dallas_temp=false`), así que el simulador tendría que inyectar la temperatura igual — cero ganancia de realismo.
- **(b) Contaminaría la evidencia**: emitir el simulador contra ese IMEI mezclaría datos sintéticos con los 239.148 puntos de telemetría real, y podría interferir con el dispositivo físico que está vivo emitiendo ahora (último punto hoy 13:53 UTC).

**Costo de evitarlo: cero.** La habilitación de temperatura se prueba con **IMEI demo sintético `990000000000017`** (verificado sin colisión en `teltonika_imei`/`teltonika_imei_espejo`/`dispositivos_pendientes`; prefijo `99` distinto del `863238` real para distinción visual en el informe) sobre un **vehículo de prueba** de la empresa nueva (piloto-smoke). Van Oosterwyk es además la **beneficiaria del convenio CORFO** — citar así en el informe (evidencia de operación real GPS en producción).

**IMEI demo reservado: `990000000000017`** (15 dígitos, sintético). El simulador W3 solo apunta acá; nunca al real.
