# Scorecard GPS de medio plazo

**Estado**: aceptada para este frente de medición · **Fecha**: 2026-09-21
**Slot**: 3 «Conductor operativo». No abre frente nuevo y no descongela flota.
Mide si el teléfono, con la nav in-app (#701) y el Wake Lock ya en el reporter,
alcanza para no abrir app nativa, y si la flota con Teltonika alcanza para
plantear Teltonika-first. Ninguna de las dos decisiones sale de este código.

## Fuera de alcance

- App nativa / Capacitor, instalar Teltonika, descongelar flota.
- Cambiar `metricas_viaje.cobertura_pct`, `CONTINUITY_GAP_S` (60 s, ADR-028) ni
  el motivo de cobertura 0 de `#702` (`clasificar-cobertura-cero`).
- Endpoint HTTP, cron, migración, índice nuevo, columna de edad de captura.
- Un booleano de «ventaja clara» Teltonika. Eso lo lee una persona.

## Qué no es este número

`cobertura_pct` del cierre es km con huecos &lt; 60 s sobre la distancia estimada,
de **una** fuente (ADR-077: con Teltonika no entra el teléfono). Este scorecard
es otro producto: % del **tiempo** activo con un fix usable en ventanas de 2 min.
Un viaje con un fix cada 3 min puede dar ~80 % acá y 0 % en el certificado. Los
dos números conviven.

## Ventana de tiempo activo

No hay columna «abrió la navegación». El arranque de ruta es
`asignaciones.recogido_en` (ahí parte el reporter). El fin es el primer instante
entre `entregado_en` y `cancelado_en`.

Queda fuera del denominador de (1) y (2):

- sin recogida (canceló antes de salir);
- todavía abierto;
- fin ≤ recogida.

Cohorte de producción: `empresas.es_demo = false` y `es_usuario_prueba = false`.

El teléfono solo es medible mientras las filas siguen en
`posiciones_movil_conductor`. El cron conserva 30 días
(`RETENCION_POSICIONES_MOVIL_DIAS`). El batch no lee recogidas más viejas: el
último punto que el cron preserva no reconstruye el tramo.

## KPI 1 — Cobertura usable (teléfono)

**Definición.** % del tiempo activo con ≥1 posición usable en ventanas de 2 min
alineadas a `recogido_en`. La última ventana puede ser más corta y pesa su
duración real, no un 2 min entero. Extremos: `[inicio, fin)` salvo la última,
que incluye `fin`.

**Posición usable.**

| Condición | Umbral |
|---|---|
| `precision_m` | &gt; 0 y ≤ 50. Null, 0 o no finito = precisión desconocida (el cliente ya manda null cuando el browser reporta 0). |
| edad | ≤ 90 s. Una edad negativa (reloj del device adelantado) cuenta como fresca. |
| coordenada | lat/lng distintos de 0 (`esCoordenadaGpsValida`, #622). |

**Edad que hay hoy.** No existe columna de edad de captura. El batch usa

```text
edad_ms = timestamp_recibido_en - timestamp_device
```

y etiqueta el resultado `fuenteEdad = desfase_recepcion_ms`. La cola offline
puede subir un fix bueno más de 90 s después: ese fix **no** cuenta. El proxy
**subestima** la cobertura. `decidirScorecardGps` lo repite en `sesgoEdad`.
Persistir la edad de captura es cambio de schema: no entra en este frente.

**Agregado.** Un número por viaje. Sobre la muestra: mediana (par = promedio de
los dos centrales) y p10 nearest-rank (`ceil(0.10 * n)`, 1-based).

**Compuerta teléfono OK.** Mediana ≥ 85 **y** n ≥ 30 viajes de prod medibles.
Con n &lt; 30 la compuerta es `muestra_insuficiente`, no un fallo.

## KPI 2 — Gaps largos

Sobre las posiciones **usables** del mismo tramo, ordenadas. Un gap es cada
tramo entre marcas consecutivas, incluyendo recogida → primer fix y último fix
→ fin. Un punto no usable no rellena el hueco. Sin ningún usable, el viaje
entero es un gap.

| Umbral | Uso |
|---|---|
| &gt; 5 min | El viaje entra al porcentaje. Exactamente 5 min no cuenta. |
| &gt; 15 min | Conteo de intervalos (P0 de operaciones). Un intervalo &gt; 15 también cuenta como &gt; 5. |

**Compuerta teléfono OK.** % de viajes con ≥1 gap &gt; 5 min **estrictamente** &lt; 15.
15.0 no pasa. El conteo &gt; 15 min se reporta aparte y no es la compuerta.

## KPI 3 — % flota Teltonika

**Denominador.** Vehículos distintos con ≥1 asignación cuyo `recogido_en` cae
en los 30 días previos a la corrida (el viaje puede seguir abierto). Misma
exclusión demo / usuario de prueba. Una asignación que nunca salió no es viaje.

**Numerador.** De esos, los que tienen `vehiculos.teltonika_imei` propio (no
blanco) **y** ≥1 fila en `telemetria_puntos` con `timestamp_device` en los 7
días previos.

No hay tabla de heartbeat. El latido medible es esa fila, con o sin fix GPS
(liveness, no calidad de posición). `teltonika_imei_espejo` no es un device
asociado: es un read-mirror de demo.

Si un vehículo con IMEI no tiene consulta de telemetría, `heartbeats7d` queda
null, el % sale null y la compuerta es `medicion_incompleta`. No se rellena con 0.

**Compuerta Teltonika-as-primary viable.** % ≥ 40. Con denominador 0:
`sin_flota`.

```sql
-- Flota 30d, empresas reales. El latido es el EXISTS, no una tabla aparte.
WITH flota AS (
  SELECT DISTINCT a.vehiculo_id
  FROM asignaciones a
  JOIN empresas e ON e.id = a.empresa_id
  WHERE a.recogido_en >= now() - interval '30 days'
    AND e.es_demo = false
    AND e.es_usuario_prueba = false
)
SELECT
  count(*) AS vehiculos,
  count(*) FILTER (
    WHERE v.teltonika_imei IS NOT NULL
      AND btrim(v.teltonika_imei) <> ''
      AND EXISTS (
        SELECT 1 FROM telemetria_puntos t
        WHERE t.vehiculo_id = v.id
          AND t.timestamp_device >= now() - interval '7 days'
      )
  ) AS con_device_y_latido
FROM flota f
JOIN vehiculos v ON v.id = f.vehiculo_id;
```

## KPI 4 — Dual en el mismo viaje

Solo si en el tramo hay ≥1 punto de teléfono con coordenada válida **y** ≥1
punto Teltonika con coordenada válida. Si falta uno: `sin_par`. No se inventa
el stream que no está.

Misma partición de 2 min.

| Lado | Cuenta la ventana si… |
|---|---|
| Teléfono | ≥1 posición usable (precisión ≤ 50 m y edad ≤ 90 s). Es el mismo % del KPI 1. |
| Teltonika | ≥1 punto con coordenada válida y edad ≤ 90 s. No hay `precision_m` en `telemetria_puntos`; el gate de 50 m no se le aplica. |

Se reporta la mediana de cada % y la mediana del delta (Teltonika − teléfono)
entre los viajes comparados. `ventajaClara` queda `lectura_humana`.

El dual usa el IMEI propio. Un vehículo solo-espejo no se compara: mezclaría
el GPS de otro camión con el teléfono de este.

## Reglas de decisión (solo lectura)

`decidirScorecardGps` devuelve `cambiaStack: false` siempre. No engancha el
cierre del viaje ni un feature flag.

**Nativo** se *considera* solo si las tres cosas son ciertas:

1. La nav in-app (#701) y el Wake Lock del reporter ya están estables en los
   viajes de la muestra. El batch no lo infiere: el caller pasa
   `precondicionNavWakeLockEstable`. El default es false → `no_evaluar_nativo`.
2. Hay ≥ 30 viajes medibles (si no, `muestra_insuficiente`, aunque el KPI 2
   falle en una muestra chica).
3. Falla la compuerta 1 **o** la compuerta 2.

Si (1) y (2) se cumplen y ambas compuertas pasan: `telefono_suficiente`.

**Teltonika-first** solo si el KPI 3 pasa **y** una persona ve ventaja clara
en el KPI 4. El código, cuando el 3 pasa, dice
`umbral_flota_alcanzado_lectura_humana`. No hay atajo si el 4 viene vacío.

Antes de leer un `considerar_nativo`: el sesgo de la edad por recepción puede
estar castigando la cola, no el GPS.

## Dónde vive

| Pieza | Rol |
|---|---|
| `apps/api/src/services/gps-scorecard-medio-plazo.ts` | Fórmulas, compuertas, decisión, emisión OTel. |
| `apps/api/src/services/cargar-gps-scorecard.ts` | Batch. Lee asignaciones, posiciones y `telemetria_puntos`. No lo llama ningún request. |

Métricas (meter `booster-ai-api/business`), sin `viaje_id` ni empresa:

| Nombre | Tipo | Qué observa |
|---|---|---|
| `gps_scorecard_cobertura_usable_pct` | Histogram | Un valor 0–100 por viaje. |
| `gps_scorecard_viajes_con_gap_total` | Counter | +1 por viaje, label `umbral=5min\|15min`. |
| `gps_scorecard_gaps_detectados_total` | Counter | Cantidad de intervalos, mismo label. |
| `gps_scorecard_flota_teltonika_pct` | Histogram | Un valor por corrida, solo si el % se pudo calcular. |
| `gps_scorecard_dual_delta_pct` | Histogram | Un delta por viaje comparado. |

`posiciones_movil_conductor` no tiene índice por `asignacion_id` (decisión de
la migración 0025). El batch filtra por `vehiculo_id` + `timestamp_device`
(`idx_posmovil_vehiculo_ts`) y descarta en memoria la asignación que no
corresponde. No se agrega índice en este frente.
