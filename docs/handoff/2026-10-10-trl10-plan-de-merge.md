# Plan de merge del programa TRL 10 — 2026-10-10

Snapshot para el PO. Programa: [ADR-082](../adr/082-objetivo-trl10-supersede-precomercial.md), spec `.specs/trl10/spec.md`.

El estado es este: 39 PRs abiertos del programa (#742–#780), ninguno mergeado.

**Ensayado.** Los 39 se combinaron localmente sobre `main` (`0008fa6`) en el orden de este plan. El árbol resultante pasa typecheck, lint, tests con coverage 80, build, integración y `terraform validate`. Para llegar ahí hicieron falta correcciones que ningún PR muestra solo. El detalle está en [Ensayo del merge](#ensayo-del-merge).

**Estado de CI** al 2026-10-10, último commit de cada rama, según la API de Actions:
- **`ci.yml` en verde** en todos los PRs con base `main`: #742–#766, #768, #769, #775–#779.
- **Sin CI** en los PRs apilados (#767, #770–#774, #780), porque su base no es `main`. Su evidencia es local y está en cada PR. La CI corre cuando su padre se mergea y el PR queda apuntando a `main`.

Este documento fija:

- **en qué orden mergearlos** para minimizar conflictos;
- **qué acción del PO pide cada uno** después del merge (`terraform apply`, secreto, flag o verificación);
- **dónde van a chocar**.

El agente no mergea (CLAUDE.md, ADR-076): cuando un merge deja a otro PR en conflicto, el agente lo resuelve en la rama de ese PR si se le pide.

## Reglas que ordenan el plan

1. **Primero lo que destraba la CI.** Sin el espejo de Google (#776), cualquier PR puede caer por el rate limit de Docker Hub.
2. **Las cadenas apiladas se mergean en su orden.** Los PRs con base en otra rama no corren CI (los workflows solo disparan con base `main`). Mergeado el padre, GitHub reapunta el hijo a `main` y la CI corre ahí.
3. **Migraciones en orden numérico.** El migrator aplica por hash las pendientes aunque lleguen desordenadas (`apps/api/src/db/migrator.ts`, recuperación por hash). Igual se mantiene el orden para que el journal quede limpio:

   | Número final | Migración | PR |
   |---|---|---|
   | 0059 | `0059_modelo_comercial_v3` | #766 |
   | 0060 | `0060_suscripciones_uf` | #772 |
   | 0061 | `0061_mandato_cobro` | #780 |
   | 0062 | eco-routing, hoy `0059_sugerencias_ruta` | #761 (con #762) |
   | 0063 | retiro de demo, hoy `0059_retiro_superficie_demo` | #748 |

   Las dos últimas **se renumeran al momento de su merge**, no antes: cambia el `idx`, el `tag` y el nombre del archivo y del `down`, sin tocar el SQL. Renumerar antes no evita el conflicto textual de `_journal.json`, porque cada PR agrega su entrada en el mismo lugar.
4. **Las migraciones contract van solas y al final.** #748 borra `cuentas_demo` y `empresas.es_demo`. Exige un release previo con #745 desplegado, la verificación del PO y la lista de ADR-076 §3.
5. **Ningún merge enciende nada.** Todo lo nuevo de producto va detrás de un flag con default `false`. Encenderlo es otra decisión del PO, después del apply.

## Orden propuesto

### Oleada 0 — destrabar CI y fijar el programa

| # | PR | Criterio | Después del merge |
|---|---|---|---|
| 1 | #776 `fix(ci)`: imágenes de Docker Hub desde el espejo de Google | CI | — |
| 2 | #742 `docs(adr)`: TRL 10 con definición verificable (ADR-082, spec) | programa | — |
| 3 | #743 `fix(ci)`: gitleaks semanal y drift de Terraform | T10-06, T10-07 | Observar tres corridas programadas en verde |

### Oleada 1 — sin superficie de producto (docs, tests, observabilidad)

Son independientes entre sí; el orden dentro de la oleada no importa.

| PR | Criterio | Después del merge |
|---|---|---|
| #777 medición del p95 de CI | T10-14 | Cumplido con la medición del PR |
| #779 herramientas de load test | T10-19 | Corrida real en el entorno no-prod (OQ-1) |
| #757 runbooks: on-call, post-mortem, GLEC y mandato | T10-18 | Revisar la ventana de respuesta real |
| #758 preparación del drill de DR | T10-20 | Ejecutar el drill y registrar RTO y RPO |
| #750 retiro de los stubs carta-porte y document-indexer | T10-09 | — |
| #751 sin `any` ni `as unknown as` en producción | T10-12 | — |
| #753 coverage 80 en las cuatro métricas | T10-08 | Toca `ci.yml`, un quality gate: requiere tu visto explícito |
| #754 métricas de negocio a Cloud Monitoring | T10-15 | Verificar los descriptores `custom.` |
| #755 errores de backend a Error Reporting | T10-16 | `terraform apply` (`error-reporting.tf`) |
| #756 SLOs con burn-rate | T10-17 | `terraform apply` (`slo.tf`) |
| #747 métrica data-quality de la huella | T10-01 | `terraform apply` (`monitoring.tf`) |
| #749 combustible por CAN al cierre | T10-05 | Un viaje real con CAN para el primer certificado primario |
| #768 borradores legales v3 | T10-28 | Revisión del abogado (`lawyer_review`) |
| #769 RFP de pentest y GLEC, kit cliente 1 | T10-26, T10-27, T10-30 | Enviar las RFP |

#752 (T10-13) salió de esta oleada: va al final de la oleada 2 (ver [Ensayo del merge](#ensayo-del-merge)).

### Oleada 2 — producto detrás de flags y servicios

Dentro de cada cadena, el orden es estricto (`→`).

| Cadena / PR | Criterio | Después del merge |
|---|---|---|
| #744 → #774 E2E del conductor y luego los flujos críticos con axe | T10-02, T10-10, T10-11 | Revisión manual WCAG (`docs/audits/wcag-2026-10-09.md`) |
| #746 activación por correo | T10-04 | `terraform apply` (`email.tf`) y cargar el secreto `resend-api-key` |
| #745 retiro de la superficie demo (fase expand) | T10-03 | Toca `security.yml`, un quality gate: tu visto; `terraform apply` (varios `.tf`); desplegar; verificar que `demo.boosterchile.com` no resuelve |
| #766 → #767 → #770 → #771 → #772 → #773 modelo comercial v3 | ADR-079, T10-29 | `terraform apply` (`valor-uf.tf`); `PRICING_V3_ACTIVATED` cuando decidas |
| #780 mandato de cobro (sobre #772) | T10-25 | `terraform apply` (`mandato-cobro.tf`); el flag solo con las 6 precondiciones de `.specs/mandato-de-cobro/activacion.md` |
| #759 → #761 → #762 eco-routing (renumerar a 0062 en #761) | T10-23 | `terraform apply` (`eco-routing.tf`); flag de eco-routing; un viaje real con sugerencia |
| #775 observatorio Coquimbo en BigQuery | T10-24 | `terraform apply` (`observatorio.tf`); contraparte municipal |
| #778 wake-word con Picovoice | T10-22 | Secreto `picovoice-access-key`, modelos, `terraform apply` y flag; prueba en un dispositivo |
| #760 staging gemelo y ADR-083 | T10-21, OQ-1 | **Toca `iam.tf`** y agrega workflows de staging: revisión explícita del PO; `terraform apply` |
| #763, #764, #765 extracción de document, notification y matching (después de #760) | T10-21 | **#765 declara IAM nuevo** (`roles/run.invoker` del SA del api sobre matching-engine, en `matching-engine.tf`): requiere tu visto explícito. Después, `terraform apply` de cada servicio; modo sombra; rollback drill |
| #752 tablas sin `empresa_id` documentadas (movido desde la oleada 1) | T10-13 | Al actualizarlo con `main`, documentar las 4 tablas nuevas sin tenant (ver [Ensayo](#ensayo-del-merge)) |

### Oleada 3 — contract

| PR | Criterio | Condición |
|---|---|---|
| #748 retiro de `es_demo` y `cuentas_demo` (renumerar a 0063) | T10-03 | #745 desplegado y estable; consultas de diagnóstico del encabezado de la migración en 0; lista de ADR-076 §3 con corrida en seco. Al actualizarlo con `main` hay que hacer tres cosas: sacar los filtros `isDemo` que traen #772 y #775, borrar la fila `cuentasDemo` de `docs/rls-exemptions.md` y renumerar (ver [Ensayo](#ensayo-del-merge)) |

## Dónde van a chocar

Medido en el ensayo: con squash merge en el orden de este plan, 16 de los 39 PRs entran en conflicto con lo ya mergeado.

| Archivo | Choca al mergear | Resolución |
|---|---|---|
| `apps/api/src/routes/admin-jobs.ts` y su test | #772, #780, #761, #775, #763 | Endpoints, opciones y mocks nuevos en el mismo lugar: se conservan todos. Además se descarta el import de `runDemoTtlAlerter` que traen #772 y #780 (#745 lo borra) |
| `apps/api/src/server.ts` | #770, #761, #775, #763, #765 | Imports y wiring contiguos: todos, con los imports en orden alfabético |
| `apps/api/src/config.ts` | #772, #761, #778, #765 | Claves nuevas contiguas. Se descarta el bloque `DEMO_MODE_ACTIVATED` del contexto. Al borrarlo no hay que llevarse el `/**` del comentario siguiente: el typecheck lo detectó en el ensayo |
| `infrastructure/compute.tf`, `variables.tf` | #772, #780, #761, #778, #760, #764, #765 | Secretos, env y variables contiguos: todos. Se descartan `DEMO_MODE_ACTIVATED` y `demo_mode_activated` (los retira #745) |
| `cloudbuild.production.yaml` | #764, #765 | Pasos build/push/deploy e `images` de los tres servicios. Además el comentario del timeout dice "7 imágenes" en cada PR: con los tres son **9** |
| `docs/runbooks/README.md` | #760, #763, #765 | Filas nuevas: todas. Cada PR de T10-21 marca al servicio del otro como SKELETON; quedan las filas actualizadas de cada uno |
| `apps/api/drizzle/meta/_journal.json` | #761, #748 | Renumeración a 0062 y 0063 (ver regla 3). #772 y #780 entran limpios por estar apilados |
| `apps/api/src/db/schema.ts` | #748 | Se conservan las columnas de ADR-079 y se borra `isDemo` |
| Tests con bloques agregados al final | #754 (`otel-bootstrap/index.test.ts`, con #753), #749 (`calcular-metricas-viaje.test.ts`, con #747) | Ambos `describe` |
| `apps/web/src/routes/platform-admin.tsx`, `conductor.tsx` | #775, #778 | Unión de rutas e imports |
| `apps/api/package.json`, `e2e-pr.yml`, `document-service/package.json`, `shared-schemas/src/index.ts` | #774, #763, #765 | Scripts, dependencias y exports: todos |
| `pnpm-lock.yaml` | #763 | Se regenera con `pnpm install`; `--frozen-lockfile` pasa después |

Los hijos apilados (#767, #770–#773, #780, #774, #761–#762, #748) chocan además con la versión squasheada de su padre. Se resuelven actualizando la rama con `main` después del merge del padre. El conflicto se limita al delta propio del hijo.

## Ensayo del merge

**Método.** Rama local `ensayo/trl10-merge`, no publicada. Sobre `main` (`0008fa6`) se aplicaron los 39 PRs con `git merge --squash` en el orden de arriba; los hijos apilados entraron como delta sobre su padre. Hubo 58 resoluciones de conflicto, registradas por archivo.

**Verificación del árbol combinado** (2026-10-10):

| Check | Resultado |
|---|---|
| `pnpm install --frozen-lockfile` | OK, después de regenerar el lock |
| `pnpm typecheck` | 31/31 tareas |
| `pnpm lint` (Biome + `lint:rls`) | 0 errores. Biome deja 16 warnings, los mismos que `main` |
| `pnpm test:coverage` | 29/29 tareas, 6 060 tests. api: 90,2 / 83,6 / 92,4 / 90,2; web: 88,7 / 82,1 / 87,7 / 88,9 (umbral 80 de #753) |
| `pnpm build` | 9/9 tareas |
| Integración api contra Postgres 16 | 34/38 archivos verdes, con las 64 migraciones aplicadas (0000–0063). Los 4 restantes levantan Redis con testcontainers y el entorno del ensayo no tiene Docker (`Could not find a working container runtime strategy`); en CI sí corren |
| `terraform fmt -check` y `validate` | OK |
| Grep de T10-03 | 0 archivos |

**Correcciones que ningún PR muestra solo.** Sin ellas el árbol combinado falla.

1. **T10-03 contra #772 y #775.**
   - El problema: `cobrar-suscripciones-uf.ts` (#772) filtra `eq(empresas.isDemo, false)` y `observatorio/viajes-entregados.ts` (#775) filtra `eq(generador.isDemo, false)`. Con #748 la columna desaparece y el typecheck falla.
   - El filtro sirve hasta que #748 se aplique, así que se saca en #748 al actualizarlo con `main`. Los fixtures `demo` de `suscripciones-uf.integration.test.ts` y `observatorio-viajes.integration.test.ts` pasan a `isTestUser`, que es el filtro que queda. Después, `biome format`.
2. **T10-13 contra las tablas nuevas.** El `lint:rls` de #752 exige documentar en `docs/rls-exemptions.md` cada tabla sin `empresa_id`.
   - Faltan cuatro tablas: `sugerenciasRuta` (#761), `configuracionComercial` (#766), `valoresUf` (#772) y `eventosPagoViaje` (#780). Las cuatro van en la sección "protegidas en cada query": sus queries ya filtran o llevan `rls-allowlist`.
   - Por eso #752 pasa al final de la oleada 2: actualizarlo una sola vez con las cuatro filas es más simple que tocar cuatro PRs.
   - #748 borra la fila `cuentasDemo` del doc. Ya la sacó de `TENANT_FREE_TABLES` (`a002e9b`).
3. **Renumeración.**
   - #761: `0059_sugerencias_ruta` pasa a `0062` (idx 62, `when` 1780876800026), con el `.sql`, el `.down.sql` y los comentarios.
   - #748: pasa a `0063` (idx 63, `when` 1780876800027), con el `.sql`, el `.down.sql`, los mensajes de `RAISE EXCEPTION`, el `describe` del test de integración y la línea de `.specs/retiro-superficie-demo-t10-03/spec.md`.
4. **Ramas anteriores a #745.** #772, #780, #761 y #778 traen en el contexto del conflicto piezas demo que #745 retira. Al resolver se descartan siempre:
   - el import de `runDemoTtlAlerter`;
   - `DEMO_MODE_ACTIVATED`;
   - `demo_mode_activated`.

**Correcciones ya subidas a las ramas** (2026-10-10):

- **#748** (`a002e9b`). Su propio test de integración contenía el literal `es_demo`, así que el grep de T10-03 daba 1 en la cabeza del PR. Ahora compara las columnas de `empresas` en la base con las del schema Drizzle. Verificado con una mutación: sin el `DROP COLUMN`, el test falla con `+ "es_demo"`.
- **#761/#762, #763 y #764.**
  - El problema: agregaban recursos nuevos en `scheduling.tf` y `messaging.tf`. Esos archivos declaran service accounts e IAM, así que están protegidos por CLAUDE.md, y los PRs no lo declaraban.
  - Los recursos pasaron a `eco-routing.tf`, `document-service.tf` y `notification-service.tf`. Son los mismos recursos, aún no aplicados, y no hay IAM nuevo.
  - Con eso, #761 y #763 ya no chocan en `scheduling.tf`.

**Archivos protegidos que siguen en los PRs** (requieren tu visto explícito):

- #753 `ci.yml`;
- #745 `security.yml`, más los `.tf` demo con su binding IAM, que autorizaste el 2026-10-07;
- #760 `iam.tf`;
- #765 `matching-engine.tf`, con un `google_cloud_run_v2_service_iam_member` nuevo.

## Lo que no se resuelve con merges (a cargo del PO o de terceros)

- **Entorno no-prod** (OQ-1, #760): habilita T10-19 y la corrida en seco de las activaciones.
- **Legal** (T10-28 y precondiciones 1, 4 y 6 de ADR-080): revisión del abogado.
- **Externos**: pentest (T10-26), certificación GLEC (T10-27) y cliente con contrato (T10-30).
- **Mandato de cobro**: cuenta de fondos de terceros, y línea de confirming o tope de caja propia, antes del gate del 2026-11-30.
- **Credenciales**: Picovoice (T10-22) y Resend (T10-04). La clave CMF es opcional: el valor UF sale del SII.
