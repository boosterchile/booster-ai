# Estado actual del proyecto — Booster AI

**Última actualización**: 2026-11-17 · America/Santiago (Booster Fleet en rama; prod sin cambios de código).  
**Prod**: `30f42658` (release [43998394616](https://github.com/boosterchile/booster-ai/actions/runs/43998394616) SUCCESS) — api `booster-ai-api-00483-ppx` @ **100 %**, web `00427-z4w` @ 100 %. Incluye BARH-23 reclamar + BARH-24 viaje propio (+ oneshot Score P docs).  
**`main`**: por delante de prod solo en commits de documentación de handoff (desde #999); sin código por desplegar.  
**Contrato**: `CLAUDE.md`. Frentes: `docs/frentes-vivos.md`.

## Score producto (P)

- **P ≈ 3.2–3.5/5** tras **E1** (BARH-23/24 en prod). Meta 5: E2–E8 en oneshot.
- **C (comercial/legal)** aparte — no mezcla con funcionamiento.
- Oneshot: [`2026-11-16-score-p5-barh2324-oneshot.md`](./2026-11-16-score-p5-barh2324-oneshot.md).

## Estado de prod vs main

| | Commit | Notas |
|---|---|---|
| `main` | `30f42658` + docs de handoff | #998 oneshot + CURRENT; #995/#993 en la imagen; #999 y posteriores no cambian código |
| Prod | `30f42658` | Release 43998394616; los 8 servicios de Cloud Run al 100 % en su última revisión con esa imagen |

**Flags conservados:** matching `activa`, `RUTAS_API_ACTIVADA=true`, `EMAIL_FROM=Booster <contacto@boosterchile.com>`.  
**Smoke:** `/health` 200, `/ready` 200. La ruta web `/app/viajes-propios/nuevo` responde 200, pero no sirve de prueba: la web responde 200 a cualquier ruta. La pantalla queda por ejercitar con sesión (E6).  
**Registros:** un solo error desde el despliegue, el ya conocido de `sms-fallback-gateway` al arrancar (falta configuración de Twilio).  
**Terraform Drift Check:** el programado del 2026-11-16 18:01 falló por una sola diferencia (faltaba la variable del remitente en el api). El run [44006376104](https://github.com/boosterchile/booster-ai/actions/runs/44006376104), posterior al release, terminó sin diferencias entre GCP y `main`.

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

Migración **0085**: aplicada y verificada en prod el 2026-11-16 (solo lectura). 86 migraciones registradas; `viajes` tiene las 4 columnas nuevas y las 2 restricciones (`ck_viajes_origen_alta`, `ck_viajes_cliente_propio`); 0 viajes con origen `propio_transportista`.

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

Pedido del PO el 2026-11-17. Configuración de gestión de flota para el dueño del transportista: combustible (misma lectura de 7 días que los trayectos), documentos obligatorios de cada vehículo y conductor, y mantenciones. Spec `.specs/booster-fleet/spec.md`. No está en prod. El cobro sigue en la bandera de gestión de flota.

## Agente

Observar/anotar E2–E8; **no** dispara release ni opera el viaje. `cursor-agent` puede mutar env del api (`run.developer`); no tiene `actions:write`.

## Riesgos

Staging no existe: lo que entra a `main` se prueba por primera vez en prod. Matching `activa` aún sin observación real. Demo domain vivo. SMS Twilio faltante. Certs solo secundarios / cifras bajas sin reemitir.
