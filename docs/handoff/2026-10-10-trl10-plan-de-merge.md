# Plan de merge del programa TRL 10 — 2026-10-10

Snapshot para el PO. Programa: [ADR-082](../adr/082-objetivo-trl10-supersede-precomercial.md), spec `.specs/trl10/spec.md`.

El estado es este: 39 PRs abiertos del programa (#742–#780), ninguno mergeado.

**Estado de CI.**
- **Verde verificada** en el último commit de #775, #776, #777, #778 y #779.
- **Sin CI** en los PRs apilados (#767, #770–#774, #780), porque su base no es `main`. Su evidencia es local y está en cada PR.
- **Sin verificar** en esta sesión para los demás con base `main`. Corrieron antes del espejo de Google y pueden estar rojos por el rate limit de Docker Hub. Mergeado #776, el agente trae `main` a cada rama y la CI vuelve a correr.

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
| #752 tablas sin `empresa_id` documentadas | T10-13 | — |
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

### Oleada 2 — producto detrás de flags y servicios

Dentro de cada cadena, el orden es estricto (`→`).

| Cadena / PR | Criterio | Después del merge |
|---|---|---|
| #744 → #774 E2E del conductor y luego los flujos críticos con axe | T10-02, T10-10, T10-11 | Revisión manual WCAG (`docs/audits/wcag-2026-10-09.md`) |
| #746 activación por correo | T10-04 | `terraform apply` (`email.tf`) y cargar el secreto `resend-api-key` |
| #745 retiro de la superficie demo (fase expand) | T10-03 | Toca `security.yml`, un quality gate: tu visto; `terraform apply` (varios `.tf`); desplegar; verificar que `demo.boosterchile.com` no resuelve |
| #766 → #767 → #770 → #771 → #772 → #773 modelo comercial v3 | ADR-079, T10-29 | `terraform apply` (`valor-uf.tf`); `PRICING_V3_ACTIVATED` cuando decidas |
| #780 mandato de cobro (sobre #772) | T10-25 | `terraform apply` (`mandato-cobro.tf`); el flag solo con las 6 precondiciones de `.specs/mandato-de-cobro/activacion.md` |
| #759 → #761 → #762 eco-routing (renumerar a 0062 en #761) | T10-23 | `terraform apply` (`scheduling.tf`); flag de eco-routing; un viaje real con sugerencia |
| #775 observatorio Coquimbo en BigQuery | T10-24 | `terraform apply` (`observatorio.tf`); contraparte municipal |
| #778 wake-word con Picovoice | T10-22 | Secreto `picovoice-access-key`, modelos, `terraform apply` y flag; prueba en un dispositivo |
| #760 staging gemelo y ADR-083 | T10-21, OQ-1 | **Toca `iam.tf`** y agrega workflows de staging: revisión explícita del PO; `terraform apply` |
| #763, #764, #765 extracción de document, notification y matching (después de #760) | T10-21 | `terraform apply` de cada servicio; modo sombra; rollback drill |

### Oleada 3 — contract

| PR | Criterio | Condición |
|---|---|---|
| #748 retiro de `es_demo` y `cuentas_demo` (renumerar a 0063) | T10-03 | #745 desplegado y estable; consultas de diagnóstico del encabezado de la migración en 0; lista de ADR-076 §3 con corrida en seco |

## Dónde van a chocar

| Archivo | PRs que lo tocan | Tipo de conflicto |
|---|---|---|
| `apps/api/drizzle/meta/_journal.json` | #766, #772, #780, #761/#762, #748 | Cada uno agrega su entrada al final; se resuelve conservando ambas en orden numérico |
| `infrastructure/compute.tf` | #745, #746, #761/#762, #763, #764, #765, #772, #775, #778, #780 | Líneas nuevas contiguas en `env_vars` y `secrets` del api; se conservan todas |
| `infrastructure/variables.tf` | #745, #746, #760, #761/#762, #764, #765, #778, #780 | Variables nuevas contiguas |
| `apps/api/src/config.ts`, `server.ts` | #744, #745, #761/#762, #763, #764, #765, #770, #772, #775, #778, #780 | Claves de config y montajes de rutas contiguos |
| `apps/api/src/db/schema.ts` | #766, #772, #780, #761/#762, #748 | Enums y tablas nuevas; #748 borra `es_demo` |
| `scripts/check-route-default-deny.ts` | los que montan rutas nuevas | Una línea por factory |
| `pnpm-lock.yaml` | casi todos | La mayoría trae el mismo cambio de sharp (1e7db57): no choca. #778 agrega Picovoice: se regenera con `pnpm install` |

Todos son conflictos aditivos: no hay dos PRs que cambien la misma lógica. Si alguno deja de serlo, el agente pregunta antes de resolver.

## Lo que no se resuelve con merges (a cargo del PO o de terceros)

- **Entorno no-prod** (OQ-1, #760): habilita T10-19 y la corrida en seco de las activaciones.
- **Legal** (T10-28 y precondiciones 1, 4 y 6 de ADR-080): revisión del abogado.
- **Externos**: pentest (T10-26), certificación GLEC (T10-27) y cliente con contrato (T10-30).
- **Mandato de cobro**: cuenta de fondos de terceros, y línea de confirming o tope de caja propia, antes del gate del 2026-11-30.
- **Credenciales**: Picovoice (T10-22) y Resend (T10-04). La clave CMF es opcional: el valor UF sale del SII.
