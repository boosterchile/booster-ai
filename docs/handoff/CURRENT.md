# Estado actual del proyecto — Booster AI

**Última actualización**: 2026-10-29 · `main` = `1b10cfa3` (#835) · prod = imagen `18ce8e22` en los 8 servicios de Cloud Run y en el gateway GKE (release `39875352139`, success, 2026-10-22T23:59Z → 10-23T00:38Z). Entre `18ce8e22` y `main` hay 8 commits y ninguno toca `apps/` ni `packages/`: solo `infrastructure/`, `terraform-drift.yml`, `docs/` y `.specs/` (`git diff --stat 18ce8e22 origin/main`). Horas en UTC; Santiago = UTC−3.
**Anterior**: el CURRENT del 2026-09-22 (con agregados del 09-27 y del 10-10), archivado en [`2026-10-29-snapshot-current-2026-09.md`](2026-10-29-snapshot-current-2026-09.md). Sus tablas de prod, CI y pendientes ya no valen.
**Método**: solo lectura. GCP por REST con token ADC y `X-Goog-User-Project: booster-ai-494222`; BD con `scripts/db/agent-query.sh` (solo SELECT, sin `-y`, sin PII); GitHub con `gh`. Lo que no se re-verificó se dice explícitamente.
**Documento vivo**: el detalle histórico está en los snapshots fechados. Contrato: `CLAUDE.md`. Frentes: `docs/frentes-vivos.md`. Término: `.specs/trl10/spec.md`. **Aquí no se declara cerrado ningún slot: eso lo hace el PO.**

## Estado de prod (verificado 2026-10-29)

| Componente | Estado | Fuente |
|---|---|---|
| `booster-ai-api` | 100 % en `booster-ai-api-00458-fjw` (`LATEST`), imagen `api:18ce8e22…`, updateTime 2026-10-23T03:53Z | Cloud Run v2 REST |
| web · whatsapp-bot · telemetry-processor · sms-fallback-gateway | 100 % en `LATEST` (`00407-kdw`, `00452-knd`, `00407-bvv`, `00390-x9j`), imagen `18ce8e22…`, updateTime 2026-10-23T00:06Z | idem |
| matching-engine · notification-service · document-service | Ya no son placeholder: imagen propia `18ce8e22…` (`00020-x6f`, `00022-8rb`, `00023-hz8`). El api no les deriva tráfico: `MATCHING_VIA_MICROSERVICE=false`, `NOTIFICATIONS_VIA_MICROSERVICE=false` y los dos `*_SHADOW=false`. Desde el 10-23: 0 requests HTTP a matching y a notification; 2 `POST /pubsub/document-uploaded` (204) a document-service, el 10-23 a las 01:04Z (`DOCUMENT_CONSUMER_MODE=push`, #829) | Cloud Run REST; Cloud Logging `httpRequest` |
| telemetry-tcp-gateway (GKE) | Imagen `18ce8e22…`, último pull 2026-10-27T05:03Z | Cloud Logging `k8s_pod` |
| Migraciones | **65** en prod (max id 117) = **65** en el journal (última `0064_viajes_destination_latlng`). El api corre con `STRICT_MIGRATION_ORDERING=false` | `drizzle.__drizzle_migrations`; `_journal.json`; env del api |
| Flags del api | Encendidos: `AUTH_UNIVERSAL_V1`, `IMPERSONATION_V1`, `MATCHING_ALGORITHM_V2`, `OBSERVABILITY_DASHBOARD`, `SIGNUP_REQUEST_FLOW`, `ADMIN_PROVISIONED_ONBOARDING`. Apagados: `ECO_ROUTING_REALTIME`, `MANDATO_COBRO`, `WAKE_WORD_VOICE` y los cuatro de microservicios | env del api (Cloud Run REST) |
| Secretos montados | `CONTENT_SID_ACTIVACION_CONDUCTOR`, `RESEND_API_KEY`, `PICOVOICE_ACCESS_KEY` y `CMF_API_KEY`, entre otros. No hay `REQUIRE_DOCUMENT_TO_CLOSE_SINCE`, `DEMO_*` ni `OTEL_*` | idem (solo nombres) |
| Métricas de negocio | 14 descriptores `workload.googleapis.com`, entre ellos `viajes_entregados_total`, `certificados_emitidos_total` y `huella_cobertura_degradada_total`. 0 `custom.` | Monitoring REST `metricDescriptors` |
| Staging | `booster-ai-stg-494222` no se pudo verificar: la cuenta ADC recibe `PERMISSION_DENIED` | Resource Manager v3 REST |

### Datos de prod (agent-query.sh, 2026-10-29)

- **Prod sin actividad desde el 10-20.** El último viaje se creó el 2026-10-20 13:13Z. Desde el 10-21 hay 0 viajes creados y 0 entregas.
- **Viajes entregados: 8.** 7 son de un generador de prueba (`es_usuario_prueba=t`): `SYN-PLFL5701` (sintético), los 4 del 09-21 y los 2 del 10-20. El otro es `BOO-BKAXIK` (09-14), el único de un generador que no es de prueba.
- **Certificados: 7, todos `secundario_modeled`; 0 primarios.** El primero es del 2026-09-14 21:40Z y el último del 2026-10-20 23:19Z.

| Viaje | Entrega | Vehículo | Teltonika | Fuente de ruta | Cobertura | kgCO2e reales |
|---|---|---|---|---|---|---|
| BOO-KY7G69 | 10-20 | KZBB26 | sí | `teltonika_gps` | 100,00 | 224,092 |
| BOO-HC7DJX | 10-20 | KZXB64 | sí | `maps_directions` | 0,00 | null |
| BOO-83ND2C, PMGQWN, LCTSE5, KJHITL | 09-21 | KXSV65 | no | `maps_directions` | 0,00 | null |
| BOO-BKAXIK | 09-14 | JLKT54 | sí | `teltonika_gps` | 100,00 | 2,691 |

- **Por qué HC7DJX cayó a `maps_directions`**: `esHuecoDetenido` exige coordenadas idénticas (`calcular-distancia-real.ts:167-169`; es la regla que el PO fijó para #708 en `.specs/distancia-real-hibrida/spec.md`). Según la auditoría del 2026-10-29, un hueco con el camión detenido y deriva de GPS fue a Routes, que respondió sin distancia, y la reconstrucción abortó con `routes_error`. La auditoría también reporta que KY7G69 midió un tramo ajeno a la carga. Ninguno de esos dos diagnósticos se re-verificó aquí.
- **CAN**: hay 10 vehículos con Teltonika. Ninguno tiene `fuente_combustible_can='83'`: KZXB64 tiene `89`, LFGR63 `84` y los otros 8 `sin_sensor`. La huella solo lee el CAN con `'83'` (`calcular-metricas-viaje.ts:72-75`).
- **Conductores: 8** no eliminados. **2 activados**, los dos dados de alta antes de octubre (último login 2026-10-24 00:55Z). **6 pendientes** (`pending-rut:*`). En octubre hubo 1 alta, que sigue pendiente.
- **Activación por canal** (Cloud Logging del api):
  - WhatsApp: 4 envíos, el 10-19 a las 23:10 y 23:11Z y el 10-20 a las 02:17 y 03:05Z.
  - Correo: los 2 intentos del 10-19 no salieron («correo NO enviado: falta RESEND_API_KEY»). El 10-20 salieron 2, a las 02:17 y 03:05Z. Desde el 10-20 no aparece el aviso de clave ausente.
  - Ningún conductor nuevo se activó.
- **Otros**:
  - `documentos_transporte` tiene 0 filas.
  - Alta desde el panel admin: 1 empresa, y 0 cumplen el criterio (dueño activo, con clave y con login).
  - En prod siguen la tabla `cuentas_demo` y la columna `empresas.es_demo`.

## CI y deploy

- **Release** (manual, `gh workflow run release.yml --ref main`, gate `production`): el último en verde es `39875352139` (`18ce8e22`, 10-22). Desde el 10-10 hubo 17 corridas: 7 success, 7 failure y 3 cancelled (`gh run list --workflow release.yml --created ">=2026-10-10"`).
- **CI en `main`** (`1b10cfa3`): `39960592622` success; Security por push `39960591916` success.
- **Security semanal** (cron de los lunes):

  | Fecha | Run | Resultado |
  |---|---|---|
  | 10-05 | `37293367416` | failure |
  | 10-12 | `38234472480` | success |
  | 10-19 | `39222672174` | success |
  | 10-26 | `40292341404` | failure en `npm audit (HIGH+)` y en Trivy |

  El rojo del 10-26 lo causa una advisory HIGH de `zod` (GHSA-mrhx-c7xc-m3w5, ruta `apps__api>zod`; `gh run view --log-failed`). Gitleaks ya no está en rojo.
- **Terraform Drift Check**: 7 corridas programadas seguidas en verde, del 10-23 al 10-29: `39980855802`, `40102974166`, `40204581020`, `40368063242`, `40542865629`, `40732980967` y `40921170472`. Las del 10-20, 10-21 y 10-22 fallaron.
- **E2E nocturno** (`e2e-staging.yml`, contra prod): verde del 10-26 al 10-29 (último `40858348835`).
- **E2E por PR** (`e2e-pr.yml`): el filtro `conductor` ya incluye `apps/api/src/**` (líneas 49-53).
  - La última corrida en que Playwright sí corrió y pasó es `39449311411` (10-20).
  - En #826 falla «E2E conductor Playwright» (`39683047395`, 10-21).

## Fase A del programa TRL 10 (`.specs/trl10/spec.md`)

| Criterio | ¿Se cumple? | Qué falta (detalle en las líneas «Hoy» de la spec) |
|---|---|---|
| T10-01 Huella medida | No | Viaje con FMC150: BKAXIK y KY7G69. Sin FMC150: solo los 4 del 09-21, anteriores a la métrica data-quality (#747) y de un generador de prueba |
| T10-02 Conductor operativo | No | Los 7 viajes entregados desde el 09-21 son de un generador de prueba; 0 conductores activados en octubre |
| T10-03 Superficie demo | No | Quedan 8 archivos (11 con migraciones), `demo.boosterchile.com` responde 200, y #748 está en draft y en conflicto |
| T10-04 Activación por canal | No | Los canales están montados y enviaron, pero ningún conductor nuevo se activó |
| T10-05 Certificado primario | No | 0 primarios; 0 vehículos en `fuente_combustible_can='83'` |
| T10-06 Infra sin drift | **Sí** | Se marca `[x]` en este PR, con las 7 corridas como evidencia |
| T10-07 Security programado | A decidir | Hubo dos verdes seguidas (10-12 y 10-19) y después un rojo (10-26). La decisión va en el pendiente 4 |

## Trabajo sin registro en `frentes-vivos.md`

Desde el 2026-10-07 se mergearon 77 PRs (`gh pr list --state merged --search "merged:>=2026-10-07"`).

- 38 son del merge TRL 10 del 10-10 (#742–#780, menos #748). De ellos, 6 son de la fase A (#743, #744, #745, #746, #747 y #749), 1 es el ADR (#742) y 1 es CI (#776). **Los otros 30 adelantan criterios de las fases B–E**, y `frentes-vivos.md` no los declara como adelantos, como exige su regla.
- 39 entraron después o por fuera del merge del 10-10. Entre ellos:
  - inicio del transportista (#792);
  - conductores (#793, #806–#808 y #810), cargas (#794) y asignaciones (#811);
  - deploy y canary (#785, #786, #789, #798, #805, #809 y #815);
  - infra y costos (#790, #791, #797, #821, #822, #830 y #833);
  - document-service push (#823 y #829).

  `frentes-vivos.md` no cambia desde el 10-10.

## PRs abiertos y WIP

- **De `boosterchile` hay 6, y el tope es 3**:
  - #836: el hueco detenido tolera 25 m de deriva del GPS, con enmienda a `.specs/distancia-real-hibrida/spec.md` (abierto el 10-29 a las 18:25Z).
  - #828: contrato `CLAUDE.md`.
  - #826: teléfono del conductor; Playwright en rojo.
  - #820: sonda de Routes; draft.
  - #748: retiro de `es_demo`; draft y en conflicto (`CONFLICTING`/`DIRTY`, última actualización 10-12).
  - #726: entorno de Cloud Agent; draft desde el 09-27.

  Este PR es el séptimo; el PO autorizó abrirlo por encima del tope.
- **De `fueradelabox` hay 13**: 11 ramas `cursor/*` (inicio por rol #800–#804, capacidades #817–#819, conductor asignado #816, rol generador #795 y ubicación #799), #825 (docs) y #837 (migración a zod 4 para que la semanal de Security vuelva a verde, abierto el 10-29 a las 18:26Z).

## Pendientes del PO

1. **WIP.** Decidir cuáles de #836, #828, #826, #820, #748 y #726 se cierran o esperan, y si los 13 de `fueradelabox` cuentan contra el tope.
2. **Registro en `frentes-vivos.md`.** Decidir si los 30 adelantos de las fases B–E y los 39 PRs posteriores se declaran como excepciones o adelantos (regla de la fase activa).
3. **T10-09 y T10-10.** La evidencia ya está en `main`: los dos packages se eliminaron en #750, y los 7 flujos tienen spec Playwright por PR desde #774. Son criterios de la fase B adelantados y sin declarar, así que marcarlos lo decide el PO.
4. **T10-07.** El criterio pide dos semanas seguidas en verde y eso ocurrió el 10-12 y el 10-19. Decidir si eso lo cumple o si las corridas tienen que seguir en verde. En cualquier caso hay que resolver lo de `zod`; #837 propone migrar a zod 4. Sin ese merge, lo esperable es que la semanal del 2026-11-02 también falle (inferido, no verificado).
5. **T10-01 y T10-02.** Decidir si cuentan los viajes de un generador de prueba. Falta un viaje sin FMC150 después de #747, y un viaje creado, aceptado y asignado por cuentas que no opere el PO.
6. **Regla del hueco detenido** (T10-01 y T10-05): en `main` exige igualdad exacta. #836 propone tolerar 25 m de deriva y trae la enmienda de `.specs/distancia-real-hibrida/spec.md`; el visto es del PO.
7. **T10-05.** Provisionar `fuente_combustible_can='83'` en los camiones que emiten el IO 83. Según la auditoría del 10-29 son cinco, y lo puede hacer el dueño desde la UI (no re-verificado aquí).
8. **T10-04.** Que un conductor nuevo se active por WhatsApp o correo sin que el PO le entregue el código.
9. **#748 (T10-03).** Faltan sus precondiciones, la lista de ADR-076 §3 y el visto del PO. Además, renumerarla a 0065 (el journal termina en 0064). La auditoría advierte que con `STRICT_MIGRATION_ORDERING=false` su guarda puede revertir en silencio y dejar el release en verde (no re-verificado). Retirar el dominio `demo.boosterchile.com` también queda pendiente.
10. **Alta desde el panel admin.** La condición 1 sigue sin cumplirse: la única empresa creada por el admin tiene el dueño sin activar.
11. **Staging (OQ-1).** Su existencia no se pudo verificar con la cuenta ADC.

## ADRs nuevos desde el CURRENT anterior (`ls docs/adr/08*`)

- **ADR-081** (Vigente): retiro del clúster de DR frío.
- **ADR-082** (Vigente): TRL 10 como objetivo, con definición verificable.
- **ADR-083** (Vigente): staging gemelo y extracción con shadow.
- **ADR-085**: document-service consume por push. Su encabezado dice «Aceptado (2026-10-22)», que no es una etiqueta de ADR-076.
- **ADR-086** (Vigente): llave de SA de solo lectura para sesiones en la nube.
- No existe ningún archivo ADR-084.

## Snapshots archivados

- [`2026-10-29-snapshot-current-2026-09.md`](2026-10-29-snapshot-current-2026-09.md): el CURRENT del 2026-09-22, con los agregados del 09-27 y del 10-10.
- [`2026-10-10-trl10-plan-de-merge.md`](2026-10-10-trl10-plan-de-merge.md): plan y resultado del merge TRL 10 (38 de 39).
- [`2026-09-22-snapshot-current-2026-07.md`](2026-09-22-snapshot-current-2026-07.md): el CURRENT del 2026-07-25.
- El resto de los snapshots está en `docs/handoff/YYYY-MM-DD-*.md`.
