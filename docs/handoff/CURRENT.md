# Estado actual del proyecto — Booster AI

**Última actualización**: 2026-11-15 23:49 · re-smoke «verifica» tras #971 (`e2af0901`+): `RUTAS_API_ACTIVADA` **sigue ON** en prod; matching **sigue `sombra`**; oneshot matching activa listo (sin apply). Horas en America/Santiago.
**Anterior**: CURRENT con la prueba de una ruta con dos cargas (#975). Contrato: `CLAUDE.md`. Frentes: `docs/frentes-vivos.md`.

## Estado de prod vs main

| | Commit | Notas |
|---|---|---|
| `main` | `bf473157` | #975 prueba ruta dos cargas; #974–#972 handoff del flip; #971 cableado `RUTAS_API_ACTIVADA`; #970 staging; #969 evidencia matching sombra; + drafts #968/#967 |
| Prod (Cloud Run) | `27f33609` | Release [43759089375](https://github.com/boosterchile/booster-ai/actions/runs/43759089375) **success** (18:23). Api en revisión `booster-ai-api-00477-6tg` (misma imagen, flag de rutas encendido) |

**Flags en prod:** `RUTAS_API_ACTIVADA=true` desde el 2026-11-15 22:32 (revisión `booster-ai-api-00477-6tg`, 100 % del tráfico). `MATCHING_ELEGIBILIDAD_MODO=sombra` (**sin cambio**). Staging gemelo aún no existe — checklist: `docs/handoff/2026-11-16-staging-checklist-adr083.md`.

**Re-smoke «verifica» (23:48–23:49 -03):** `GET /feature-flags` → `rutas_api_activada: true`; `/health` y `/ready` 200; `GET /rutas` sin auth → 401; gcloud: `RUTAS_API_ACTIVADA=true`, `MATCHING_ELEGIBILIDAD_MODO=sombra`, revisión lista `booster-ai-api-00477-6tg` (100 %). Oneshot matching (sin flip): `docs/handoff/2026-11-16-matching-elegibilidad-activa-oneshot.md`.

**Apply del flip de rutas (22:31–22:32):** plan desde worktree de `origin/main` (`e2af0901`) con `-target=module.service_api`: `0 to add, 1 to change, 0 to destroy`, solo agrega `RUTAS_API_ACTIVADA="true"`; sin drift ajeno; `check-validated-secret-placeholders` OK. Lo aplicó el PO. Smoke posterior: `/health` y `/ready` 200; `/feature-flags` → `rutas_api_activada: true`; `GET /rutas` sin auth → 401. **Con sesión de transportista (22:42, sesión del PO en Chrome, Transportes Van Oosterwyk):** `app.boosterchile.com/app/rutas` carga, el menú muestra «Rutas», lista vacía («No tienes rutas activas»); `GET /rutas` → 200 (0,4–0,5 s) desde `booster-ai-api-00477-6tg` según los registros de Cloud Run; consola sin errores. **Sin probar:** una ruta con dos cargas punta a punta (la cuenta no tiene rutas activas). Reverso: `docs/handoff/2026-11-16-rutas-api-activada-oneshot.md`.

**Plan completo tras el flip (22:57):** `terraform plan` sin `-target` desde worktree de `origin/main` (`3e3acf8f`): 427 recursos refrescados, `No changes. Your infrastructure matches the configuration.`, sin advertencias. El drift de Redis `getAuthString` ya no aparece. Nada aplicado.

**Prueba de una ruta con dos cargas (23:19–23:32, agente en Chrome con sesiones abiertas por el PO):** generador Prueba Generador SpA, transportista Transportes Van Oosterwyk, camión KXSV65 (sin dispositivo). Cargas `BOO-VZYIN2` (1.000 kg) y `BOO-4FF3XA` (1.500 kg), origen y destino en la región V, ofrecidas solo a ese transportista. Resultado: dos ofertas aceptadas → dos rutas `planificada`; juntar → una ruta con 4 paradas (la otra `cancelada`); reordenar guardado; entrega antes de su recogida rechazada (422, aviso en pantalla); camión y conductor declarados; el conductor ve las 4 paradas en orden y sin reordenar; dos recogidas → ruta `en_curso`; seguimiento público de cada carga 200 y solo con su carga; dos entregas → ruta `cerrada`, viajes `entregado`. Huella: ruta 28,991 kg CO₂e estimados, reparto 20,864 kg (71,97 %) y 8,127 kg (28,03 %), `tkm-distancia-directa-v1`, nivel `secundario_modeled`. Dos certificados v1 `vigente` con PDF. Sin errores del api.

**Observaciones de la prueba:** (1) la pantalla del conductor reportó posición desde un navegador de escritorio quieto: `metricas_ruta` quedó con 0,03 km y 0,021 kg «reales», fuente `movil_gps`; (2) al juntar, la huella mostró 100 % en cada carga y un total que no sumaba, hasta el primer reordenamiento; (3) la hoja de ruta del conductor no refresca «hechas» sin recargar; (4) 404 repetidos de `/viajes/…/instrucciones-retiro` y dos advertencias del api sin mensaje; (5) ofertas con precio $ 0 al crear la carga sin precio. **Sin verificar:** contenido de los PDF, aviso «viaja con otras cargas» en la vista del generador, seguimiento antes de la recogida, comparación de elegibilidad en sombra. Los datos de prueba se quedan en prod (decisión del PO).

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

**Rutas encendidas en prod.** Matching `activa` **no** autorizado — oneshot preparado; falta el visto explícito del PO.

## WIP

- Cupos agente: este PR de handoff (re-smoke rutas + oneshot matching). Drafts #876, #877, #748: no tocar sin pedido.

## Pendientes del PO (orden)

1. ~~Aprobar environment `production` del release~~ — hecho; deploy success 18:23.
2. ~~Confirmar migración `0083`~~ — confirmada.
3. ~~`terraform apply` del cron y del IAM de `cursor-agent`~~ — aplicados.
4. ~~Visto y apply de `RUTAS_API_ACTIVADA`~~ — aplicado 2026-11-15 22:32; smoke básico y `/app/rutas` con sesión en verde (lista vacía). Ruta con dos cargas probada punta a punta el 2026-11-15 (ver arriba). **Falta:** mirar los dos PDF y la vista del generador.
5. Pasar matching `sombra` → `activa` — **solo con visto explícito aparte**. Oneshot listo (sin apply): `docs/handoff/2026-11-16-matching-elegibilidad-activa-oneshot.md`. Evidencia sombra: `docs/handoff/2026-11-16-evidencia-matching-sombra.md` (0 comparaciones live).
6. Un viaje con camión CAN → primer certificado primario.
7. Reemitir BOO-YWKZWR; decidir los 3 Teltonika sin sello.
8. Mirar Flota/Maps en prod.
9. (Opcional, ADR-083) Staging gemelo — checklist en seco ya en `main`.

## Lo que sigue del lado del agente

1. Tras visto explícito del PO: apply del oneshot matching (`docs/handoff/2026-11-16-matching-elegibilidad-activa-oneshot.md`) por owner/Claude Code; luego smoke gcloud + health.
2. **No** flip `MATCHING_ELEGIBILIDAD_MODO=activa` sin esa confirmación. `cursor-agent` no puede mutar Cloud Run env.
3. Revisar observaciones de la prueba de ruta con dos cargas si el PO lo pide.
4. Staging: el agente no crea proyecto ni aplica Terraform.
5. Candidatos solo con visto matching: etapa 5–6, rutas parte 8.

## Riesgos abiertos

Recogida exige conductor. Carrocería obligatoria. CAN sin viaje real. Ruta consolidada probada con dos cargas de un solo generador y camión sin telemetría; sin probar con dos generadores ni con Teltonika. En esa prueba el GPS de un navegador quieto dejó 0,03 km «reales» en `metricas_ruta`. Certificados no reproducibles. `cursor-agent` escribe Scheduler + tfstate pero **no** puede mutar Cloud Run env.
