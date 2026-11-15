# Estado actual del proyecto — Booster AI

**Última actualización**: 2026-11-15 · 19:05 America/Santiago · `main` = `4f6fcf48` (handoff #961; código #956/#958 en `27f33609`) · prod en imagen `27f33609` (revisión `booster-ai-api-00476-lts`, 100%). Horas en America/Santiago.
**Anterior**: CURRENT del 2026-11-15 18:26 (#961, release success, cron pendiente). Contrato: `CLAUDE.md`. Frentes: `docs/frentes-vivos.md`.

## Estado de prod vs main

| | Commit | Notas |
|---|---|---|
| `main` | `4f6fcf48` | Matching 4–6 (#958) + huella web (#956) + handoffs |
| Prod (Cloud Run) | `27f33609` | Release [43759089375](https://github.com/boosterchile/booster-ai/actions/runs/43759089375) **success** (18:23 America/Santiago) |

**Flags en prod (sin cambio):** `MATCHING_ELEGIBILIDAD_MODO=sombra`. `RUTAS_API_ACTIVADA` no definida (= falsa). Staging gemelo aún no existe.

**Post-deploy verificado (18:24–18:47):** `GET https://api.boosterchile.com/health` y `/ready` OK. Los 8 servicios de Cloud Run sirven `27f33609` con el 100 % en su última revisión lista. Migración `0083` **confirmada**: `drizzle.__drizzle_migrations` tiene 84 filas (0000–0083) y `asignaciones` tiene `recordatorio_vehiculo_24h_en` / `_2h_en` (consulta de solo lectura con ADC).

**Cron `vehiculo-pendiente-recordatorio` (~18:30):** `terraform apply` del PO desde un worktree de `origin/main`; plan guardado `1 to add, 0 to change, 0 to destroy` sobre `google_cloud_scheduler_job.vehiculo_pendiente_recordatorio`. Job `ENABLED`, `*/15 * * * *` America/Santiago, OIDC `internal-cron-invoker`. Primera corrida 21:45 UTC (18:45): `200` en 26 ms, `recordadosOficina=0`, `avisadosGenerador=0`, `fallidos=0`, sin `skipped`. Reverso: `gcloud scheduler jobs pause vehiculo-pendiente-recordatorio --location southamerica-east1`.

## Plan — corte post-merge 2026-11-15

| Frente | Estado |
|---|---|
| Huella consolidada (6 partes) | **En prod** (#956). `/app/rutas` sigue detrás del flag |
| Matching desde la carga (6 partes) | **En prod** (#958) con el cron de recordatorio activo. Modo sombra; declarar vehículo usable solo con `RUTAS_API_ACTIVADA` |
| Ruta consolidada | 1–7 en prod (API apagada). Parte 8 (migración contract): al final, con rutas estables |
| Reemisión certificados | Partes 1–5 en main/prod. Parte 6: reemitir BOO-YWKZWR — ejecuta el PO |
| Etapas 5–6 | Sin empezar (huella de flota; un solo sistema de diseño) |
| Etapas 0–2 abiertos | Anexo tipos de carga chilenos; chat destinatario–conductor |

## WIP

- Cupos agente: **0/3** abiertos propios. Drafts viejos #876, #877, #748: no tocar sin pedido.

## Pendientes del PO (orden)

1. ~~Aprobar environment `production` del release~~ — hecho (~17:45); deploy success 18:23.
2. ~~Confirmar migración `0083`~~ — confirmada (84 aplicadas).
3. ~~`terraform apply` de `infrastructure/vehiculo-pendiente.tf`~~ — aplicado por el PO (1 to add); primera corrida 200 con 0/0/0.
4. Encender `RUTAS_API_ACTIVADA` (antes: ruta con dos cargas punta a punta). **Antes** de pasar matching a `activa`.
5. Pasar matching `sombra` → `activa` con comparaciones a la vista.
6. Un viaje con camión CAN (KZXB64, LFGR63, KFKW23, PLFL57, RCPC20) → primer certificado primario.
7. Reemitir BOO-YWKZWR; decidir los 3 Teltonika sin sello.
8. Mirar Flota/Maps en prod.

## Lo que sigue del lado del agente

1. Nada bloqueante de código hasta los flags (o pedido del PO).
2. Candidatos siguientes: etapa 5 (huella de flota), etapa 6 (sistema de diseño), o rutas parte 8 solo con rutas encendidas.
3. Poner al día el plan de trabajo cuando exista de nuevo en el repo.

## Riesgos abiertos

Tras deploy de #958: recogida exige conductor (BOO-4XZH2K sin conductor no se recoge). Carrocería obligatoria en create/PATCH. CAN sin viaje real. Ruta consolidada sin prueba real. Certificados no reproducibles. ADR-091 sin contraste normativo. Los 20 vehículos de prod siguen sin carrocería: la próxima edición en la web la exigirá.
