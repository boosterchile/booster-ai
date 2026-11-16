# Estado actual del proyecto — Booster AI

**Última actualización**: 2026-11-16 11:08 · America/Santiago.  
**Prod**: `e0f3ccf4` (release [43874760833](https://github.com/boosterchile/booster-ai/actions/runs/43874760833) SUCCESS) — api `booster-ai-api-00480-zps`, web `00426-ljx`, tráfico **100%**.  
**`main`**: `e0f3ccf4` (#987 oneshot BARH-21; #986 invite correo→`/crear-cuenta`; #985 ADR-093; #984 From `contacto@`).  
**Contrato**: `CLAUDE.md`. Frentes: `docs/frentes-vivos.md`.

## Estado de prod vs main

| | Commit | Notas |
|---|---|---|
| `main` | `e0f3ccf4` | Alineado con prod post-release BARH-21 |
| Prod (Cloud Run) | `e0f3ccf4` | Release 43874760833. Api `00480-zps`, web `00426-ljx`, 100% |

**Flags en prod:** `RUTAS_API_ACTIVADA=true`, `MATCHING_ELEGIBILIDAD_MODO=activa`. Staging gemelo aún no existe — `docs/handoff/2026-11-16-staging-checklist-adr083.md`.

## Verify post-release BARH-21 (hecho)

- Smoke: `/health`, `/ready`, web → **200**.
- Migración: logs `migrate` completos en la revisión nueva. Journal SQL **0084** no confirmado vía `agent-query` (IAP **4033**).
- `EMAIL_FROM` **ausente** en env de Cloud Run; default de imagen: `Booster <contacto@boosterchile.com>`.
- **No** se enviaron invitaciones desde el agente.

Oneshot (invite pendiente PO): [`2026-11-16-deploy-barh21-invite-oneshot.md`](./2026-11-16-deploy-barh21-invite-oneshot.md).  
**Cursor no** dispara release ni `terraform apply`.

## Resumen operativo (prod actual)

- Matching `activa` desde 01:15 (PO apply). **Sin observar** matching real aún → al primer matching: log `matching: elegibilidad por carga` + ofertas; registrar aquí.
- Rutas API ON; prueba dos cargas OK (datos de prueba en prod).
- #977 en prod: regla 50 % distancia medida. **Sin observar** cierre real post-deploy. Certificados con cifra baja (BOO-BKAXIK, BOO-KY7G69, BOO-4FF3XA, BOO-VZYIN2) sin reemitir.
- From de mail: default imagen `contacto@` (sin `EMAIL_FROM` en Cloud Run). TF opcional para fijar env.
- `sms-fallback-gateway`: aviso Twilio faltante (deuda previa).

## Plan post-deploy 2026-11-15 — **cerrado**

| Frente | Estado |
|---|---|
| Huella consolidada | **En prod** (#956) |
| Matching desde la carga | **En prod** (#958) + cron; modo **activa** |
| Ruta consolidada | API encendida; parte 8 (contract) al final |
| Reemisión certificados | Partes 1–5 en prod. BOO-YWKZWR — PO |
| Etapas 5–6 / 0–2 | Sin empezar / drafts |

## WIP

- Este PR: handoff post-release BARH-21. Drafts #876, #877, #748: no tocar sin pedido.

## Pendientes del PO (orden)

1. **Invitar** `gerencia@boosterchile.com` y `sandoval.felipe@gmail.com` desde `/app/platform-admin/personal` → «Invitar por correo» → mail → `/crear-cuenta` → login correo+clave. **No hechas** por el agente.
2. (Opcional) TF / env `EMAIL_FROM` en Cloud Run.
3. Confirmar Resend acepta From `contacto@boosterchile.com`.
4. BARH-23 / BARH-24: esperan spec del PO.
5. Mirar el primer matching real en `activa`; transportistas declaren carrocería.
6. Un viaje con camión CAN → primer certificado primario.
7. Reemitir BOO-YWKZWR; decidir los 3 Teltonika sin sello / cifras bajas.
8. Mirar Flota/Maps en prod.
9. (Opcional) Staging gemelo ADR-083.

## Lo que sigue del lado del agente

1. Observar / anotar el primer matching real en `activa` (logs + ofertas).
2. Con el primer cierre post-#977: confirmar v3 / no-plausible.
3. `cursor-agent` **no** muta Cloud Run env, no dispara release, no envía invites.
4. Candidatos: etapa 5–6, rutas parte 8 — solo con cupo y pedido.

## Riesgos abiertos

Matching `activa` sin matching real observado; sin carrocería, solo `carga_seca`/`otra`. Recogida exige conductor. Certificados no reproducibles / cifras bajas sin reemitir. Journal 0084 no verificado por SQL (IAP 4033). Invitaciones BARH-21 aún pendientes del PO.
