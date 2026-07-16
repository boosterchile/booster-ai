# Viabilidad de RLS (Row Level Security) como segunda barrera multi-tenant

**Fecha**: 2026-07-15. **Alcance**: READ-ONLY (repo + prod vía `scripts/db/agent-query.sh`); cero DDL, cero políticas escritas.
**Insumo**: censo multi-tenant 2026-07-14 (`informe.md`, veredicto B — aislamiento real en capa app, 0 queries sin filtro, 0 RLS en Postgres).
**Objetivo**: mapear qué rompería RLS y qué excepciones necesitaría, ANTES de diseñar nada.

---

## RECOMENDACIÓN: (iii) — linter extendido primero; RLS como proyecto posterior con prerrequisitos

Tres hechos la fuerzan:

1. **La arquitectura de conexión hoy hace a RLS un no-op o un big-bang.** Un solo rol (`booster_app`) para api + gateway + processor + document-service + jobs + **migraciones**, y ese rol **es dueño de las 39 tablas** → el owner bypasea RLS salvo `FORCE ROW LEVEL SECURITY` por tabla. Activar RLS exige: roles nuevos por clase de servicio, secrets/URLs nuevos, GUC de tenant por transacción en el api (con pool compartido = envolver cada query en transacción con `SET LOCAL` — refactor invasivo del data layer), y FORCE en 25 tablas. No hay versión incremental barata.
2. **El core del marketplace es cross-tenant en su costura.** No son solo jobs: el matching inserta `ofertas` para carriers dentro del request del shipper, el carrier actualiza `viajes` del shipper al aceptar, la entrega es bilateral, el chat valida dos tenants por mensaje. La política "empresa_id = tenant de sesión" se rompe exactamente en el flujo de negocio principal — 32 sitios de escritura sin tenant de sesión + ~6 escrituras cross-tenant con sesión.
3. **El 80% del valor está en cerrar el punto ciego del linter**, que es capa estática, sin riesgo de runtime, y con costo medido (números abajo).

---

## 1. ROLES DE DB — un rol para todo; el owner bypasea RLS

| Servicio | Conexión | archivo:línea |
|---|---|---|
| api (+ **migraciones in-process al boot**, `main.ts:32` → `db/migrator.ts`) | pool pg con `config.databaseUrl` | `apps/api/src/db/client.ts:19` |
| telemetry-tcp-gateway (GKE) | pool pg `config.DATABASE_URL`; K8s secret `telemetry-gateway-secrets` | `apps/telemetry-tcp-gateway/src/main.ts:55-59`; `infrastructure/k8s/telemetry-tcp-gateway.yaml:147-151` |
| telemetry-processor | pool pg `config.DATABASE_URL` | `apps/telemetry-processor/src/main.ts:60-61` |
| document-service | pool pg `config.DATABASE_URL` | `apps/document-service/src/main.ts:49-50` |
| Fuente del secret | **ÚNICO** `database-url` compartido vía `common_env_vars`/`common_secrets` | `infrastructure/security.tf:175`; versión real `data.tf:291-292`; wiring `compute.tf:38,53` |
| Usuario | `booster_app` (password-based, mantenido para Cloud Run) | `infrastructure/data.tf:226` (creación), `:150` (comentario de uso) |

**Prod (read-only, 2026-07-15)**: 3 roles con login — `booster_app`, `dev@boosterchile.com` (IAM), `postgres`. Ninguno `BYPASSRLS`, ninguno superuser. **`booster_app` es owner de las 39 tablas** (`pg_tables`). Además `apps/api/src/db/client.ts` no setea ningún GUC de sesión — no existe `set_config`/`current_setting` de tenant en el repo.

**Implicancia**: (a) sin `FORCE ROW LEVEL SECURITY` tabla por tabla, RLS no aplicaría a nadie; (b) con un solo rol, RLS no puede distinguir api-tenant vs pipeline vs jobs — el diseño mínimo real es 3 roles (`app_tenant` + GUC, `app_pipeline` BYPASSRLS, `app_admin`/migraciones) + separar el secret por servicio + transacción con `SET LOCAL` alrededor de cada query del api. El pipeline post-viaje y los crons **viven dentro del proceso del api** compartiendo el mismo pool que las rutas tenant-scoped → separarlos por rol implica doble pool dentro del api.

## 2. ESCRITURAS SIN TENANT DE SESIÓN — 32 sitios (cada uno = política especial o INSERT roto)

Detalle completo con archivo:línea en 7 contextos (rastreo exhaustivo; Drizzle + raw SQL):

**A. Consumers Pub/Sub (6)**: `telemetry-processor/src/persist.ts:73` INSERT `telemetria_puntos` (tenant vía `vehiculo_id`); `persist-green-driving.ts:107` INSERT `eventos_conduccion_verde`; `telemetry-tcp-gateway/src/imei-auth.ts:86` upsert `dispositivos_pendientes` (global, keyed IMEI); `document-service/src/document-store.ts:51/:82/:116` UPDATE `documentos_transporte` por uuid.

**B. Intake WhatsApp (1)**: `apps/api/src/routes/trip-requests.ts:34` INSERT `borradores_whatsapp` — fila **sin tenant** (se asigna al promover a viaje).

**C. Pipeline post-viaje fire-and-forget (9)** — tenant derivado de FK del trip/assignment, no de sesión: `calcular-metricas-viaje.ts:350/:353/:536`, `calcular-score-conduccion-viaje.ts:114`, `generar-coaching-viaje.ts:141`, `actualizar-factor-matching.ts:253` (todos `metricas_viaje`); `emitir-certificado-viaje.ts:302` (`metricas_viaje`) y `:312` (`eventos_viaje`); `liquidar-trip.ts:177` INSERT `liquidaciones`. (`jobs/backfill-certificados.ts:178` despacha a estos mismos writes.)

**D. Crons / Cloud Run Jobs (6)**: `cobrar-memberships-mensual.ts:269/:420` INSERT/UPDATE `facturas_booster_clp`; `procesar-cobranza-cobra-hoy.ts:153` UPDATE `adelantos_carrier`; `purgar-posiciones-movil.ts:23` DELETE raw `posiciones_movil_conductor`; `chat-whatsapp-fallback.ts:232` UPDATE `mensajes_chat`; `jobs/merge-duplicate-users.ts:191` UPDATE raw multi-tabla (`membresias`, `viajes`, `asignaciones`, `eventos_viaje`, `dispositivos_pendientes` — pg crudo, **inherentemente necesita BYPASSRLS**).

**E. Onboarding / activación driver (5)**: `onboarding.ts:270/:289` INSERT `membresias`/`carrier_memberships` (empresa creada en la misma tx — pre-tenant); `auth-driver.ts:219/:229` UPDATE/INSERT `membresias` (RUT+PIN, sin empresa activa); `assignments.ts:442` INSERT `posiciones_movil_conductor` (driver-scoped, sin empresa de sesión).

**F. Impersonación (1)**: `auth-impersonate.ts:193` INSERT `eventos_impersonacion` con `empresaId: null` explícito.

**G. Admin platform-wide (3)**: `admin-cobra-hoy.ts:240` UPDATE `adelantos_carrier`; `:295` UPDATE `shipper_credit_decisions`; `admin-stakeholder-orgs.ts:280` INSERT `membresias`.

**Además, ~6 escrituras cross-tenant CON sesión** (empresa de sesión ≠ empresa de la fila — políticas bilaterales obligatorias): matching inserta `ofertas` para carriers dentro del request del shipper (`matching.ts:321`, `notify-offer.ts:141`); el carrier al aceptar hace UPDATE de `viajes` del shipper (`offer-actions.ts:212`); entrega bilateral (`confirmar-entrega-viaje.ts:214/:222/:234`); chat 2-partes (`chat.ts:253/:387`).

Tablas que **solo** reciben writes por rutas sin sesión: `telemetria_puntos`, `eventos_conduccion_verde`, `borradores_whatsapp`, `metricas_viaje`, `liquidaciones`, `facturas_booster_clp`, `eventos_impersonacion`, `shipper_credit_decisions`.

## 3. CROSS-TENANT LEGÍTIMO — lecturas que exigirían BYPASSRLS o política permisiva

- **Matching (core)**: descubrimiento de candidatos a través de TODAS las empresas — `zonas` `matching.ts:158-167`, `empresas` `:175-184`, `vehiculos` `:222-235`; v2 acotado por set (`matching-v2-lookups.ts:73/:92/:114/:135`); "próximo trip del vehículo" cruza shippers (`actualizar-factor-matching.ts:202-218`). Corre **dentro del request del shipper** → con GUC de sesión del shipper, RLS lo bloquearía: excepción en el corazón del producto.
- **K-anon**: `stakeholder-zonas.ts:144-163` agrega viajes de todos los carriers (gate k≥5 en `:189/:211`); backtest platform-admin (`matching-backtest.ts:183/:360/:375/:401`).
- **Chat 2-partes**: `chat.ts:155-181` resuelve carrier Y shipper en una query.
- **Tracking público por token**: `get-public-tracking.ts:173-191` (assignments⨝trips⨝vehicles por token) y `:210-227` (posiciones) — sin tenant por diseño.
- **Jobs**: `backfill-certificados.ts:128-140`; `cobrar-memberships-mensual.ts:139-174`; `procesar-cobranza-cobra-hoy.ts:105-167`; `merge-duplicate-users.ts` y `reap-inert-idp-accounts.ts:140-160` (**pg crudo**).
- **Notificadores server-side** que derivan la empresa del recurso: `route-safety-recipients.ts:47-97`, `notify-offer.ts:69-104`, `web-push.ts:188-236` (dos tenants), `chat-whatsapp-fallback.ts:79-150`.
- **Otros**: unicidad global de conductor (`conductores.ts:310-315`), login driver pre-empresa (`auth-driver.ts:130-136`), posición del driver por `driverUserId` (`assignments.ts:420-430`).

## 4. PLATFORM-ADMIN — 33 endpoints en 7 archivos

| Archivo | Endpoints | Tablas Postgres tocadas |
|---|---|---|
| `admin-observability.ts` | 12 | ninguna (BigQuery/Monitoring/Twilio/Workspace) |
| `site-settings.ts` | 6 | `configuracion_sitio` (global) |
| `admin-stakeholder-orgs.ts` | 5 | `organizaciones_stakeholder`, `membresias`, `usuarios` |
| `admin-signup-requests.ts` | 3 | `solicitudes_registro`, `usuarios` |
| `admin-matching-backtest.ts` | 3 | `matching_backtest_runs` + lectura cross-tenant `viajes`/`zonas`/`empresas`/`vehiculos` |
| `admin-cobra-hoy.ts` | 2 | `adelantos_carrier`, `shipper_credit_decisions` (SELECT FOR UPDATE + UPDATE) |
| `auth-impersonate.ts` | 2 | `usuarios`, `membresias`, `empresas`, `eventos_impersonacion` |

(El punto 1 del censo previo resuelve este bloque: todos necesitarían rol admin propio o política by-role. `admin-jobs.ts` NO es platform-admin — auth OIDC de Cloud Scheduler; `admin-dispositivos.ts` es admin de empresa, tenant-scoped.)

## 5. COSTO DE POLÍTICAS — por tabla

**15 con discriminador directo:**

| Tabla | Política | Por qué |
|---|---|---|
| `sucursales_empresa` | **trivial** | `empresa_id = GUC`; writes solo con sesión |
| `conductores` | trivial+1 | directo, pero unicidad global cross-empresa (`conductores.ts:310`) necesita excepción de lectura |
| `vehiculos` | trivial+1 | directo, pero el matching lee candidatos de todas las empresas en el request del shipper (`matching.ts:222`) |
| `zonas` | trivial+1 | sin writes en todo el repo; lectura cross-tenant del matching (`matching.ts:158`) |
| `carrier_memberships` | media | writes con sesión + INSERT pre-tenant (`onboarding.ts:289`) + cron platform-wide lee/cobra |
| `shipper_credit_decisions` | media | escrita SOLO por platform-admin sin sesión; leída por carrier con semántica de shipper ajeno (`cobra-hoy.ts:239`) |
| `ofertas` | **compleja** | INSERT cross-tenant (shipper crea filas del carrier, `matching.ts:321`); lectura/UPDATE por el carrier |
| `asignaciones` | **compleja** | bilateral: carrier escribe, shipper lee, contraparte actualiza en entrega |
| `viajes` | **compleja** | tenant NULLABLE (draft WhatsApp, `schema.ts:1172`), UPDATE del carrier sobre fila del shipper (`offer-actions.ts:212`), pipeline sin sesión |
| `mensajes_chat` | **compleja** | dos partes legítimas por fila (`chat.ts:155-181`); cron UPDATE sin sesión (`chat-whatsapp-fallback.ts:232`) |
| `membresias` | **compleja** | pivot user↔empresa (se filtra por user, no empresa), XOR stakeholder nullable (`schema.ts:776-782`), inserts pre-tenant/driver/admin |
| `liquidaciones` | **compleja** | INSERT únicamente desde pipeline sin sesión (`liquidar-trip.ts:177`) |
| `facturas_booster_clp` | **compleja** | writes únicamente cron (`cobrar-memberships-mensual.ts:269/:420`) |
| `adelantos_carrier` | **compleja** | DOS columnas de tenant (carrier+shipper, `schema.ts:2252/:2255`); writes de cron y admin |
| `eventos_impersonacion` | **compleja** | `empresa_id` NULL explícito escrito por admin (`auth-impersonate.ts:193`) |

**10 con scoping indirecto — todas complejas** (política = subquery/join a la tabla madre): `documentos_vehiculo`/`documentos_conductor` (join a vehiculos/conductores — las menos malas), `eventos_viaje` (join viajes + inserts bilaterales y de pipeline), `metricas_viaje` (join viajes; writes solo pipeline), `telemetria_puntos` (join vehiculos; **INSERT masivo del processor → costo por fila en el hot path de ingesta**), `eventos_conduccion_verde` (ídem), `posiciones_movil_conductor` (join; INSERT driver sin empresa + DELETE cron), `documentos_transporte` (join viajes; worker por uuid), `borradores_whatsapp` (tenant NULL hasta promoción → política de tenant inaplicable), `dispositivos_pendientes` (global por diseño — quedaría fuera de RLS de tenant).

**Balance: 1 política trivial limpia, 3 triviales-con-excepción, 2 medias, 19 complejas o inaplicables.**

## 6. ALTERNATIVA LINTER — extenderlo es barato en glob, acotado en ruido

- Scope actual: constante `ROUTES_DIR` en `scripts/lint-rls.mjs:28` — ampliar a `services/`+`jobs/` es un cambio de una línea. **Nada estructural lo impide.**
- Costo real medido (censo con la misma lógica del linter sobre `services/`): de 143 sitios Drizzle, **52 flaggearían** → ~11 son falsos positivos del regex (`Buffer.from(saltHex,…)` matchea `.from(` — clase que se arregla validando el identificador contra el set de tablas del schema), ~13 se resuelven agregando 4 tablas a `TENANT_FREE_TABLES` (`solicitudesRegistro`, `matchingBacktestRuns`, `empresas`, `membershipTiers`), y **~28 son el pipeline "scoped-por-id-validado"** que requieren `// rls-allowlist:` uno a uno (media hora c/u con criterio, es exactamente el inventario del punto 2/3 de este informe).
- Punto ciego restante: **raw SQL** — 19 sitios en `services/` + 16 en `jobs/` invisibles al regex (`lint-rls.mjs:68`). Cubrirlos = extender el matcher (`db.execute(sql\``/`pool.query`) o declararlos explícitamente fuera de alcance con check aparte. `jobs/` Drizzle: 0 findings.

---

## Justificación final de (iii)

RLS aquí no es "agregar políticas": es re-arquitecturar la capa de conexión (roles, secrets, GUC transaccional, FORCE en 25 tablas, doble pool en el api) y escribir ~19 políticas complejas cuyo caso difícil es el flujo de negocio principal (marketplace bilateral). El riesgo que el PO quería mapear es real: telemetría (INSERT con join-policy en el hot path), matching (lectura y escritura cross-tenant dentro del request del shipper) y jobs de plataforma (pg crudo que necesita BYPASSRLS) son exactamente los tres puntos que un RLS naïve rompe. La opción (i) queda descartada por el conteo (32 writes sin sesión + 19 políticas complejas ≠ "excepciones pocas y limpias"); (ii) es tecnicamente cierta pero domina (iii): extender el linter a `services/`+`jobs/`+raw-SQL entrega la misma clase de garantía (ninguna query nueva sin filtro pasa CI) sobre el 100% del código, sin tocar runtime, con ~28 anotaciones + 2 fixes de matcher como costo total. Si después de eso el PO aún quiere defensa en profundidad a nivel DB, este informe ES el mapa de prerrequisitos, y el primer candidato acotado sería RLS solo sobre las 4-6 tablas de lectura de UI tenant-puras (`sucursales_empresa`, `documentos_*`, `conductores`, `vehiculos`) con rol dedicado solo para las rutas — no un rollout global.

**No se escribió ninguna política ni se tocó la DB.** Este informe decide, no implementa.
