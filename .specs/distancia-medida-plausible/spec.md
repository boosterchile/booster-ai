# Distancia medida plausible: no aceptar como «medida» una distancia que no cubre el recorrido

**Estado**: aceptada · **Fecha**: 2026-11-15 · **Decisión**: PO, 2026-11-16 («A con 50 %») · **Frente**: Slot 1 «Huella de carbono punta a punta» (T10-01 y T10-05 de `.specs/trl10/spec.md`) · **Dominio crítico (huella/GLEC)**: TDD con rojo exhibido.

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

Al confirmar la primera entrega de la ruta de prueba, la pantalla del conductor informó «sin desplazamiento» y mostró la estimación; el cierre de la ruta, minutos después, la dio por medida. No es una incoherencia entre funciones: en el primer momento las posiciones sumaban 0 km y en el cierre ya sumaban 0,03 km. La regla de «más de 0 km» es la que cambia de veredicto con unos metros de deriva.

## 2. Objetivo

Una distancia solo cuenta como medida si es plausible para el recorrido declarado. Si no lo es, el viaje o la ruta cae a la estimación, con el motivo registrado, y el certificado no imprime una cifra «real» inverosímil.

## 3. Entradas y salidas

- **Entradas**: las que ya recibe la decisión de fuente, más una distancia de referencia del recorrido (`distanciaReferenciaKm`). Para un viaje solo, `metricas_viaje.distancia_km_estimada`. Para una ruta con varios servicios, `metricas_ruta.distancia_km_estimada`. Si la referencia falta o no es mayor que 0, la distancia no cuenta como medida.
- **Salidas**:
  - `decidirFuenteHuella` devuelve `routes_estimada` cuando la distancia medida no pasa la regla, con un `motivo_fallback` nuevo: `distancia_no_plausible`.
  - `medirVentanaDelVehiculo` devuelve `abortReason = 'no_plausible'`. El cierre del viaje y el de la ruta lo tratan como cualquier ventana sin distancia reconstruida: `distancia_km_real` y `emisiones_kgco2e_reales` en `null`, `fuente_dato_ruta = maps_directions`, `cobertura_pct = 0`. El certificado usa la estimación, como en cualquier otra degradación.
  - Sin Teltonika, si al GPS del móvil solo lo descartó la plausibilidad, el motivo registrado es `distancia_no_plausible` (y no `sin_dispositivo`), porque es el que explica el cierre.
  - `DECISION_VERSION` sube a 3.
- `motivo_fallback` es `varchar` en `metricas_viaje` y en `certificados_viaje`: el motivo nuevo no necesita migración.
- No cambia ningún contrato público de la API ni las fórmulas GLEC.

## 4. Regla

**Decisión del PO (2026-11-16): opción A con X = 50 %.** La distancia medida cuenta como medida solo si es al menos el 50 % de la distancia de referencia. Sin tope superior: el PO no lo pidió y no hay ningún caso. La constante es `PLAUSIBILIDAD_MIN_PCT = 50`.

Opciones que se evaluaron:

| Opción | Regla | A favor | En contra |
|---|---|---|---|
| A | La distancia medida debe ser al menos un **X %** de la distancia de referencia | Una sola comparación; cubre los cuatro casos de §1 según el X | Un desvío real que acorte mucho el recorrido cae a la estimación |
| B | Debe haber al menos una posición a **≤ N m** del origen y otra a **≤ N m** del destino de cada servicio | Verifica que el equipo estuvo en los dos extremos | Depende de la calidad de la geocodificación; no detecta un tramo intermedio perdido |
| C | A y B juntas | La más estricta | Más casos reales caen a la estimación |

Con los datos de §1:

- Con X = 50 % caen a la estimación BOO-BKAXIK, BOO-KY7G69 y la ruta de prueba. BOO-YWKZWR sigue medida.
- Con X = 25 % caen BOO-BKAXIK y la ruta de prueba. BOO-KY7G69 sigue medida con 41,6 %.

Se eligió A con 50 % por ser la más simple de auditar y dejar fuera los tres casos que hoy subestiman la huella. BOO-KY7G69 queda en la estimación hasta entender por qué midió menos de la mitad.

Sigue abierto para el PO: si se reemiten los certificados afectados (§6).

## 5. Criterios de éxito (verificables por test)

1. `decidirFuenteHuella`: una reconstrucción `ok` con cobertura 100 % y distancia bajo el 50 % de la referencia devuelve `routes_estimada` y `motivo_fallback = distancia_no_plausible`, para `teltonika_gps` y para `movil_gps`.
2. Borde: 49,9 % cae a la estimación; 50,0 % sigue medida.
3. Una reconstrucción que hoy es medida y está sobre el umbral no cambia de fuente, nivel ni cifras (regresión).
4. Sin distancia de referencia (nula o ≤ 0) la distancia no cuenta como medida y el motivo es `distancia_no_plausible`.
5. `recalcularNivelPostEntrega`, caso de la ruta de prueba aplicado a un viaje solo: 15 posiciones dentro de 40 m, sin huecos, referencia 11,69 km. No persiste `distancia_km_real` ni `emisiones_kgco2e_reales`, y el resultado es la degradación a la estimación.
6. `cerrarHuellaDeRuta`, mismo caso con dos servicios y referencia 37,75 km: `metricas_ruta` y los dos `metricas_viaje` quedan sin cifras reales, y el reparto se calcula sobre la estimación.
7. Los cierres persisten `fuente_dato_ruta = maps_directions` y `cobertura_pct = 0` en ese caso. Con esas columnas la plantilla del certificado ya imprime la estimación y no declara «distancia medida» ni «100 % telemetría»: es el mismo camino de una ventana sin observación, cubierto por sus tests.
8. Con opt-in de huella inactivo y distancia no plausible no se guarda distancia real; solo queda la decisión de fuente.

## 6. Fuera de alcance

- Reemitir los certificados ya emitidos (BOO-BKAXIK, BOO-KY7G69, BOO-4FF3XA, BOO-VZYIN2). El mecanismo existe (`.specs/reemision-certificado/`), pero reemitir escribe en prod y lo decide y ejecuta el PO. Esta spec deja lista la regla; la reemisión va después.
- Investigar por qué BOO-KY7G69 midió 195,95 km de 471,60.
- Distinguir el equipo que envía la posición. Todas las posiciones del móvil llegan hoy con `fuente = browser`, así que ese campo no separa un teléfono de un computador.
- Los campos «Fecha del viaje» y «Salida · Llegada» vacíos y la unidad del factor en la plantilla del certificado: se vieron en la misma revisión y van aparte.
- El umbral de 25 m del hueco detenido.
- La explicación de cobertura 0 que ve el conductor (`clasificar-cobertura-cero.ts`). Para un cierre degradado por esta regla responde `medicion_no_cerrada`. Un motivo propio cambia el contrato de `GET /resultado` y el texto de la pantalla, así que lo decide el PO aparte.
- El backfill manual de distancia (`backfill-distancia-real.ts`, ruta de administración). Reconstruye por su cuenta y no pasa por esta regla; antes de volver a correrlo hay que aplicarle el mismo corte.

## 7. Plan TDD

1. Rojo: tests nuevos en `decidir-fuente-huella.test.ts` (criterios 1–4), `test/unit/calcular-metricas-viaje.test.ts` (criterios 5, 7 y 8) y `test/unit/cerrar-huella-de-ruta.test.ts` (criterios 6 y 7), corridos contra el código actual. El output del rojo va en la Evidencia del PR.
2. Verde: la regla es una función pura (`esDistanciaPlausible`), usada por `usable` y por `medirVentanaDelVehiculo`, que alimenta los dos cierres; `DECISION_VERSION = 3`; motivo nuevo en `MOTIVOS_FALLBACK`. El motivo no se imprime en el certificado ni en la web, así que no hay textos que cambiar.
3. Los tests existentes de `recalcularNivelPostEntrega` usaban una estimación de 100 km con trazas de 1,4 km. Se les baja la estimación a 2 km para que sigan probando lo suyo; no cambia ninguna de sus aserciones salvo la que comparaba contra 100.
4. Tests, lint, typecheck y build del monorepo en verde.

## 8. Evidencia

En el PR #977.
