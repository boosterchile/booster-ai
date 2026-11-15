# Estado actual del proyecto — Booster AI

**Última actualización**: 2026-11-15 · 18:25 America/Santiago · `main` = `32db4f67` (handoff #960; código #956/#958 en `27f33609`) · prod en imagen `27f33609` (revisión `booster-ai-api-00476-lts`, 100%). Horas en America/Santiago.
**Anterior**: CURRENT del 2026-11-15 17:40 (#960, release waiting). Contrato: `CLAUDE.md`. Frentes: `docs/frentes-vivos.md`.

## Estado de prod vs main

| | Commit | Notas |
|---|---|---|
| `main` | `32db4f67` | Matching 4–6 (#958) + huella web (#956) + handoffs |
| Prod (Cloud Run) | `27f33609` | Release [43759089375](https://github.com/boosterchile/booster-ai/actions/runs/43759089375) **success** (18:23 America/Santiago) |

**Flags en prod (sin cambio):** `MATCHING_ELEGIBILIDAD_MODO=sombra`. `RUTAS_API_ACTIVADA` no definida (= falsa). Staging gemelo aún no existe.

**Post-deploy verificado (18:24):** `GET https://api.boosterchile.com/health` y `/ready` OK. `POST /admin/jobs/vehiculo-pendiente-recordatorio` → 401 (ruta viva, exige OIDC). Job Scheduler `vehiculo-pendiente-recordatorio` **aún no existe**. Migración `0083`: SQL vía `agent-query` bloqueado (IAP tunnel 4033 a `db-bastion`). Evidencia indirecta: revisión `00476-lts` logueó `Drizzle migrate() complete` a las 20:51:57 UTC al arrancar; journal en repo incluye `0083_recordatorio_vehiculo_pendiente`. Confirmar tag en `drizzle.__drizzle_migrations` desde el bastion del PO.

## Plan — corte post-merge 2026-11-15

| Frente | Estado |
|---|---|
| Huella consolidada (6 partes) | **En prod** (#956). `/app/rutas` sigue detrás del flag |
| Matching desde la carga (6 partes) | **Código en prod** (#958). Modo sombra; declarar vehículo usable solo con `RUTAS_API_ACTIVADA`. Cron de recordatorio **pendiente de terraform** |
| Ruta consolidada | 1–7 en prod (API apagada). Parte 8 (migración contract): al final, con rutas estables |
| Reemisión certificados | Partes 1–5 en main/prod. Parte 6: reemitir BOO-YWKZWR — ejecuta el PO |
| Etapas 5–6 | Sin empezar (huella de flota; un solo sistema de diseño) |
| Etapas 0–2 abiertos | Anexo tipos de carga chilenos; chat destinatario–conductor |

## WIP

- Cupos agente: **0/3** abiertos propios. Drafts viejos #876, #877, #748: no tocar sin pedido.

## Pendientes del PO (orden)

1. ~~Aprobar environment `production` del release~~ — hecho (~17:45); deploy success 18:23.
2. Confirmar migración `0083` en `drizzle.__drizzle_migrations` (bastion / ADC con IAP).
3. **`terraform apply` de `infrastructure/vehiculo-pendiente.tf`** — la SA `cursor-agent@booster-ai-494222` **no puede**. Bloqueo IAM concreto:
   - Falta `cloudscheduler.jobs.create` (solo get/list).
   - Falta `storage.objects.create` en `gs://booster-ai-tfstate-494222` (no puede tomar lock ni escribir state).
   - Falta `redis.instances.getAuthString` (plan con refresh falla al leer Memorystore).
   - Había lock stale de `felipevicencio@MacBook-Pro-de-Felipe.local` (plan desde 20:38 UTC); liberar si sigue.
   - Plan `-target=…vehiculo_pendiente_recordatorio -lock=false -refresh=false` mostró **1 add + 1 change** (drift fantasma en `module.service_api` / `RESEND_API_KEY`) — no aplicar así. Con ADC del PO: plan debe ser exactamente `1 to add, 0 to change, 0 to destroy`. Checklist en #958. **No** crear el job a mano con `gcloud`.
4. Encender `RUTAS_API_ACTIVADA` (antes: ruta con dos cargas punta a punta). **Antes** de pasar matching a `activa`.
5. Pasar matching `sombra` → `activa` con comparaciones a la vista.
6. Un viaje con camión CAN (KZXB64, LFGR63, KFKW23, PLFL57, RCPC20) → primer certificado primario.
7. Reemitir BOO-YWKZWR; decidir los 3 Teltonika sin sello.
8. Mirar Flota/Maps en prod.

## Lo que sigue del lado del agente

1. Nada bloqueante de código hasta el cron terraform + flags (o pedido del PO).
2. Candidatos siguientes: etapa 5 (huella de flota), etapa 6 (sistema de diseño), o rutas parte 8 solo con rutas encendidas.
3. Poner al día el plan de trabajo cuando exista de nuevo en el repo.

## Riesgos abiertos

Tras deploy de #958: recogida exige conductor (BOO-4XZH2K sin conductor no se recoge). Carrocería obligatoria en create/PATCH. CAN sin viaje real. Ruta consolidada sin prueba real. Certificados no reproducibles. ADR-091 sin contraste normativo. Cron `vehiculo-pendiente-recordatorio` ausente → recordatorios 24 h / 2 h no corren en prod hasta el apply.
