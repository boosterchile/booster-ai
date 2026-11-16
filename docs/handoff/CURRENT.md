# Estado actual del proyecto — Booster AI

**Última actualización**: 2026-11-16 · evidencia matching sombra (solo lectura) · `main` = `dd19f40b` (#968 chat DRAFT; #967 ADR-092 DRAFT) · prod sin cambio de flags. Horas en America/Santiago.
**Anterior**: CURRENT del 2026-11-15 20:27 (#964). Contrato: `CLAUDE.md`. Frentes: `docs/frentes-vivos.md`.

## Estado de prod vs main

| | Commit | Notas |
|---|---|---|
| `main` | `dd19f40b` | + chat DRAFT (#968) + ADR-092 DRAFT (#967) sobre Matching 4–6 (#958) + huella (#956) + IAM `cursor-agent` (#962) |
| Prod (Cloud Run) | `27f33609` | Release [43759089375](https://github.com/boosterchile/booster-ai/actions/runs/43759089375) **success** (18:23 America/Santiago) |

**Flags en prod (sin cambio):** `MATCHING_ELEGIBILIDAD_MODO=sombra`. `RUTAS_API_ACTIVADA` no definida (= falsa). Staging gemelo aún no existe.

**Post-deploy verificado (18:24–18:47):** `GET https://api.boosterchile.com/health` y `/ready` OK. Los 8 servicios de Cloud Run sirven `27f33609` con el 100 % en su última revisión lista. Migración `0083` **confirmada**: `drizzle.__drizzle_migrations` tiene 84 filas (0000–0083) y `asignaciones` tiene `recordatorio_vehiculo_24h_en` / `_2h_en` (consulta de solo lectura con ADC).

**Cron `vehiculo-pendiente-recordatorio`:** Job `ENABLED`, `*/15 * * * *` America/Santiago, OIDC `internal-cron-invoker`. Re-verificado 20:23–20:27 con `cursor-agent`: `gcloud scheduler jobs describe` → `ENABLED`; corridas recientes `200` (~26 ms) a las 19:45 / 20:00 / 20:15 -03. Reverso: `gcloud scheduler jobs pause vehiculo-pendiente-recordatorio --location southamerica-east1`.

**IAM de `cursor-agent` (#962) aplicado; chicken-egg cerrado:** apply del PO (4 to add) sobre tfstate objectUser, rol `cursorAgentSchedulerWriter`, binding de proyecto y actAs sobre `internal-cron-invoker`. Re-verificado 20:23–20:27: lock de tfstate OK; `terraform plan -target=google_service_account_iam_member.cursor_agent_act_as_cron_invoker` → **No changes**; `terraform plan -target=google_cloud_scheduler_job.vehiculo_pendiente_recordatorio` adquiere lock y refresca, y falla al refrescar `google_redis_instance.main` por `redis.instances.getAuthString` (la SA no tiene ese permiso; no es fallo de Scheduler/IAM del cron). Con `-refresh=false` el job no cambia (solo drift ajeno de `RESEND_API_KEY` en Cloud Run). Claude Code ya no hace falta para schedulers.

## Plan post-deploy 2026-11-15 — **cerrado**

| Frente | Estado |
|---|---|
| Huella consolidada (6 partes) | **En prod** (#956). `/app/rutas` sigue detrás del flag |
| Matching desde la carga (6 partes) | **En prod** (#958) + cron activo + IAM `cursor-agent` aplicado (#962) |
| Ruta consolidada | 1–7 en prod (API apagada). Parte 8 (migración contract): al final, con rutas estables |
| Reemisión certificados | Partes 1–5 en main/prod. Parte 6: reemitir BOO-YWKZWR — ejecuta el PO |
| Etapas 5–6 | Sin empezar (huella de flota; un solo sistema de diseño) |
| Etapas 0–2 abiertos | ADR-092 anexo tipos carga (#967, DRAFT en main); chat destinatario–conductor (#968, DRAFT en main) |

**Siguiente es decisión del PO de flags** (`RUTAS_API_ACTIVADA`, luego matching `sombra` → `activa`). Sin ese visto no hay paso de código autorizado por `docs/frentes-vivos.md` que no sea flag, migración contract o irreversible en prod.

## WIP

- Cupos agente: este PR de evidencia matching sombra (1/3). Specs chat (#968) y ADR-092 (#967) ya en `main` como DRAFT. Drafts viejos #876, #877, #748: no tocar sin pedido.

## Pendientes del PO (orden)

1. ~~Aprobar environment `production` del release~~ — hecho (~17:45); deploy success 18:23.
2. ~~Confirmar migración `0083`~~ — confirmada (84 aplicadas).
3. ~~`terraform apply` del cron y del IAM de `cursor-agent`~~ — ambos aplicados; chicken-egg cerrado.
4. Encender `RUTAS_API_ACTIVADA` (antes: ruta con dos cargas punta a punta). **Antes** de pasar matching a `activa`.
5. Pasar matching `sombra` → `activa` con comparaciones a la vista. **Paquete de evidencia (2026-11-16):** `docs/handoff/2026-11-16-evidencia-matching-sombra.md` — flag `sombra` OK desde rev `00472` (11-11); **0** comparaciones live (último matching 10-30). Script: `scripts/ops/matching-sombra-evidencia.sh`.
6. Un viaje con camión CAN (KZXB64, LFGR63, KFKW23, PLFL57, RCPC20) → primer certificado primario.
7. Reemitir BOO-YWKZWR; decidir los 3 Teltonika sin sello.
8. Mirar Flota/Maps en prod.

## Lo que sigue del lado del agente

1. No encender `RUTAS_API_ACTIVADA` ni matching `activa` sin visto del PO. Evidencia sombra lista; falta tráfico matching real para rellenar el resumen.
2. Con el IAM de #962, `cursor-agent` puede aplicar por Terraform los próximos jobs de Scheduler; el resto de la infraestructura sigue en manos del PO.
3. Candidatos solo tras flags / visto PO: etapa 5 (huella de flota), etapa 6 (sistema de diseño; congelado hasta Slot 1), rutas parte 8 con rutas encendidas.

## Riesgos abiertos

Tras deploy de #958: recogida exige conductor (BOO-4XZH2K sin conductor no se recoge). Carrocería obligatoria en create/PATCH. CAN sin viaje real. Ruta consolidada sin prueba real. Certificados no reproducibles. ADR-091 sin contraste normativo. Los 20 vehículos de prod siguen sin carrocería: la próxima edición en la web la exigirá. `cursor-agent` puede crear, modificar y borrar cualquier job de Scheduler del proyecto y actuar como `internal-cron-invoker` (riesgo aceptado en `infrastructure/iam.tf`), y puede escribir el state de Terraform (bucket con versionado y borrado suave de 7 días). Un `plan -target` del cron con refresh completo sigue chocando en `redis.instances.getAuthString` (permiso fuera del IAM mínimo de schedulers).
