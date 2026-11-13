# Estado actual del proyecto — Booster AI

**Última actualización**: 2026-11-13 · `main` = `25049f1b` (#955) · prod = imagen `25049f1b` en los 8 servicios de Cloud Run (release terminado ~11:53 hora de Santiago). Horas en America/Santiago salvo que se diga otra.
**Anterior**: CURRENT del 2026-10-29, archivado en [`2026-10-29-snapshot-current-2026-09.md`](2026-10-29-snapshot-current-2026-09.md) y en el propio CURRENT de esa fecha (reemplazado aquí).
**Método**: corte del informe de ejecución v3 (2026-11-13, 12:10 Santiago): `git` sobre `origin/main`, GitHub, Cloud Run solo lectura y BD de prod solo `SELECT`. Contrato: `CLAUDE.md`. Frentes: `docs/frentes-vivos.md`. **Aquí no se declara cerrado ningún slot: eso lo hace el PO.**

## Estado de prod (verificado 2026-11-13)

| Componente | Estado |
|---|---|
| api · web · document-service · matching-engine · notification-service · sms-fallback-gateway · telemetry-processor · whatsapp-bot | 100 % en imagen `25049f1b` |
| `/health` del api | 200 |
| Migraciones | 83 aplicadas, ninguna pendiente |
| Staging | Proyecto gemelo aún no existe; `release-staging.yml` se salta (deuda ADR-083) |
| Release en curso | Ninguno |

**Flags relevantes (prod):** `MATCHING_ELEGIBILIDAD_MODO=sombra`. `RUTAS_API_ACTIVADA` no definida (= falsa). Ruta consolidada y web de rutas desplegadas pero inaccesibles mientras el interruptor esté apagado.

### Datos de prod (solo lectura, ~12:05 Santiago)

- **Certificados: 8, todos v1.** Último 2026-11-03. Primarios: 0. Distancia Maps: 5 (cobertura 0 %). Teltonika: 3 (cobertura 100 %, con sello «Estimado» de la regla anterior a ADR-091).
- **Vehículos: 20.** Diez con Teltonika. **Cinco envían CAN (elemento 83):** KZXB64, LFGR63, KFKW23, PLFL57, RCPC20. Desde #955 la huella lee ese dato por telemetría; el flag manual solo avisa si deja de llegar.
- **Por qué no hay primario:** el único viaje CAN fue BOO-HC7DJX (KZXB64, 20-oct) y cayó a Maps (#836 corregido después). Ningún camión con CAN ha viajado desde entonces.
- **Rutas: 10, todas de una sola carga.** Reparto y plantilla consolidada sin ejercicio real.
- **Viajes: 17 creados; 10 a asignación; 9 entregados; 1 asignado.** Último viaje creado: 30-oct. Matching en sombra con poco o nada que comparar.

## Plan de trabajo — corte 2026-11-13

| Frente | Estado |
|---|---|
| Etapas 0–2 | En prod. Abiertos: anexo tipos de carga chilenos; chat destinatario–conductor |
| Ruta consolidada (8 partes) | 1–7 en prod; API apagada. Parte 8 (migración contract columnas viejas): al final |
| Huella consolidada (6 partes) | 1–5 en prod. Parte 6 (web): **#956** abierto, CI verde, espera visto PO |
| Matching desde la carga (6 partes) | 1–3 hechas; 4–6 (aceptar sin vehículo, recordatorios, web) sin empezar. Modo sombra activo |
| Reemisión certificados | Partes 1–5 en prod. Parte 6: reemitir BOO-YWKZWR — ejecuta el PO |
| Etapas 5–6 (huella de flota; un solo sistema de diseño) | Sin empezar |
| Fuera de plan (estos días) | Flota (#950/#954), sello por fuente (#951/#952), CAN por datos (#955): en prod |

## WIP y PRs

- **Cupos agente (máx. 3):** #956 (huella web consolidada). Libres: 2.
- **Drafts viejos (otras sesiones):** #876, #877 (certificado), #748 (retiro demo). No se tocan sin pedido.

## Pendientes del PO (orden del informe v3)

1. Un viaje con un camión que lea CAN (cualquiera de los cinco) → primer certificado primario.
2. Reemitir BOO-YWKZWR (job en seco por defecto).
3. Decidir reemisión de los 3 certificados Teltonika sin sello.
4. Encender `RUTAS_API_ACTIVADA` (antes: ruta con dos cargas punta a punta).
5. Pasar matching de `sombra` a `activa` con comparaciones a la vista.
6. Mirar el mapa de Flota en prod (el agente no tiene clave Maps).
7. Visto a #956 (cambia interfaz).

## Lo que sigue del lado del agente

1. Merge de #956 tras el visto → cierra huella consolidada.
2. Matching partes 4–6 (un release; cambian API e interfaz → visto en el PR).
3. Rutas parte 8 solo con rutas encendidas y estables (contract + lista ADR-076).
4. Etapas 5 y 6.
5. Poner al día el plan de trabajo cuando exista de nuevo en el repo (hoy no está versionado).

## Riesgos abiertos (sin cambio)

CAN sin viaje real · tres camiones CAN sin revisión manual del contador · ruta consolidada sin prueba real · mapa Flota sin verificar aquí · certificados no reproducibles (factor/perfil no versionados) · ADR-091 sin contraste normativo GLEC/ISO · GPS teléfono conserva sello Estimado · QR de retiro punta a punta sin verificar · Fase A TRL 10 sin re-auditoría desde 2026-10-29.

## ADRs recientes (huella / rutas / matching)

- ADR-088 ruta-parada-servicio · ADR-089 reparto huella · ADR-090 matching desde la carga · ADR-091 sello estimado por fuente (vigente; contraste normativo pendiente).
