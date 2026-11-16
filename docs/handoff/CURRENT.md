# Estado actual del proyecto — Booster AI

**Última actualización**: 2026-11-16 03:50 · **prod en `74461b85`** (release 43807662486 success, 03:41): regla de plausibilidad (#977) desplegada · matching `activa` y `RUTAS_API_ACTIVADA` **ON**, conservados. Horas en America/Santiago.
**Anterior**: matching en `activa` (#982); PDF y #977 (#979); #975 ruta dos cargas. Contrato: `CLAUDE.md`. Frentes: `docs/frentes-vivos.md`.

## Estado de prod vs main

| | Commit | Notas |
|---|---|---|
| `main` | `74461b85` | #982 handoff; #980 matching `activa` por defecto; #979 y #978 handoff; #977 distancia medida plausible (`1aaa3c07`); #976 handoff/oneshot matching; #975 ruta dos cargas; #971 rutas cableadas |
| Prod (Cloud Run) | `74461b85` | Release [43807662486](https://github.com/boosterchile/booster-ai/actions/runs/43807662486) **success** (03:41). Api revisión `booster-ai-api-00479-wl2` (rutas ON; matching `activa`). Anterior: `27f33609` |

**Flags en prod:** `RUTAS_API_ACTIVADA=true` y `MATCHING_ELEGIBILIDAD_MODO=activa` (revisión `booster-ai-api-00479-wl2`, 100 %; el release conserva las variables). Staging gemelo aún no existe — checklist: `docs/handoff/2026-11-16-staging-checklist-adr083.md`.

**Flip del matching a `activa` (01:14–01:16):** pedido por el PO. Plan desde worktree de `origin/main` (`5cccedce`) acotado a `module.service_api`, con la variable `matching_elegibilidad_modo` en `activa`: `0 to add, 1 to change, 0 to destroy`, solo `MATCHING_ELEGIBILIDAD_MODO "sombra" -> "activa"`; `check-validated-secret-placeholders` OK. Lo aplicó el PO. Después: `/health` y `/ready` 200, `rutas_api_activada: true`, `GET /rutas` sin auth 401, 0 errores del api. Con #980 el default de `matching_elegibilidad_modo` es `activa`; plan completo con ese default: `No changes`. **Sin observar:** ningún matching real corrió aún en `activa`. Evidencia previa en sombra: 2 comparaciones (las cargas de prueba, carga seca), ambas coincidentes. Reverso: default `sombra` (o `-var`) y apply.

**Antes del flip (00:32):** el handoff registraba el visto del PO y un apply que no había aterrizado; prod seguía en `sombra` en la revisión `00477-6tg`.

**Apply del flip de rutas (22:31–22:32):** plan `-target=module.service_api` solo agregó `RUTAS_API_ACTIVADA="true"`. Lo aplicó el PO. Smoke + `/app/rutas` con sesión transportista OK. Reverso: `docs/handoff/2026-11-16-rutas-api-activada-oneshot.md`.

**Plan completo tras el flip (22:57):** `terraform plan` sin `-target` desde `origin/main`: `No changes.` Nada aplicado.

**Prueba de una ruta con dos cargas (23:19–23:32):** generador Prueba Generador SpA, transportista Transportes Van Oosterwyk, camión KXSV65. Cargas `BOO-VZYIN2` / `BOO-4FF3XA` → ruta consolidada `cerrada`, huella repartida, 2 certificados v1. Observaciones: GPS escritorio ~0,03 km; huella 100 % hasta reordenar; hoja conductor sin refresh; 404 instrucciones-retiro; ofertas $0. Datos de prueba quedan en prod (PO).

**PDF de la ruta de prueba y regla de plausibilidad (00:05–00:23):** los dos PDF (hash igual al de la base, firma `valid: true`) imprimen 0,02 y 0,01 kg CO₂e; la estimación era 20,864 y 8,127. Sección «Carga consolidada», reparto y sello «Estimado» correctos. Causa: la cobertura mide continuidad y un equipo quieto da 100 % con 0,03 km de deriva. En prod hay además dos certificados Teltonika con el mismo patrón: BOO-BKAXIK (2,51 km de 500) y BOO-KY7G69 (195,95 de 471,60). Decisión del PO («A con 50 %»): la distancia solo cuenta como medida si alcanza el 50 % de la estimada del viaje o de la ruta; si no, cae a la estimación con `distancia_no_plausible`. Spec `.specs/distancia-medida-plausible/`, PR #977, **en prod desde el 2026-11-16 03:41**. Fuera de alcance: reemitir, el backfill manual de distancia y el texto de la pantalla del conductor.

**Release 43807662486 (02:02–03:41):** lo disparó y aprobó el PO; un segundo run duplicado (43809899052) se canceló sin iniciar jobs. De `27f33609` a `74461b85`: el único cambio de código en ejecución es #977 (api); sin migraciones (84). Verificado 03:42: los 8 servicios en `74461b85` con el 100 % en su revisión más nueva; canary del api 1 % → 100 %; `/health`, `/ready` y web 200; `GET /rutas` sin auth 401; 0 errores del api. `sms-fallback-gateway` registra un error al arrancar por configuración de Twilio faltante; aparece en cada revisión desde al menos el 2026-11-10, no es de este release. **Sin observar:** ningún cierre de viaje o ruta desde el deploy, así que la regla de #977 no ha actuado aún sobre un caso real.

## Plan post-deploy 2026-11-15 — **cerrado**

| Frente | Estado |
|---|---|
| Huella consolidada (6 partes) | **En prod** (#956). `/app/rutas` visible |
| Matching desde la carga (6 partes) | **En prod** (#958) + cron + IAM; modo **activa** desde el 2026-11-16 01:15 |
| Ruta consolidada | 1–7 en prod, **API encendida**. Parte 8 (migración contract): al final |
| Reemisión certificados | Partes 1–5 en main/prod. Parte 6: reemitir BOO-YWKZWR — PO |
| Etapas 5–6 | Sin empezar |
| Etapas 0–2 abiertos | ADR-092 (#967 DRAFT); chat destinatario–conductor (#968 DRAFT) |

**Rutas ON y matching `activa`.** Con la flota sin carrocería declarada, la regla por carga solo ofrece cargas `carga_seca` y `otra`.

## WIP

- Cupos agente: este PR handoff (release con #977). Drafts #876, #877, #748: no tocar sin pedido.

## Pendientes del PO (orden)

1. ~~Aprobar environment `production` del release~~ — hecho.
2. ~~Confirmar migración `0083`~~ — confirmada.
3. ~~`terraform apply` del cron y del IAM de `cursor-agent`~~ — aplicados.
4. ~~Visto y apply de `RUTAS_API_ACTIVADA`~~ — aplicado 22:32; ruta dos cargas OK. PDF revisados (ver arriba). **Falta:** decidir la reemisión de los 4 certificados con cifras bajas; mirar la vista del generador.
5. ~~Visto y apply de matching `sombra` → `activa`~~ — aplicado 01:15; default en Terraform (#980). **Falta:** mirar el primer matching real y que los transportistas declaren carrocería.
6. Un viaje con camión CAN → primer certificado primario.
7. Reemitir BOO-YWKZWR; decidir los 3 Teltonika sin sello.
8. Mirar Flota/Maps en prod.
9. (Opcional, ADR-083) Staging gemelo — checklist en seco en `main`.

## Lo que sigue del lado del agente

1. Con la primera carga nueva: revisar el log `matching: elegibilidad por carga` (modo `activa`) y las ofertas que generó.
2. Registrar aquí el resultado del primer matching real en `activa`.
3. `cursor-agent` **no** puede mutar Cloud Run env — sin interim `gcloud run services update` desde aquí.
4. Con el primer cierre real tras el release: confirmar que la decisión queda en versión 3 y que un cierre no plausible cae a la estimación. Las demás observaciones de la prueba de ruta, si el PO lo pide.
5. Staging: el agente no crea proyecto ni aplica Terraform.
6. Candidatos post-`activa`: etapa 5–6, rutas parte 8.

## Riesgos abiertos

Recogida exige conductor. Carrocería obligatoria. CAN sin viaje real. Matching en `activa` sin ningún matching real observado; sin carrocería declarada, las cargas que no son `carga_seca` u `otra` quedan sin candidatos. Ruta consolidada probada con un generador y camión sin telemetría. Cuatro certificados emitidos con distancia medida bajo el 50 % de la estimada (BOO-BKAXIK, BOO-KY7G69, BOO-4FF3XA, BOO-VZYIN2), sin reemitir; la regla de #977 ya está en prod pero no corrige lo emitido. El backfill manual de distancia no pasa por esa regla. Certificados no reproducibles. `cursor-agent` escribe Scheduler + tfstate pero **no** puede mutar Cloud Run env. `sms-fallback-gateway` arranca avisando configuración de Twilio faltante.
