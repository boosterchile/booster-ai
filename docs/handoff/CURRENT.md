# Estado actual del proyecto — Booster AI

**Última actualización**: 2026-11-17 · America/Santiago (Booster Fleet en prod).  
**Prod**: `b9f512d0` (Release on request [44088137366](https://github.com/boosterchile/booster-ai/actions/runs/44088137366) SUCCESS; Cloud Build `7897c23a`) — api `booster-ai-api-00486-brt` @ **100 %**, web `00428-f8j` @ 100 %. Incluye Booster Fleet (#1002) + disparador release-on-request (#1003).  
**`main`**: tip `b876af16` (#1004 guardas CI del release-on-request); sin código de producto pendiente de deploy respecto de Fleet.  
**Contrato**: `CLAUDE.md`. Frentes: `docs/frentes-vivos.md`.

## Score producto (P)

- **P ≈ 3.2–3.5/5** tras **E1** (BARH-23/24 en prod). Meta 5: E2–E8 en oneshot.
- **C (comercial/legal)** aparte — no mezcla con funcionamiento.
- Oneshot: [`2026-11-16-score-p5-barh2324-oneshot.md`](./2026-11-16-score-p5-barh2324-oneshot.md).

## Estado de prod vs main

| | Commit | Notas |
|---|---|---|
| `main` | `b876af16` | #1002 Fleet + #1003 release-on-request + #1004 guardas |
| Prod | `b9f512d0` | Imagen de #1003; api/web al 100 %; canary 30 min OK |

**Flags conservados:** matching `activa`, `RUTAS_API_ACTIVADA=true`, `EMAIL_FROM=Booster <contacto@boosterchile.com>`.  
**Smoke (2026-11-17):** `/health` 200, `/ready` 200, `/booster-fleet` **401** (`{"error":"Unauthorized"}`, ruta montada), web `/app/booster-fleet` 200.  
**Registros:** `Drizzle migrate() complete` en `00486-brt` @ 13:15:11Z (America/Santiago 10:15).  
**Terraform Drift Check:** el programado del 2026-11-16 18:01 falló por una sola diferencia (faltaba la variable del remitente en el api). El run [44006376104](https://github.com/boosterchile/booster-ai/actions/runs/44006376104), posterior al release BARH, terminó sin diferencias entre GCP y `main`.

## Evidencia Score P

| # | Estado | Nota |
|---|---|---|
| **E1** | **Hecho** | Release BARH-23/24 en prod (`00483-ppx` / `00427-z4w`) |
| E2 | Pendiente | Invitados `/crear-cuenta` + login |
| E3 | Pendiente | Activación conductor solo por canal |
| E4 | Pendiente | Viaje E2E sin intervención PO → cert |
| E5 | Pendiente | Matching real o reclamo documentado |
| E6 | Pendiente | Viaje propio (`origen_alta=propio_transportista`) |
| E7 | Pendiente | Viaje sin FMC150 + DQ |
| E8 | Pendiente | Ciclo cobro técnico |

Migración **0085**: aplicada y verificada en prod el 2026-11-16 (solo lectura). Migración **0086** (`mantenciones_vehiculo`): aplicada al startup de `00486-brt` el 2026-11-17 (`migrate()` complete; sin acceso SELECT del agente a Secret Manager para contar filas en `__drizzle_migrations`).

## Staging

**No existe** (revisado el 2026-11-17, solo lectura). Lo que pide [ADR-083](../adr/083-staging-gemelo-y-extraccion-con-shadow.md) está sin crear:

- El proyecto `booster-ai-stg-494222` no aparece entre los proyectos visibles para la cuenta del PO; no se descarta uno creado bajo otra cuenta.
- `staging.boosterchile.com` no tiene delegación NS y `api.staging.boosterchile.com` no resuelve.
- El repo no tiene entorno `staging` en GitHub ni ninguna variable `STAGING_*`.
- «Deploy staging» corre en cada push a `main` y se omite siempre (sus últimos 100 runs): el job exige la variable `STAGING_PROJECT_ID`. BARH-23/24 llegaron a prod sin pasar por staging.
- Solo existe la preparación en `infrastructure/environments/staging/`. Crear el proyecto, vincular la facturación, el `terraform apply` y el registro NS en prod son pasos del PO.

## BARH-21

Invites enviados; **cuentas no confirmadas** (`gerencia@`, `sandoval.felipe@`).

## Pendientes del PO (Score P)

1. Confirmar `/crear-cuenta` de invitados (E2).
2. 1 activación conductor por canal (E3).
3. 1 viaje E2E sin parche → cert (E4).
4. 1 reclamo o matching real + 1 viaje propio (E5–E6).
5. Viaje sin FMC150 + DQ (E7); luego cobro técnico (E8).

## Booster Fleet

**En prod** (2026-11-17). Spec `.specs/booster-fleet/spec.md`. PRs [#1002](https://github.com/boosterchile/booster-ai/pull/1002) (feature) + [#1003](https://github.com/boosterchile/booster-ai/pull/1003) (release-on-request). Panel `/app/booster-fleet`, API `/booster-fleet`, migración **0086** `mantenciones_vehiculo` (expand-only; `migrate()` OK en el arranque de `00486-brt`). El cobro sigue en la bandera de gestión de flota. Oneshot: [`2026-11-17-booster-fleet-release-oneshot.md`](./2026-11-17-booster-fleet-release-oneshot.md). Queda smoke con sesión dueño/admin transportista (criterio de término en `frentes-vivos.md`).

## Agente

Observar/anotar E2–E8; **no** aprueba Environment `production` (ADR-076). `cursor-agent` tiene `run.developer`; no tiene `actions:write`. Release a prod vía `release.yml` (dispatch) o `release-on-request.yml` (archivo en `.github/release-requests/`) + Approve humano.

## Riesgos

Staging no existe: lo que entra a `main` se prueba por primera vez en prod. Matching `activa` aún sin observación real. Demo domain vivo. SMS Twilio faltante. Certs solo secundarios / cifras bajas sin reemitir.
