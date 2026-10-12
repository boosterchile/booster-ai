# Spec — Huella con consumo CAN medido al cierre (T10-05)

- Fecha: 2026-10-07
- Estado: Vigente
- Programa: TRL 10, fase A, criterio **T10-05 Certificado primario** (`.specs/trl10/spec.md`, ADR-082)
- Decisiones que aplica (no las reabre): ADR-077 §2 (matriz por fuente: `primario_verificable` solo con `exacto_canbus` + `teltonika_gps` + cobertura ≥ 95 %), ADR-028 §2, `.specs/capacidad-estanque-fuente-can/spec.md` (regla del IO 83).

## 1. Problema

T10-05 exige al menos un viaje real con CAN + Teltonika y cobertura ≥ 95 % que emita un certificado `primario_verificable`. Hoy eso es **imposible por código**, no por operación:

- `recalcularNivelPostEntrega` calcula la huella real solo en modo `modelado` o `por_defecto` (`emisionesSegunPerfil`). El modo `exacto_canbus` existe en `@booster-ai/carbon-calculator`, pero el api nunca lo llama.
- El nivel se deriva con el método **estimado** de `metricas_viaje`, nunca con el medido.
- El dato existe: la telemetría trae el IO 83 (combustible consumido acumulado, ×0,1 L) y `vehiculos.fuente_combustible_can = '83'` marca los camiones que lo reportan (migración 0057).

## 2. Entradas

- Cierre del viaje (`recalcularNivelPostEntrega`), con huella activa, distancia reconstruida, cobertura de posición ≥ umbral (80 %) y peso declarado. Es la rama que hoy termina en `medida`.
- Vehículo del assignment con `fuente_combustible_can = '83'`, combustible `diesel` o `gasolina` (el contador mide litros) y fuente de posición `teltonika_gps`.
- Lecturas de `telemetria_puntos` en la ventana del segmento (`recogido_en → entregado_en`) que traen el IO 83.

## 3. Salidas

1. **Función pura `consumoCanSegmento`** (`apps/api/src/domain/consumo-can-segmento.ts`). Recibe las lecturas del segmento (posición + IO) y la distancia real del segmento, y devuelve los litros consumidos o un motivo de no-uso. Reglas, en orden:
   - menos de 2 lecturas válidas del 83 → `sin_lecturas`;
   - Δ = última − primera; Δ < 0 → `contador_retrocedio` (reinicio del equipo o desborde); Δ = 0 → `contador_sin_avance`;
   - la distancia recorrida entre la primera y la última lectura cubre < 95 % de la distancia del segmento → `cobertura_insuficiente`. Es el mismo umbral que exige `primario_verificable`: el combustible tiene que cubrir lo mismo que la posición;
   - Δ < 5 L o segmento < 10 km → `muestra_insuficiente`. Son los mínimos que ya usan los trayectos (`LITROS_MINIMOS_KM_POR_LITRO`, `KM_MINIMOS_KM_POR_LITRO`), porque el 83 avanza en pasos de 0,5 L;
   - consumo fuera de [3, 100] L/100 km → `consumo_implausible`. Es una guarda contra un contador corrupto que de otro modo certificaría como primario.
   - Si pasa todo: `litros = Δ`.
2. **El cierre usa `exacto_canbus`** cuando se cumplen las condiciones de §2 y la función devuelve litros: `calcularEmisionesViaje({ metodo: 'exacto_canbus', distanciaKm, combustibleConsumido: litros, cargaKg, vehiculo })`. La distancia es la misma híbrida que se persiste.
3. **El nivel se deriva con el método final** (`exacto_canbus` si se midió, si no el estimado). Así `exacto_canbus` + `teltonika_gps` + cobertura ≥ 95 % da `primario_verificable`, y con cobertura < 95 % da `secundario_modeled` (ADR-077 §2).
4. **Degradación explícita, nunca silenciosa.** Si el vehículo está provisionado con el 83 pero la función devuelve un motivo, la huella sigue en `modelado` (como hoy), y se registran un `warn` con el motivo y el contador `huella_canbus_no_usado_total{motivo}`.
5. Sin cambios para vehículos sin el 83, sin Teltonika, con huella inactiva o en cualquier rama degradada: mismo resultado que hoy.

## 4. Fuera de alcance

- IO 84 y 89 (nivel del estanque). El Δ de un nivel incluye cargas de combustible y oleaje; no sirve como medición primaria de energía. Esos vehículos siguen en `modelado`.
- Backhaul medido. El modo `exacto_canbus` ya modela el retorno vacío si se le pasa; el cierre no lo pasa hoy y no cambia.
- Recalcular viajes ya cerrados.

## 5. Criterios de éxito

1. Rojo exhibido antes de implementar: los tests de `consumoCanSegmento` (módulo inexistente) y los del cierre con el 83 (el nivel sale `secundario_modeled` y el método `modelado`).
2. Verde: cada motivo de §3.1 con su caso; cierre con 83 válido y cobertura 100 % → `exacto_canbus` + `primario_verificable` y emisiones = litros × factor WTW; mismo caso con cobertura 90 % → `secundario_modeled`; 83 con motivo → `modelado` + `warn` + contador; vehículo sin 83 → sin cambios. La invariante «nunca 0» sigue verde.
3. tsc, lint, tests del api, coverage ≥ 80 % del código nuevo y build.

## 6. Acción del PO para cerrar T10-05 en prod

Tras el merge y el release: un viaje real con un camión que tenga Teltonika y CAN, provisionado con `fuente_combustible_can = '83'`, con huella activa, peso declarado y cobertura ≥ 95 %. Verificación: `nivel_certificacion = 'primario_verificable'` en `metricas_viaje` y certificado emitido.
