# Estado actual del proyecto — Booster AI

**Última actualización**: 2026-09-22 · `main` = `cf76ea8` (`git ls-remote origin refs/heads/main` → `cf76ea81aeed`) · prod Cloud Run = imagen `428ff51` (api rev `booster-ai-api-00610-qaw`) · gateway GKE = `33d179d`. **Prod está 2 PRs detrás de `main`**: #706 y #707, con la migración 0056, sin desplegar. **PRs abiertos**: #708 (Routes API) y #709 (este handoff). Horas en UTC; Santiago = UTC−3.
**Anterior**: 2026-07-25, archivado en [`2026-09-22-snapshot-current-2026-07.md`](2026-09-22-snapshot-current-2026-07.md). Dos afirmaciones de ese CURRENT ya no valen (se marcan con «corrige»).
**Método**: solo lectura. GCP por REST con token ADC y `X-Goog-User-Project: booster-ai-494222`; BD con `scripts/db/agent-query.sh` (solo SELECT, sin `-y`). Lo que no se verificó se dice explícitamente.
**Documento vivo**: el detalle histórico está en los snapshots fechados (ver §Snapshots archivados). Contrato de trabajo: `CLAUDE.md`. Slots de trabajo: `docs/frentes-vivos.md`.

---

## Estado de prod (verificado 2026-09-22)

| Componente | Estado | Fuente |
|---|---|---|
| `booster-ai-api` | 100 % en `00610-qaw`, imagen `api:428ff514698b…` (digest `sha256:7101c3ee…`, creada 2026-09-22T00:12:19Z). **Promovida a mano** por `dev@boosterchile.com` (ReplaceService 2026-09-22T00:55:44Z = 21:55 del 21-09 en Santiago). **El tráfico no está mixto.** El 100 % se asigna por `REVISION` (tag `canary-signup-428ff514698b`), no por `LATEST`; **corrige** el CURRENT anterior (líneas 76-80). Quedan 13 tags `canary-signup-*` (de `00571-goc` a `00610-qaw`) sin porcentaje | Cloud Run v2 REST `trafficStatuses`; Audit Log `Services.ReplaceService` |
| web · whatsapp-bot · telemetry-processor · sms-fallback-gateway | 100 % en `LATEST` (`00381-rgv`, `00426-fn2`, `00380-64b`, `00364-bqp`), imagen `:428ff514698b…`, updateTime 2026-09-22T00:11:41Z | Cloud Run v2 REST |
| matching-engine · document-service · notification-service | `gcr.io/cloudrun/placeholder` (`00005-nwf`, `00007-8ts`, `00007-pnt`) desde 2026-07-12T20:34:16Z | idem |
| Salud Cloud Run | 8/8 servicios con latestCreated = latestReady y `CONDITION_SUCCEEDED`. No hay servicios en otras regiones (`locations/-`) ni jobs en southamerica-west1 | idem + `GET …/jobs` → vacío |
| telemetry-tcp-gateway (GKE `booster-ai-telemetry`) | Imagen `33d179d0d347…`, último pull 2026-09-21T15:05:37Z. Desde `33d179d` hay 0 commits en el gateway, codec8-parser, config, logger y otel-bootstrap, y 4 en shared-schemas. **El impacto de esos 4 no está verificado** (kubectl no alcanza el control plane) | Cloud Logging `k8s_pod`; `git log 33d179d0d347..origin/main -- …` |
| Migraciones | Prod tiene **56** (última: `0055_fuente_dato_ruta_movil_gps`, created_at 1780876800019, max id 108). `main` tiene **57** (`0056_empresas_umbrales_robo_combustible`, #707). Hay 0 columnas `empresas.umbral_robo_%` en prod. El api corre con `STRICT_MIGRATION_ORDERING=false` | agent-query.sh sobre `drizzle.__drizzle_migrations` e `information_schema.columns`; `_journal.json`; env del api |
| En `main` y no en prod | #706 (`f7aee3a`, pin del posible robo, merge 2026-09-22T00:20Z) y #707 (`cf76ea8`, umbral de golpe/robo hormiga + migr 0056, 00:42Z). `428ff51` es ancestro de main; el diff son 24 archivos (13 api, 7 web, 2 shared-schemas, 2 `.specs`) | `git log 428ff514698b..origin/main`; `git merge-base --is-ancestor` |
| Env del api | **No tiene** `CONTENT_SID_ACTIVACION_CONDUCTOR`, `RESEND_API_KEY`, `REQUIRE_DOCUMENT_TO_CLOSE_SINCE` ni `OTEL_*`. Tiene `DEMO_MODE_ACTIVATED=false` + 5 `DEMO_*` | Cloud Run REST |

### Datos de prod (agent-query.sh, 2026-09-22 ~18:47–18:50Z)
- **Viajes entregados: 6.** 1 es sintético (`SYN-PLFL5701`, sin métricas ni certificado). De los 5 reales, solo `BOO-BKAXIK` es de un generador que no es de prueba (Fuera de la Caja, `es_usuario_prueba=f`). Los 4 del 21-09 (`BOO-KJHITL`, `LCTSE5`, `PMGQWN`, `83ND2C`) son de «Prueba Generador SpA» (`es_usuario_prueba=t`). Ninguno es de una empresa `es_demo`.
- **Certificados: 5**, todos `secundario_modeled`. El primero es del 2026-09-14 21:40:40Z (BKAXIK) y el último del 2026-09-21 19:39:12Z (83ND2C). BKAXIK: `teltonika_gps`, cobertura 100,00, distancia_km_real 2,51, emisiones_kgco2e_reales 2,691. Los 4 del 21-09: `maps_directions`, cobertura 0,00, `distancia_km_real` y `emisiones_kgco2e_reales` en NULL.
- **Conductores: 7** no eliminados, todos `activo` y ninguno de una empresa de prueba o demo. **Solo 1 está activado** (último login 2026-09-21 16:03:49Z). Los otros 6 tienen `pending-rut:*` con PIN vigente. La activación no sale por ningún canal: el api no tiene `CONTENT_SID_ACTIVACION_CONDUCTOR` ni `RESEND_API_KEY`, y el secreto `resend-api-key` da 404 (Secret Manager REST).
- **Opt-in de huella**: 1 empresa con `carbon_measurement_enabled` (Transportes Van Oosterwyk, activa, ni de prueba ni demo).
- **Salud CAN** (`check-salud-can.sql`, idéntico al de origin/main) sobre 8 vehículos con Teltonika. OK 3: KFKW23, KZXB64 y RCPC20. DEGRADADO sin ID 83, 2: JLKT54 y JWTH77. INTERMITENTE 1: PLFL57, con 1372/5214 pings con CAN en 24 h y 3706 en movimiento sin CAN. SIN CAPACIDAD CAN 2: KZBB26 y VFZH-68. **Corrige** el CURRENT anterior (línea 11), que decía «flota hoy: 0 vehículos con CAN».
- **Otros**: `bitacora_backfill_distancia` = 0 filas; `documentos_transporte` = 0; la última posición móvil es del 2026-09-21 19:39:05Z; hay 1 asignación activa (asignado/recogido) y 0 empresas `es_demo`.
- **Observabilidad**: Monitoring tiene 0 descriptores `custom.`, `workload.` y `external.googleapis.com`, y 14 métricas basadas en logs, ninguna de huella ni de viajes_entregados. `git grep -i metric` en `packages/otel-bootstrap/src` no da resultados.

## CI y deploy

- **Release manual**: `gh workflow run release.yml --ref main`, luego el gate `production` y después Cloud Build canary. **Los últimos 5 runs fallaron**:
  - `35669315935` (428ff51, 2026-09-21T23:49Z, build `b4db3e8f`): canary-verify «FAIL muestra insuficiente (5 < 30)».
  - `35546721224` (a0e98fa, 09-21T00:08Z, `d858403b`): 3 < 30. `34974710808` (71e1d7f, 09-15T13:23Z, `d8cc45ec`): 3 < 30. `34921795377` (726c6d8, 09-15T02:35Z, `2bd5f1b9`): 8 < 30.
  - `34921232199` (726c6d8, 09-15T02:27Z) falló antes, en «Esperar CI Success del mismo SHA», porque CI Success había terminado en failure.
  - Umbrales: ventana de 30 min, error_rate < 1 %, p95 < 500 ms, **min_requests = 30** (`gh run view --log-failed`; Cloud Build REST; Cloud Logging `textPayload:"canary-verify"`).
- **Qué pasa cuando aborta**: en los 4 builds que abortaron en canary-verify (step 17), `deploy-api` (18), `gke-deploy` (23) y `smoke-api-health` (24) quedaron QUEUED. whatsapp-bot, web, telemetry-processor y sms-fallback sí se desplegaron. El api se promueve a mano (así llegó `00610-qaw`). **El último release en success es `30926973385` (2026-08-04T15:59Z, 33d179d).** Desde entonces hubo 14 runs: 13 failure y 1 cancelled (`gh run list --workflow release.yml --limit 40`).
- **CI en `main`** (cf76ea8): CI `35673050480` success y Security `35673050413` success (2026-09-22T00:42Z). La protección de rama exige `CI Success` y `E2E conductor (Auth emulator + API local)` (`gh api …/branches/main/protection`).
- **E2E nightly** (`e2e-staging.yml`, contra prod): 7/7 verdes; la última corrida es `35707173708` (2026-09-22T08:52Z, cf76ea8).
- **Terraform Drift Check**: el último verde es `31944649898` (2026-08-16T11:33Z) y las 8 corridas del 15 al 22-09 dieron failure. `35747885290` (09-22T15:30Z) muestra «Plan: 1 to add, 1 to change, 0 to destroy»:
  - Crea `google_kms_crypto_key_iam_member.cloud_run_certificate_version_viewer`. **El binding ya existe en GCP**: viewer, publicKeyViewer y signerVerifier para `booster-cloudrun-sa` sobre `certificate-carbono-signing`. Es drift solo de state (KMS `getIamPolicy`).
  - En `module.service_api` pasa `revision "booster-ai-api-00610-qaw" → null` y agrega la env `CONTENT_SID_ACTIVACION_CONDUCTOR` (el secreto tiene las versiones 1 y 2 ENABLED desde 2026-08-05; valor no leído).
- **Gitleaks semanal** (Security, cron lunes 03:00 UTC): rojo en las 20 corridas programadas desde 2026-05-04; la última es `35578328272` (2026-09-21T08:31Z). El hallazgo es `generic-api-key` en `cloudbuild.production.yaml`, commit `9b4a44c` (2026-06-03, #401 App Check reCAPTCHA v3), verificado en los logs del 06-29, 07-27 y 09-21. La causa de las corridas de mayo no es verificable (logs expirados; son anteriores a 9b4a44c). `.gitleaks.toml` solo allowlistea por valor la key Web de Firebase y la de Maps, y no existe `.gitleaksignore`. Los scans de push siguen verdes.
- **Hueco del E2E en PRs**: el filtro `conductor` de `e2e-pr.yml:49-60` no incluye `apps/api/src/**`. El agregador required (`if: always()`, `exit 0` con skip documentado) deja pasar sin Playwright un PR que solo toca el API; así pasó en #708.

## Frentes vivos (`docs/frentes-vivos.md`)

`frentes-vivos.md` se cambió por última vez en `2388bb4` (#682, 2026-09-14). Su encabezado dice «verificado contra 623ee2b (2026-08-16)», con una actualización del 2026-09-13 contra `7e99dc0`. La línea 45 dice «lo siguiente es T11», pero `.specs/medicion-huella-segmento/plan.md` tiene 50 `[x]` y ninguna tarea pendiente. **Aquí no se declara cerrado ningún slot: el cierre lo declara el PO.**

- **Slot 1 — huella medida** (criterio en frentes-vivos.md:24: 2 viajes reales, uno con FMC150 y otro sin él, con `*Actual` poblado o con degradación explícita).
  - Con Teltonika: BKAXIK tiene emisiones reales 2,691 y certificado.
  - Sin Teltonika: los 4 del 21-09 tienen `*Actual` = null y certificado `secundario_modeled`, **pero** (a) la degradación la causa el bug de Routes que corrige #708 (no mergeado ni desplegado), (b) el generador es de prueba y (c) no hay métrica data-quality en Monitoring.
  - **Falta**: merge y release de #708 (§6 ya decidida), la decisión ADR-077 estricta vs híbrida (`plan.md:207`) y la decisión sobre la métrica OTel.
- **Slot 2 — retiro del subsistema demo**.
  - El grep del criterio literal (frentes-vivos.md:64) da **52 archivos**, de los que 3 son migraciones históricas en `apps/api/drizzle` y 8 tienen «imperson» en la ruta. La línea 66 todavía dice «40».
  - `demo.boosterchile.com` sigue vivo (A `34.36.187.195`, HTTPS 200).
  - #698 (`d7d799a`) retiró el enforcement `es_demo` del request path.
  - **Todo lo que queda necesita permiso del PO**: jobs de `security.yml`, schema/endpoints/UI, y Terraform/DNS/IAM (pendientes 13-15).
- **Slot 3 — flujo del conductor punta a punta**.
  - La query (frentes-vivos.md:100-107) devuelve 5 filas con conductor, recogida, entrega y certificado.
  - Los pasos 1-6 están mergeados y en prod (428ff51): #674 D1a, #692 UI documental, #686/#696 GPS, #687 vista, #688 higiene y #693/#694 E2E. «E2E conductor» es required.
  - **Dudas abiertas sobre el criterio**: «sin intervención manual del PO» (según el inventario, la oferta la aceptó la cuenta piloto que opera el PO, y el generador es de prueba); el E2E no ejercita la activación (según el inventario, el seed crea al conductor activo); en prod la activación no sale (1 de 7 conductores activados); `documentos_transporte` tiene 0 filas, y `REQUIRE_DOCUMENT_TO_CLOSE_SINCE` no está ni en el env ni en `infrastructure/`.

## PRs abiertos

**#708** `fix/routes-api-body-invalido` (abierto 2026-09-22T18:44:13Z). Al redactar este documento era el único PR abierto además de #709 (`gh pr list --state open`).
- **Estado** (2026-09-22): MERGEABLE/CLEAN, 25 checks en verde y 0 en rojo. Tiene 6 commits sobre main: spec, dos rojos (`e93548a`, `23d72c7`) con sus fixes, y docs. El required «E2E conductor (Auth emulator + API local)» pasó; el job «E2E conductor Playwright» quedó SKIPPED por el filtro de paths.
- **Defectos que corrige** (spec §1-§5, `git show 4f239e8:.specs/fix-routes-api-body-invalido/spec.md`):
  - (A) Una coordenada viaja como `address`.
  - (B) `vehicleInfo` va en la raíz del body y no en `routeModifiers`.
  - (C) La tabla de respaldo usa `RM` y no `XIII`, así que XIII→otra región cae a 500 km: KJHITL y BKAXIK tienen `distancia_km_estimada = 500,00`.
- **Alcance**: no cambia contratos, schema ni fórmulas GLEC, y los 5 certificados emitidos no se tocan. Con este PR, el camino híbrido de #624 se activa por primera vez en prod.
- **Criterio de prod abierto**: cero logs «Address Waypoint» y «Unknown name vehicleInfo» tras el deploy.
- **§6 (hueco con el vehículo detenido)**: el PO la decidió el 2026-09-22 con la opción (a). Extremos idénticos valen 0 km, no llaman a Routes y no cuentan para el tope. Implementada en #708 y registrada como enmienda en `.specs/distancia-real-hibrida/spec.md`. Falta: merge y release.

## Pendientes del PO (priorizados)

> Orden: prioridad del inventario. El ítem 1 y el plazo del 30-09 (ítem 2) los adelantó el agente por criterio propio. Merge, apply y DML los ejecuta el PO; el release lo dispara el orquestador.

1. **Merge de #708** (§6 ya decidida: opción (a), implementada). El release lo dispara el orquestador. Después, verificar cero logs «Address Waypoint» y «Unknown name vehicleInfo», y ningún `routes_error` en el próximo viaje con huecos.
2. **Plazo 2026-09-30: backfill F0-0.**
   - Hecho: «Backstop: 2026-09-30» con retiro de `bitacora_backfill_distancia` (hoy 0 filas; `0053_bitacora_backfill_distancia.sql:14-17`). Es una fecha de revisión documentada, sin enforcement en tests, workflows ni scripts.
   - Decidir: retirar la tabla (migración contract, con TDD) o hacer un dry-run y extender el plazo; y qué hacer con `SYN-PLFL5701` (entregado sin certificado).
3. **Release de `cf76ea8`** (#706, #707 y migr 0056), más #708 si se mergea. Hay que dispararlo y aprobar `production`. Por el patrón de los últimos releases, lo esperable es un abort de canary-verify y una promoción manual. Después: verificar count = 57 y las columnas `umbral_robo_*`.
4. **Gate del canary irrealizable**: `_CANARY_MIN_REQUESTS=30` contra 3-8 requests reales (`cloudbuild.production.yaml:645`). Opciones: bajar el umbral, condicionarlo al tráfico, generar tráfico sintético o desacoplar gke-deploy y smoke. Es un quality gate y el frente de Infra está congelado. Opcional: limpiar los 13 tags.
5. **Cierre de los Slots 1 y 3**: decidir si los viajes del 21-09 cuentan o si hace falta un viaje con un generador y un transportista que no opere el PO; en el Slot 1, además, un viaje sin Teltonika después del fix de Routes.
6. **Viaje real sin Teltonika** sobre los fixes: GPS (#696/#699/#701/#703), tracking (#697), cobertura ≥ 80 % con `movil_gps` y ETA real. Mejor después del deploy de #708.
7. **Apply del drift de Terraform**: import/apply del `iam_member` KMS (ya existe) y montaje de `CONTENT_SID_ACTIVACION_CONDUCTOR`, que destraba la activación por WhatsApp. Coordinarlo con el release (crea una revisión) y decidir cómo tratar `revision → null`, que reaparece con cada canary.
8. **ADR-077 estricta vs distancia híbrida** (#624/#676), sin decidir. #708 vuelve alcanzable el caso «reconstruida con cobertura < 80 %» (spec §3.4).
9. **Métricas de negocio OTel sin exportar**, lo que bloquea la «métrica data-quality» del Slot 1. Opciones: exporter de Cloud Monitoring en otel-bootstrap + `metricWriter` (IAM), o aceptar el log estructurado o una log-based metric y enmendar el criterio.
10. **Enmendar `frentes-vivos.md`**: excepciones sin registrar (#689, #690, #691, #700, #704 y #705-#707); avance sin marcar (T11-13 y los pasos 3-6 del Slot 3); el conteo «40» (hoy 52) y la redacción del criterio del Slot 2, que incluye migraciones históricas.
11. **Gestor documental (#692) sin uso en prod** (0 documentos), con el guard inerte porque `REQUIRE_DOCUMENT_TO_CLOSE_SINCE` no está fijada. Falta subir un PDF real y fijar la fecha de corte (PR de Terraform; el apply es del PO).
12. **Alcance del E2E del conductor**: no ejercita la activación, acepta «Sin dato» como certificado y no corre en PRs que solo tocan el API. Aceptarlo o autorizar ampliarlo (toca un quality gate).
13. **Slot 2**: permiso para retirar los jobs `is-demo` y `demo-seed-password` de `security.yml` (líneas 154-203, 212, 237 y 314).
14. **Slot 2**: decidir sobre `empresas.es_demo` (0 filas en true; dropearla es una migración destructiva), el campo público `demo_mode_activated`, el endpoint `/api/v1/demo/cache-warm` (sigue montado) y el job `demo-account-ttl-alert`.
15. **Slot 2**: el orden del retiro de `demo.boosterchile.com` en Terraform: `cert_domain`, DNS/host_rule, secretos `DEMO_*`, env/CORS y scheduler/alerta (incluye IAM/SA).
16. **Smokes humanos post-deploy** sin ejecutar: #695 (opt-in de huella), #690 (chat), #691 (zonas / activar empresa) y #705-#707 (trayectos; #706 y #707 después del release).
17. **Gitleaks semanal en rojo** desde 2026-05-04 (site key reCAPTCHA en `9b4a44c`). Pide permiso para allowlistear por valor exacto en `.gitleaks.toml` o por fingerprint (toca un gate de seguridad).
18. **Scorecard GPS de #704**: `cargarScorecardMedioPlazo` no tiene llamadores (solo la definición en `cargar-gps-scorecard.ts:108`). Definir cómo y cuándo se invoca.
19. **Runbook T2 «piso sembrado»**: `origin/chore/t2-piso-sembrado` (`eb1435f`) no tiene PR, usa la región `'13'` en vez de `'XIII'`, y hay un `.sql` local sin trackear con un hash real. Decidir entre versionar o descartar.
20. **Deudas del tracking de #689**: prioridad de Teltonika < 30 min, ETA móvil sin `coords.speed`, `teltonika_imei_espejo`, `GET /assignments/:id` solo con Teltonika, y el copy post-entrega. Priorizar o descartar después del fix de Routes.
21. **Selector de conductor**: filtra `c.status !== 'baja'`, valor que no existe en el enum `estado_conductor`, así que ese filtro no hace nada (`DriverAssignmentCard.tsx:79-81`). El backend no valida el estado al asignar; arreglarlo cambia el contrato (409/422).
22. **Contratos**: `/me/assignments` solo lista `asignado` y `recogido` (`me.ts:314`), no hay lote de driver-positions ni ventana post-entrega. Son cambios de contrato público.
23. **Ratificar los endpoints del conductor de #687** (`/resultado` y `/certificate/download`). #687 tiene 0 reviews y 0 comentarios, y #702 ya agregó `cobertura` a `/resultado`.
24. **Geocodificación del destino** al crear el viaje (columnas de lat/lng de destino, migración expand-only): aprobar o rechazar.
25. **`RESEND_API_KEY`**: el secreto no existe (404), así que el correo de activación no sale. Crear la cuenta y el secreto, o descartar el canal email.
26. **Safe-area de iOS en la PWA instalada** (#679/#680): no verificada en un iPhone (`.specs/fix-safe-area-ios-pwa/spec.md:40`).
27. **Ramas remotas**: hoy hay 88 heads (`git ls-remote --heads origin | wc -l`). Borrarlas es acción del PO; `feat/eco-routing-realtime-spec` se conserva.
28. **Login por RUT como generador sobre la cuenta real (vía B)**, sin decidir. Es DML en prod y lo ejecuta el PO. El dato viene del inventario y no se re-verificó.

## Deuda e infra congelada relevante

- **Deploy**: `gke-deploy` y `smoke-api-health` no corren desde 2026-08-04 porque el canary aborta siempre (pendiente 4).
- **Placeholders**: matching-engine, document-service y notification-service corren `gcr.io/cloudrun/placeholder` desde 2026-07-12.
- **Gateway GKE**: sigue en `33d179d`; hay 4 commits de shared-schemas posteriores sin evaluar.
- **Terraform drift**: en rojo desde 2026-08-16, con un binding KMS que solo falta en el state y la env de activación sin montar (pendiente 7).
- **Métricas OTel**: sin exporter; hay 0 métricas custom en Monitoring (pendiente 9).
- **Gitleaks semanal**: en rojo desde 2026-05-04 (pendiente 17).
- **E2E**: el filtro de paths de `e2e-pr.yml` deja fuera `apps/api/src/**` (pendiente 12).
- **Referencia de migración**: `adr-028-ext-movil-gps-propuesta.md:84-88` cita «forward 0051» para `bitacora_backfill_distancia`; la migración real es la 0053.
- **README desactualizado**: «FMS150» en la línea 24 (el equipo es FMC150, frentes-vivos.md:148); rango «(001..065)» en la línea 116 (hoy 001..080); las líneas 115 y 125 presentan los plugins superpowers/booster-skills (ADR-049/060), en tensión con ADR-078.
- **`docs/adr/`**: 81 archivos y 78 números distintos (001-080). Faltan 003 y 067, y 028, 034 y 035 están duplicados (`git ls-tree origin/main docs/adr/`).

## ADRs recientes (todos Vigentes; `git show origin/main:docs/adr/07{6..9}-*.md, 080-*.md`)

- **ADR-076** (2026-08-16): gobernanza para operador único, con estados de vigencia y protección de rama por checks.
- **ADR-077** (2026-08-17): nivel de certificación GLEC por fuente de posición (CAN vs GPS del vehículo vs GPS del móvil).
- **ADR-078** (2026-09-05): el repo deja de activar plugins y hooks de Claude Code; esa configuración es del operador.
- **ADR-079** (2026-09-09): modelo comercial v3, con comisión al generador por tipo de carga y tarifas y costos configurables desde admin.
- **ADR-080** (2026-09-09): flujo de dinero bajo mandato de cobro. La activación en prod está sujeta a las precondiciones de su §6.

## Snapshots archivados

- [`2026-09-22-snapshot-current-2026-07.md`](2026-09-22-snapshot-current-2026-07.md): el CURRENT del 2026-07-25 (sesiones de julio: telemetría en vivo, triage de 8 PRs, deploy de #624).
- [`2026-07-25-snapshot-sesiones-07-01-y-07-18.md`](2026-07-25-snapshot-sesiones-07-01-y-07-18.md): sesiones del 2026-07-01 y 07-18.
- [`2026-07-24-snapshot-current-2026-05-a-06.md`](2026-07-24-snapshot-current-2026-05-a-06.md): CURRENT de mayo a junio de 2026.
- El resto de los snapshots fechados está en `docs/handoff/YYYY-MM-DD-*.md`.
