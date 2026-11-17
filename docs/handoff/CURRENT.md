# Estado actual del proyecto — Booster AI

**Última actualización**: 2026-11-16 23:35 · America/Santiago.  
**Prod**: `30f42658` (release [43998394616](https://github.com/boosterchile/booster-ai/actions/runs/43998394616) SUCCESS) — api `booster-ai-api-00483-ppx` @ **100 %**, web `00427-z4w` @ 100 %. Incluye BARH-23 reclamar + BARH-24 viaje propio (+ oneshot Score P docs).  
**`main`**: `30f42658` — alineado con prod tras este release.  
**Contrato**: `CLAUDE.md`. Frentes: `docs/frentes-vivos.md`.

## Score producto (P)

- **P ≈ 3.2–3.5/5** tras **E1** (BARH-23/24 en prod). Meta 5: E2–E8 en oneshot.
- **C (comercial/legal)** aparte — no mezcla con funcionamiento.
- Oneshot: [`2026-11-16-score-p5-barh2324-oneshot.md`](./2026-11-16-score-p5-barh2324-oneshot.md).

## Estado de prod vs main

| | Commit | Notas |
|---|---|---|
| `main` | `30f42658` | #998 oneshot + CURRENT; #995/#993 en la imagen |
| Prod | `30f42658` | Release 43998394616; canary 1 % × 30 min → 100 % |

**Flags conservados:** matching `activa`, `RUTAS_API_ACTIVADA=true`, `EMAIL_FROM=Booster <contacto@boosterchile.com>`.  
**Smoke:** `/health` 200, `/ready` 200 (db ok), `/app/viajes-propios/nuevo` 200.

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

Migración **0085**: va con el migrate del release; confirmar con SQL del oneshot §3.2 si hace falta evidencia DB explícita.

## BARH-21

Invites enviados; **cuentas no confirmadas** (`gerencia@`, `sandoval.felipe@`).

## Pendientes del PO (Score P)

1. Confirmar `/crear-cuenta` de invitados (E2).
2. 1 activación conductor por canal (E3).
3. 1 viaje E2E sin parche → cert (E4).
4. 1 reclamo o matching real + 1 viaje propio (E5–E6).
5. Viaje sin FMC150 + DQ (E7); luego cobro técnico (E8).

## Agente

Observar/anotar E2–E8; **no** dispara release ni opera el viaje. `cursor-agent` puede mutar env del api (`run.developer`); no tiene `actions:write`.

## Riesgos

Matching `activa` aún sin observación real. Demo domain vivo. SMS Twilio faltante. Certs solo secundarios / cifras bajas sin reemitir.
