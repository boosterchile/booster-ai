# Estado actual del proyecto — Booster AI

**Última actualización**: 2026-11-15 · `main` = `27f33609` (#958) · prod aún en imagen `25049f1b` (release del 2026-11-13; **código mergeado sin desplegar**: #956 y #958). Horas en America/Santiago.
**Anterior**: CURRENT del 2026-11-13 (#957). Contrato: `CLAUDE.md`. Frentes: `docs/frentes-vivos.md`.

## Estado de prod vs main

| | Commit | Notas |
|---|---|---|
| `main` | `27f33609` | Matching 4–6 (#958) + huella web consolidada (#956) |
| Prod (Cloud Run) | `25049f1b` | Sin release desde el 13-nov. Falta `gh workflow run release.yml --ref main` (PO) |

**Flags en prod (sin cambio):** `MATCHING_ELEGIBILIDAD_MODO=sombra`. `RUTAS_API_ACTIVADA` no definida (= falsa). Staging gemelo aún no existe.

## Plan — corte post-merge 2026-11-15

| Frente | Estado |
|---|---|
| Huella consolidada (6 partes) | **Cerrada en main** (#956). Visible en prod tras release; `/app/rutas` sigue detrás del flag |
| Matching desde la carga (6 partes) | **Cerrada en main** (#958). Modo sombra; declarar vehículo usable en prod solo con `RUTAS_API_ACTIVADA` |
| Ruta consolidada | 1–7 en prod (API apagada). Parte 8 (migración contract): al final, con rutas estables |
| Reemisión certificados | Partes 1–5 en main/prod. Parte 6: reemitir BOO-YWKZWR — ejecuta el PO |
| Etapas 5–6 | Sin empezar (huella de flota; un solo sistema de diseño) |
| Etapas 0–2 abiertos | Anexo tipos de carga chilenos; chat destinatario–conductor |

## WIP

- Cupos agente: **0/3** abiertos propios. Drafts viejos #876, #877, #748: no tocar sin pedido.

## Pendientes del PO (orden)

1. **Release a prod** de `main` (`27f33609`) → gate humano → canary.
2. Tras el release: comprobar que migración `0083` quedó aplicada.
3. `terraform apply` de `infrastructure/vehiculo-pendiente.tf` (solo el job Scheduler; plan debe ser `1 to add, 0 to change, 0 to destroy`). Checklist en el comentario de revisión de #958.
4. Encender `RUTAS_API_ACTIVADA` (antes: ruta con dos cargas punta a punta). **Antes** de pasar matching a `activa`.
5. Pasar matching `sombra` → `activa` con comparaciones a la vista.
6. Un viaje con camión CAN (KZXB64, LFGR63, KFKW23, PLFL57, RCPC20) → primer certificado primario.
7. Reemitir BOO-YWKZWR; decidir los 3 Teltonika sin sello.
8. Mirar Flota/Maps en prod.

## Lo que sigue del lado del agente

1. Nada bloqueante de código hasta el release/flags (o pedido del PO).
2. Candidatos siguientes: etapa 5 (huella de flota), etapa 6 (sistema de diseño), o rutas parte 8 solo con rutas encendidas.
3. Poner al día el plan de trabajo cuando exista de nuevo en el repo.

## Riesgos abiertos

Tras deploy de #958: recogida exige conductor (BOO-4XZH2K sin conductor no se recoge). Carrocería obligatoria en create/PATCH. CAN sin viaje real. Ruta consolidada sin prueba real. Certificados no reproducibles. ADR-091 sin contraste normativo.
