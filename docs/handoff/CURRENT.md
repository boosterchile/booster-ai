# Estado actual del proyecto — Booster AI

**Última actualización**: 2026-11-16 00:50 · PDF de la ruta de prueba revisados: huella impresa casi nula; regla de plausibilidad en `main` (#977), **sin desplegar** · veredicto prod: matching **sigue `sombra`** (PO dijo «corrido»; apply **no** aterrizó). `RUTAS_API_ACTIVADA` **ON**. Oneshot matching re-pasado. Horas en America/Santiago.
**Anterior**: veredicto matching 00:32 (#978); re-smoke «verifica» 23:49 + #976 oneshot; #975 ruta dos cargas. Contrato: `CLAUDE.md`. Frentes: `docs/frentes-vivos.md`.

## Estado de prod vs main

| | Commit | Notas |
|---|---|---|
| `main` | `9d94e267` | #978 handoff matching; #977 distancia medida plausible (`1aaa3c07`); #976 handoff/oneshot matching; #975 ruta dos cargas; #971 rutas cableadas |
| Prod (Cloud Run) | `27f33609` | Release [43759089375](https://github.com/boosterchile/booster-ai/actions/runs/43759089375) **success**. Api revisión `booster-ai-api-00477-6tg` (rutas ON; matching aún sombra) |

**Flags en prod:** `RUTAS_API_ACTIVADA=true` (revisión `booster-ai-api-00477-6tg`, 100 %). `MATCHING_ELEGIBILIDAD_MODO=sombra` (**sin cambio** pese al visto PO). Staging gemelo aún no existe — checklist: `docs/handoff/2026-11-16-staging-checklist-adr083.md`.

**Veredicto matching «corrido» (00:32 -03):** gcloud `MATCHING_ELEGIBILIDAD_MODO=sombra`, `RUTAS_API_ACTIVADA=true`; latestReady `booster-ai-api-00477-6tg` 100 %; `/health` `/ready` 200; `/feature-flags` → `rutas_api_activada: true` (elegibilidad no se expone en ese endpoint). **No** hay revisión nueva tras el flip de rutas → apply `activa` no corrió. Re-pasar: `docs/handoff/2026-11-16-matching-elegibilidad-activa-oneshot.md`.

**Re-smoke rutas (23:48–23:49 -03):** rutas ON; matching sombra; misma revisión `00477-6tg`.

**Apply del flip de rutas (22:31–22:32):** plan `-target=module.service_api` solo agregó `RUTAS_API_ACTIVADA="true"`. Lo aplicó el PO. Smoke + `/app/rutas` con sesión transportista OK. Reverso: `docs/handoff/2026-11-16-rutas-api-activada-oneshot.md`.

**Plan completo tras el flip (22:57):** `terraform plan` sin `-target` desde `origin/main`: `No changes.` Nada aplicado.

**Prueba de una ruta con dos cargas (23:19–23:32):** generador Prueba Generador SpA, transportista Transportes Van Oosterwyk, camión KXSV65. Cargas `BOO-VZYIN2` / `BOO-4FF3XA` → ruta consolidada `cerrada`, huella repartida, 2 certificados v1. Observaciones: GPS escritorio ~0,03 km; huella 100 % hasta reordenar; hoja conductor sin refresh; 404 instrucciones-retiro; ofertas $0. Datos de prueba quedan en prod (PO).

**PDF de la ruta de prueba y regla de plausibilidad (00:05–00:23):** los dos PDF (hash igual al de la base, firma `valid: true`) imprimen 0,02 y 0,01 kg CO₂e; la estimación era 20,864 y 8,127. Sección «Carga consolidada», reparto y sello «Estimado» correctos. Causa: la cobertura mide continuidad y un equipo quieto da 100 % con 0,03 km de deriva. En prod hay además dos certificados Teltonika con el mismo patrón: BOO-BKAXIK (2,51 km de 500) y BOO-KY7G69 (195,95 de 471,60). Decisión del PO («A con 50 %»): la distancia solo cuenta como medida si alcanza el 50 % de la estimada del viaje o de la ruta; si no, cae a la estimación con `distancia_no_plausible`. Spec `.specs/distancia-medida-plausible/`, PR #977 en `main`, **sin desplegar**. Fuera de alcance: reemitir, el backfill manual de distancia y el texto de la pantalla del conductor.

**Post-deploy verificado (18:24–18:47):** 8 servicios en `27f33609`. Migración `0083` OK. Cron `vehiculo-pendiente-recordatorio` ENABLED. IAM `cursor-agent` (#962): Scheduler + tfstate; **no** Cloud Run update.

## Plan post-deploy 2026-11-15 — **cerrado**

| Frente | Estado |
|---|---|
| Huella consolidada (6 partes) | **En prod** (#956). `/app/rutas` visible |
| Matching desde la carga (6 partes) | **En prod** (#958) + cron + IAM; modo **sombra** (visto PO para `activa`; apply pendiente) |
| Ruta consolidada | 1–7 en prod, **API encendida**. Parte 8 (migración contract): al final |
| Reemisión certificados | Partes 1–5 en main/prod. Parte 6: reemitir BOO-YWKZWR — PO |
| Etapas 5–6 | Sin empezar |
| Etapas 0–2 abiertos | ADR-092 (#967 DRAFT); chat destinatario–conductor (#968 DRAFT) |

**Rutas ON.** Matching `activa`: **visto PO sí**; **runtime sigue sombra** — falta apply owner/Claude Code.

## WIP

- Cupos agente: este PR handoff (veredicto matching + oneshot re-pasado). Drafts #876, #877, #748: no tocar sin pedido.

## Pendientes del PO (orden)

1. ~~Aprobar environment `production` del release~~ — hecho.
2. ~~Confirmar migración `0083`~~ — confirmada.
3. ~~`terraform apply` del cron y del IAM de `cursor-agent`~~ — aplicados.
4. ~~Visto y apply de `RUTAS_API_ACTIVADA`~~ — aplicado 22:32; ruta dos cargas OK. PDF revisados (ver arriba). **Falta:** decidir la reemisión de los 4 certificados con cifras bajas; mirar la vista del generador.
5. ~~Visto matching `sombra` → `activa`~~ — sí. **Falta apply** (oneshot re-pasado; Cursor no puede mutar Cloud Run env). Evidencia sombra: `docs/handoff/2026-11-16-evidencia-matching-sombra.md`.
6. Un viaje con camión CAN → primer certificado primario.
7. Reemitir BOO-YWKZWR; decidir los 3 Teltonika sin sello.
8. Mirar Flota/Maps en prod.
9. (Opcional, ADR-083) Staging gemelo — checklist en seco en `main`.

## Lo que sigue del lado del agente

1. Owner/Claude Code: apply oneshot matching (`docs/handoff/2026-11-16-matching-elegibilidad-activa-oneshot.md`); luego smoke gcloud + health.
2. Tras apply real: actualizar CURRENT a matching `activa` + rutas ON.
3. `cursor-agent` **no** puede mutar Cloud Run env — sin interim `gcloud run services update` desde aquí.
4. Tras el release con #977: confirmar en prod que un cierre no plausible cae a la estimación. Las demás observaciones de la prueba de ruta, si el PO lo pide.
5. Staging: el agente no crea proyecto ni aplica Terraform.
6. Candidatos post-`activa`: etapa 5–6, rutas parte 8.

## Riesgos abiertos

Recogida exige conductor. Carrocería obligatoria. CAN sin viaje real. Ruta consolidada probada con un generador y camión sin telemetría. Cuatro certificados emitidos con distancia medida bajo el 50 % de la estimada (BOO-BKAXIK, BOO-KY7G69, BOO-4FF3XA, BOO-VZYIN2), sin reemitir; la regla de #977 no está en prod. El backfill manual de distancia no pasa por esa regla. Certificados no reproducibles. `cursor-agent` escribe Scheduler + tfstate pero **no** puede mutar Cloud Run env.
