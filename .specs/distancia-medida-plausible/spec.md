# Distancia medida plausible: no aceptar como «medida» una distancia que no cubre el recorrido

**Estado**: borrador, espera la decisión del PO sobre §4 · **Fecha**: 2026-11-15 · **Frente**: Slot 1 «Huella de carbono punta a punta» (T10-01 y T10-05 de `.specs/trl10/spec.md`) · **Dominio crítico (huella/GLEC)**: TDD con rojo exhibido.

Enmienda el corte de «distancia usable» de la decisión de fuente (HC-001, `apps/api/src/domain/decidir-fuente-huella.ts`) y los cortes de degradación del cierre del viaje y de la ruta. No cambia `.specs/hueco-detenido-deriva/spec.md`: la regla de los 25 m se mantiene.

## 1. Problema (medido en producción)

El 2026-11-15 se cerró en prod una ruta de prueba con dos cargas (`BOO-4FF3XA` y `BOO-VZYIN2`, camión sin Teltonika). La estimación de la ruta era 37,75 km y 28,991 kg CO₂e. El cierre la dio por medida con 0,03 km, y los dos certificados se emitieron y firmaron con 0,02 y 0,01 kg CO₂e.

Cadena observada:

1. Durante la ventana llegaron 15 posiciones del móvil, todas dentro de unos 40 m y con precisión media de 32 m. El equipo que las envió no se movió.
2. Ningún par de posiciones consecutivas estuvo a más de 60 s, así que no hubo huecos. La distancia observada fue la suma de los saltos del GPS: 0,03 km.
3. `resolverEscrituraDistanciaReal` (`apps/api/src/services/calcular-distancia-real.ts`) calcula la cobertura como km observados ÷ km totales reconstruidos. Sin huecos, eso da 100 %.
4. `usable` (`decidir-fuente-huella.ts`) acepta una reconstrucción con cobertura ≥ 80 % y km > 0. No compara la distancia medida con ninguna referencia del recorrido.
5. `cerrarHuellaDeRuta` y `recalcularNivelPostEntrega` aplican solo esos cortes. La huella se calculó sobre 0,03 km.

La cobertura mide la continuidad de la observación. No dice si lo observado cubre el recorrido entre el origen y el destino.

No es solo la prueba. Estado de `metricas_viaje` en prod al 2026-11-15 para los viajes con cifras reales:

| Viaje | Fuente | km estimados | km medidos | Medido ÷ estimado | Cobertura | kg estimados | kg «reales» | Certificado |
|---|---|---|---|---|---|---|---|---|
| BOO-BKAXIK | `teltonika_gps` | 500,00 | 2,51 | 0,5 % | 100 % | 33,475 | 2,691 | emitido |
| BOO-KY7G69 | `teltonika_gps` | 471,60 | 195,95 | 41,6 % | 100 % | 539,315 | 224,092 | emitido |
| BOO-YWKZWR | `teltonika_gps` | 464,85 | 504,72 | 108,6 % | 100 % | 545,764 | 590,746 | emitido |
| Ruta de prueba | `movil_gps` | 37,75 | 0,03 | 0,08 % | 100 % | 28,991 | 0,021 | emitidos (2) |

La regla afecta a las dos fuentes GPS y tanto al viaje solo como a la ruta con varios servicios.

Hay además una incoherencia entre dos funciones: al confirmar la primera entrega de la ruta de prueba, `clasificar-cobertura-cero.ts` informó «sin desplazamiento» y la pantalla mostró la estimación; el cierre de la ruta, segundos después, la dio por medida.

## 2. Objetivo

Una distancia solo cuenta como medida si es plausible para el recorrido declarado. Si no lo es, el viaje o la ruta cae a la estimación, con el motivo registrado, y el certificado no imprime una cifra «real» inverosímil.

## 3. Entradas y salidas

- **Entradas**: las que ya recibe la decisión de fuente, más una distancia de referencia del recorrido. Para un viaje solo, `distancia_km_estimada`. Para una ruta, la distancia estimada de la ruta (`metricas_ruta.distancia_km_estimada`). Según la opción de §4, también las coordenadas de origen y destino de cada servicio.
- **Salidas**:
  - `decidirFuenteHuella` devuelve `routes_estimada` cuando la distancia medida no pasa la regla, con un `motivo_fallback` nuevo: `distancia_no_plausible`.
  - El cierre del viaje y el de la ruta dejan `distancia_km_real` y `emisiones_kgco2e_reales` en `null` en ese caso. El certificado usa la estimación, como en cualquier otra degradación.
  - `DECISION_VERSION` sube a 3.
- `motivo_fallback` es `varchar` en `metricas_viaje` y en `certificados_viaje`: el motivo nuevo no necesita migración.
- No cambia ningún contrato público de la API ni las fórmulas GLEC.

## 4. Regla: opciones para la decisión del PO

| Opción | Regla | A favor | En contra |
|---|---|---|---|
| A | La distancia medida debe ser al menos un **X %** de la distancia de referencia | Una sola comparación; cubre los cuatro casos de §1 según el X | Un desvío real que acorte mucho el recorrido cae a la estimación |
| B | Debe haber al menos una posición a **≤ N m** del origen y otra a **≤ N m** del destino de cada servicio | Verifica que el equipo estuvo en los dos extremos | Depende de la calidad de la geocodificación; no detecta un tramo intermedio perdido |
| C | A y B juntas | La más estricta | Más casos reales caen a la estimación |

Con los datos de §1:

- Con X = 50 % caen a la estimación BOO-BKAXIK, BOO-KY7G69 y la ruta de prueba. BOO-YWKZWR sigue medida.
- Con X = 25 % caen BOO-BKAXIK y la ruta de prueba. BOO-KY7G69 sigue medida con 41,6 %.

Recomendación: **opción A con X = 50 %**. Es la más simple de auditar y deja fuera los tres casos que hoy subestiman la huella. BOO-KY7G69 quedaría en la estimación hasta entender por qué midió menos de la mitad.

Preguntas abiertas para el PO:

1. ¿Opción A, B o C, y con qué umbral?
2. ¿Hace falta un tope superior (medido muy por encima de lo estimado)? Hoy no hay ningún caso; BOO-YWKZWR está en 108,6 %.
3. ¿Se reemiten los certificados afectados (§6)?

## 5. Criterios de éxito (verificables por test)

Se escriben con la opción y el umbral que decida el PO. Con la recomendación (A, 50 %):

1. `decidirFuenteHuella`: una reconstrucción `ok` con cobertura 100 % y distancia bajo el 50 % de la referencia devuelve `routes_estimada` y `motivo_fallback = distancia_no_plausible`, para `teltonika_gps` y para `movil_gps`.
2. Borde: 49,9 % cae a la estimación; 50,0 % sigue medida.
3. Una reconstrucción que hoy es medida y está sobre el umbral no cambia de fuente, nivel ni cifras (regresión).
4. Sin distancia de referencia (nula o ≤ 0) la distancia no cuenta como medida y el motivo es `distancia_no_plausible`.
5. `recalcularNivelPostEntrega`, caso de la ruta de prueba aplicado a un viaje solo: 15 posiciones dentro de 40 m, sin huecos, referencia 11,69 km. No persiste `distancia_km_real` ni `emisiones_kgco2e_reales`, y el resultado es la degradación a la estimación.
6. `cerrarHuellaDeRuta`, mismo caso con dos servicios y referencia 37,75 km: `metricas_ruta` y los dos `metricas_viaje` quedan sin cifras reales, y el reparto se calcula sobre la estimación.
7. `clasificar-cobertura-cero` y el cierre dan el mismo veredicto para una misma traza sin desplazamiento.
8. El certificado de un viaje degradado por esta regla imprime la estimación y no declara «distancia medida» ni «100 % telemetría».

## 6. Fuera de alcance

- Reemitir los certificados ya emitidos (BOO-BKAXIK, BOO-KY7G69, BOO-4FF3XA, BOO-VZYIN2). El mecanismo existe (`.specs/reemision-certificado/`), pero reemitir escribe en prod y lo decide y ejecuta el PO. Esta spec deja lista la regla; la reemisión va después.
- Investigar por qué BOO-KY7G69 midió 195,95 km de 471,60.
- Distinguir el equipo que envía la posición. Todas las posiciones del móvil llegan hoy con `fuente = browser`, así que ese campo no separa un teléfono de un computador.
- Los campos «Fecha del viaje» y «Salida · Llegada» vacíos y la unidad del factor en la plantilla del certificado: se vieron en la misma revisión y van aparte.
- El umbral de 25 m del hueco detenido.

## 7. Plan TDD

1. Rojo: tests nuevos en `decidir-fuente-huella.test.ts` (criterios 1–4), `test/unit/calcular-metricas-viaje.test.ts` (criterio 5), el test del cierre de ruta (criterio 6) y `clasificar-cobertura-cero.test.ts` (criterio 7), corridos contra el código actual. El output del rojo va en la Evidencia del PR.
2. Verde: la regla entra en una sola función pura, usada por `usable` y por los dos cierres; `DECISION_VERSION = 3`; motivo nuevo en `MOTIVOS_FALLBACK` y en los textos del certificado y de la pantalla del conductor.
3. Tests, lint, typecheck y build del monorepo en verde.

## 8. Evidencia

Se completa en el PR de implementación.
