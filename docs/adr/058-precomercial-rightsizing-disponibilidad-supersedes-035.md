# ADR 058 — Reclasificación a pre-comercial: habilitar right-sizing de disponibilidad (supersedes ADR-035 TRL 10)

**Estado**: Aceptado
**Fecha**: 2026-06-05
**Autor**: Felipe Vicencio (PO) + Claude
**Supersedes**: ADR-035 (`035-trl10-mantener-ha-recortar-ruido.md`)
**Relacionado**: ADR-034 (right-sizing, sigue vigente)

---

## Contexto

ADR-035 (Aceptado, 2026-05-13) fijó el objetivo del producto como **TRL 10**:
sistema certificado, listo para despliegue comercial, con clientes B2B grandes
y contratos firmados que exigen 99.9% uptime. Bajo esa premisa rechazó tres
palancas de ahorro por incompatibles con el SLA:

1. Eliminar/reducir el DR cluster (`booster-ai-telemetry-dr`)
2. Cloud SQL `REGIONAL` → `ZONAL`
3. Memorystore Redis `STANDARD_HA` → `BASIC`

Solo aceptó la log exclusion del ruido de control plane GKE (ortogonal a HA).

**Lo que cambió (aclaración del PO, 2026-06-05):** el objetivo real a la fecha
NO es TRL 10. El lanzamiento es **pre-comercial**: a pocas semanas de operar, con
un **máximo de 10 camiones** (parte con equipos Teltonika que usan el gateway TCP,
parte solo con posicionamiento Google Maps que reporta por HTTP a Cloud Run).
**No hay todavía clientes B2B con contratos firmados** que exijan 99.9% uptime.

La premisa central de ADR-035 (contratos B2B con SLA vigente) **no se cumple hoy**.
Por tanto su conclusión — sostener el premium de HA/DR — deja de aplicar para el
estado actual del producto. ADR-035 no fue un error: fue correcto bajo su premisa.
Este ADR documenta que la premisa cambió, no que la decisión anterior estuviera mal.

## Estado de la infraestructura construida bajo ADR-035

El follow-up de ADR-035 ("desplegar el gateway en el cluster DR") **sí se ejecutó**:
`infrastructure/k8s/telemetry-tcp-gateway-dr.yaml` existe con `replicas: 2` y está
corriendo en us-central1 (verificado en consola 2026-06-05). Es decir, hay
infraestructura de DR caliente realmente desplegada. Deshacerla es una acción
deliberada, no la simple no-creación de algo.

Hallazgo adicional relevante para el SLA: aun con el gateway DR desplegado, **Cloud
SQL NO tiene réplica cross-region** (es REGIONAL HA en una sola región). Ante una
caída regional completa, el gateway DR levantaría sin base de datos. El "DR" actual
nunca entregó el RTO completo que TRL 10 asumía.

## Decisión

Se reclasifica el objetivo operativo a **pre-comercial** mientras no existan
contratos B2B con SLA. En consecuencia, las tres palancas que ADR-035 rechazó
quedan **habilitadas** para evaluación/aplicación, junto con el right-sizing de
redundancia del gateway:

- **DR → cold** (latente): gateway DR escalado a cero, conservando subnet/IP/DNS/
  cluster en Terraform para reactivar con `terraform apply` + scale-up (RTO 15–40 min).
- **Cloud SQL `REGIONAL` → `ZONAL`** (vía nueva variable, reversible, con runbook).
- **Redis `STANDARD_HA` → `BASIC`**.
- **Gateway primary `replicas`/HPA `min` 2 → 1**.
- Se mantienen: la **log exclusion** de ADR-035 y todo **ADR-034** (tier Cloud SQL,
  `min_instances=0` en servicios marginales).

El detalle de diffs, runbooks y priorización vive en
`.specs/cost-optimization-precomercial/` y en el PR de costos asociado.

## Consecuencias

### Positivas
- Gasto mensual proyectado de ~CLP 774k a ~CLP 350–450k (−45% aprox.).
- La infra deja de pagar un premium de SLA por clientes que aún no existen.
- Elimina la falsa sensación de seguridad de un "DR" que no replicaba la BD.

### Negativas / riesgos aceptados
- Se reduce redundancia: failover Redis, cold starts del api, un solo pod de
  gateway, sin failover regional automático, BD single-zone.
- Ante caída de zona/región, el RTO pasa a ser de minutos a decenas de minutos
  (manual), no automático. Aceptable para ≤10 camiones en pre-comercial con
  backups + PITR de Cloud SQL.

### Condición de reversión (gatillo explícito)
**Al firmar el primer contrato B2B con SLA de uptime**, este ADR se revierte:
volver a `REGIONAL` (flip de `cloudsql_high_availability`), Redis `STANDARD_HA`,
reactivar DR. Y en ese momento el upgrade correcto NO es el warm anterior sino
**DR multi-región completo con read replica de Postgres** — evaluar con presupuesto
dedicado. Hasta entonces, rige la postura pre-comercial de este ADR.

## Fuera de alcance de este ADR (drift de seguridad detectado)
Durante la revisión apareció drift no relacionado entre `main` y prod (Cloud
Function `beforeCreate` viva pese a ADR-057; binding de Owner group vs user). Se
tratan en issues/PRs de seguridad separados — **no** se tocan aquí ni en el PR de
costos.

## Referencias
- ADR-035 (superseded) — `035-trl10-mantener-ha-recortar-ruido.md`
- ADR-034 — right-sizing (vigente)
- `infrastructure/dr-region.tf`, `infrastructure/data.tf`, `infrastructure/k8s/telemetry-tcp-gateway*.yaml`
- Conversación 2026-06-05 con PO: reclasificación a pre-comercial (≤10 camiones, sin contratos B2B)
