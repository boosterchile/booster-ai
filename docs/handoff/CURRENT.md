# Estado actual del proyecto — Booster AI

**Última actualización**: 2026-11-16 · visto PO para `RUTAS_API_ACTIVADA`; cableado TF listo; **prod aún OFF** (falta apply owner) · matching sigue `sombra`. Horas en America/Santiago.
**Anterior**: CURRENT del 2026-11-16 (checklist staging ADR-083 #970). Contrato: `CLAUDE.md`. Frentes: `docs/frentes-vivos.md`.

## Estado de prod vs main

| | Commit | Notas |
|---|---|---|
| `main` | `10adbe19` | #970 staging checklist; #969 evidencia matching sombra; + chat DRAFT (#968) + ADR-092 DRAFT (#967) |
| Prod (Cloud Run) | `27f33609` | Release [43759089375](https://github.com/boosterchile/booster-ai/actions/runs/43759089375) **success** (18:23 America/Santiago) |

**Flags en prod:** `MATCHING_ELEGIBILIDAD_MODO=sombra` (**sin cambio**). `RUTAS_API_ACTIVADA` **sigue ausente (= falsa)** en la revisión lista `booster-ai-api-00476-lts`. Visto PO 2026-11-16 («ok, dale») para encender rutas; `cursor-agent` no tiene `run.services.update` → one-shot owner/Claude Code: `docs/handoff/2026-11-16-rutas-api-activada-oneshot.md`. Staging gemelo aún no existe — checklist: `docs/handoff/2026-11-16-staging-checklist-adr083.md`.

**Baseline smoke pre-apply (22:19–22:20 -03):** `GET /health` y `/ready` OK; `GET /feature-flags` → `rutas_api_activada: false`; `GET /rutas` sin auth → 401. Intento `gcloud run services update … RUTAS_API_ACTIVADA=true` → `PERMISSION_DENIED` (`cursor-agent@`).

**Post-deploy verificado (18:24–18:47):** los 8 servicios sirven `27f33609`. Migración `0083` confirmada (84 filas). Cron `vehiculo-pendiente-recordatorio` ENABLED. IAM `cursor-agent` (#962) aplicado (solo Scheduler + tfstate; **no** Cloud Run update).

## Plan post-deploy 2026-11-15 — **cerrado**

| Frente | Estado |
|---|---|
| Huella consolidada (6 partes) | **En prod** (#956). `/app/rutas` detrás del flag (aún OFF en prod) |
| Matching desde la carga (6 partes) | **En prod** (#958) + cron + IAM `cursor-agent` (#962); modo **sombra** |
| Ruta consolidada | 1–7 en prod (API apagada hasta apply del one-shot). Parte 8 (migración contract): al final |
| Reemisión certificados | Partes 1–5 en main/prod. Parte 6: reemitir BOO-YWKZWR — ejecuta el PO |
| Etapas 5–6 | Sin empezar |
| Etapas 0–2 abiertos | ADR-092 (#967 DRAFT); chat destinatario–conductor (#968 DRAFT) |

**Visto PO de rutas recibido.** Falta el apply owner para que prod quede ON. Matching `activa` **no** autorizado en este paso — pedir confirmación explícita después del smoke de rutas.

## WIP

- Cupos agente: PR cableado `RUTAS_API_ACTIVADA` + handoff (esta rama). Staging checklist (#970) en `main`. Drafts #876, #877, #748: no tocar sin pedido.

## Pendientes del PO (orden)

1. ~~Aprobar environment `production` del release~~ — hecho; deploy success 18:23.
2. ~~Confirmar migración `0083`~~ — confirmada.
3. ~~`terraform apply` del cron y del IAM de `cursor-agent`~~ — aplicados.
4. ~~Visto para `RUTAS_API_ACTIVADA`~~ — «ok, dale» 2026-11-16. **Falta apply:** `docs/handoff/2026-11-16-rutas-api-activada-oneshot.md` (Claude Code / ADC owner). Luego smoke `/feature-flags` → `rutas_api_activada: true` y ruta con dos cargas.
5. Pasar matching `sombra` → `activa` — **solo con visto explícito aparte** tras smoke de rutas. Evidencia sombra: `docs/handoff/2026-11-16-evidencia-matching-sombra.md` (0 comparaciones live).
6. Un viaje con camión CAN → primer certificado primario.
7. Reemitir BOO-YWKZWR; decidir los 3 Teltonika sin sello.
8. Mirar Flota/Maps en prod.
9. (Opcional, ADR-083) Staging gemelo — checklist en seco ya en `main`.

## Lo que sigue del lado del agente

1. Tras el apply del PO: re-smoke `/health` + `/feature-flags` + `/rutas` y actualizar CURRENT a flag ON (matching sigue sombra).
2. **No** flip `MATCHING_ELEGIBILIDAD_MODO=activa` sin confirmación explícita nueva del PO.
3. Staging: el agente no crea proyecto ni aplica Terraform.
4. Candidatos solo con rutas ON / visto matching: etapa 5–6, rutas parte 8.

## Riesgos abiertos

Recogida exige conductor. Carrocería obligatoria. CAN sin viaje real. Ruta consolidada sin prueba real hasta flag ON + uso. Certificados no reproducibles. `cursor-agent` escribe Scheduler + tfstate pero **no** puede mutar Cloud Run env (bloqueo de este flip). Drift Redis `getAuthString` en plan completo del cron.
