# Estado actual del proyecto — Booster AI

**Última actualización**: 2026-11-15 22:35 · `RUTAS_API_ACTIVADA=true` **aplicado en prod** por el PO (22:32) y verificado · matching sigue `sombra`. Horas en America/Santiago.
**Anterior**: CURRENT del cableado de rutas (#971). Contrato: `CLAUDE.md`. Frentes: `docs/frentes-vivos.md`.

## Estado de prod vs main

| | Commit | Notas |
|---|---|---|
| `main` | `e2af0901` | #971 cableado `RUTAS_API_ACTIVADA`; #970 staging checklist; #969 evidencia matching sombra; + chat DRAFT (#968) + ADR-092 DRAFT (#967) |
| Prod (Cloud Run) | `27f33609` | Release [43759089375](https://github.com/boosterchile/booster-ai/actions/runs/43759089375) **success** (18:23). Api en revisión `booster-ai-api-00477-6tg` (misma imagen, flag de rutas encendido) |

**Flags en prod:** `RUTAS_API_ACTIVADA=true` desde el 2026-11-15 22:32 (revisión `booster-ai-api-00477-6tg`, 100 % del tráfico). `MATCHING_ELEGIBILIDAD_MODO=sombra` (**sin cambio**). Staging gemelo aún no existe — checklist: `docs/handoff/2026-11-16-staging-checklist-adr083.md`.

**Apply del flip de rutas (22:31–22:32):** plan desde worktree de `origin/main` (`e2af0901`) con `-target=module.service_api`: `0 to add, 1 to change, 0 to destroy`, solo agrega `RUTAS_API_ACTIVADA="true"`; sin drift ajeno; `check-validated-secret-placeholders` OK. Lo aplicó el PO. Smoke posterior: `/health` y `/ready` 200; `/feature-flags` → `rutas_api_activada: true`; `GET /rutas` sin auth → 401. **Sin probar:** `/rutas` con sesión de transportista y una ruta con dos cargas punta a punta. Reverso: `docs/handoff/2026-11-16-rutas-api-activada-oneshot.md`.

**Post-deploy verificado (18:24–18:47):** los 8 servicios sirven `27f33609`. Migración `0083` confirmada (84 filas). Cron `vehiculo-pendiente-recordatorio` ENABLED. IAM `cursor-agent` (#962) aplicado (solo Scheduler + tfstate; **no** Cloud Run update).

## Plan post-deploy 2026-11-15 — **cerrado**

| Frente | Estado |
|---|---|
| Huella consolidada (6 partes) | **En prod** (#956). `/app/rutas` visible desde el flip de rutas |
| Matching desde la carga (6 partes) | **En prod** (#958) + cron + IAM `cursor-agent` (#962); modo **sombra** |
| Ruta consolidada | 1–7 en prod, **API encendida** (2026-11-15 22:32). Parte 8 (migración contract): al final |
| Reemisión certificados | Partes 1–5 en main/prod. Parte 6: reemitir BOO-YWKZWR — ejecuta el PO |
| Etapas 5–6 | Sin empezar |
| Etapas 0–2 abiertos | ADR-092 (#967 DRAFT); chat destinatario–conductor (#968 DRAFT) |

**Rutas encendidas en prod.** Matching `activa` **no** autorizado — pedir confirmación explícita después de probar una ruta con dos cargas.

## WIP

- Cupos agente: este PR de handoff. Drafts #876, #877, #748: no tocar sin pedido.

## Pendientes del PO (orden)

1. ~~Aprobar environment `production` del release~~ — hecho; deploy success 18:23.
2. ~~Confirmar migración `0083`~~ — confirmada.
3. ~~`terraform apply` del cron y del IAM de `cursor-agent`~~ — aplicados.
4. ~~Visto y apply de `RUTAS_API_ACTIVADA`~~ — aplicado 2026-11-15 22:32; smoke básico en verde. **Falta:** probar una ruta con dos cargas punta a punta.
5. Pasar matching `sombra` → `activa` — **solo con visto explícito aparte** tras smoke de rutas. Evidencia sombra: `docs/handoff/2026-11-16-evidencia-matching-sombra.md` (0 comparaciones live).
6. Un viaje con camión CAN → primer certificado primario.
7. Reemitir BOO-YWKZWR; decidir los 3 Teltonika sin sello.
8. Mirar Flota/Maps en prod.
9. (Opcional, ADR-083) Staging gemelo — checklist en seco ya en `main`.

## Lo que sigue del lado del agente

1. Apoyar la prueba de una ruta con dos cargas en prod cuando el PO la corra.
2. **No** flip `MATCHING_ELEGIBILIDAD_MODO=activa` sin confirmación explícita nueva del PO.
3. Staging: el agente no crea proyecto ni aplica Terraform.
4. Candidatos solo con rutas ON / visto matching: etapa 5–6, rutas parte 8.

## Riesgos abiertos

Recogida exige conductor. Carrocería obligatoria. CAN sin viaje real. Ruta consolidada encendida pero sin prueba real con dos cargas. Certificados no reproducibles. `cursor-agent` escribe Scheduler + tfstate pero **no** puede mutar Cloud Run env. Drift Redis `getAuthString` en plan completo del cron. El flip de rutas se aplicó con `-target`: no se corrió un plan completo después.
