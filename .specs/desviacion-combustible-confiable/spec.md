# Spec — Desviación de combustible confiable

**Slug:** `desviacion-combustible-confiable`
**Pedido:** PO, 2026-11-27: «necesitamos un método confiable para nuestros clientes». Frente fuera de slot por pedido del PO (`CLAUDE.md`, ciclo de trabajo 1). Reemplaza la regla de golpe de `.specs/capacidad-estanque-fuente-can/spec.md` §Anti-robo para las fuentes `89` y `84`; la hormiga queda dentro del mismo método.
**Estado:** aceptada por el PO el 2026-11-27 (D1 a D4 abajo). Entrega 1 (este PR): algoritmo puro y prueba retrospectiva. Entrega 2: registro de cargas (D4). Entrega 3: conectarlo a Booster Fleet y al panel, y recién ahí encender el 89 en JLKT54 y JWTH77.

## Problema

La regla vigente marca «desviación de combustible» cuando el nivel baja `U = max(U_empresa, 2 % × capacidad)` en 5 min con el camión a ≤ 5 km/h. Con el IO 89 (porcentaje en puntos enteros), el 2 % de la capacidad es **siempre 2 puntos**, sea el estanque de 200 o de 760 L, y 2 puntos es lo que el sensor se mueve solo con la pendiente, al frenar o al detenerse inclinado. `U_empresa` tiene tope de 20 L (menos de 3 puntos en 760 L), así que la empresa no puede salir del ruido.

Detector actual corrido en local sobre la telemetría de prod (solo lectura), JLKT54 con fuente 89 y 760 L, 17 días con dato:

| Umbral | Avisos | De ellos, de 2 puntos (15,2 L) |
|---|---|---|
| Por omisión (15,2 L) | 28 | 24 |
| `U_empresa = 20` (tope) | 20 | — |

Entre ellos está el 28-oct 09:38, que con la boleta (100 L) y la capacidad confirmada (2 × 380 L) resultó una lectura alta después de cargar: no faltó combustible.

Hoy ningún camión en prod tiene la fuente `89` configurada, así que esto no lo ve ningún cliente todavía. Encender el 89 en JLKT54 o JWTH77 sin cambiar el método llenaría su Booster Fleet de desviaciones falsas.

## Lo que muestran los datos (30 días, 6 camiones con CAN, prod en solo lectura)

1. **Comparar en el mismo lugar cancela la inclinación.** El nivel asentado al inicio y al final de una misma detención (mediana de 3 min, mismo punto) varía con mediana 0 y desvío absoluto mediano de 0 a 1 punto en los seis camiones.
2. **El ruido depende del camión.** Bajas en detención de ≥ 5 puntos que no se recuperan: KZXB64 0, LFGR63 1, PLFL57 0, JLKT54 3, JWTH77 8, KFKW23 12. Un umbral único para todos no sirve.
3. **Después de una carga parcial el sensor marca alto y tarda horas en asentarse.** JLKT54 28-oct: 100 L, sube 50 puntos (deberían ser 13) y baja a lo real en ~1 h detenido. LFGR63 19-11 y 23-11: el nivel cae 2 puntos cada 4 a 6 min durante 3 a 4 h, andando o detenido, mientras el motor quema la cuarta parte de eso. Una carga hasta 100 % no tiene ese efecto (el sensor no pasa de 100).
4. **El contador del motor (IO 83) separa lo real del ruido.** Entre cargas, los puntos que baja el nivel y los litros que quema el motor guardan una razón pareja: KFKW23 5,6 L/punto (12 ciclos, 4,5 a 7,9), LFGR63 5,6 (5 de 7 ciclos; los otros dos empiezan dentro de las 4 h después de una carga parcial), KZXB64 5,0 (2 de 3 ciclos; el tercero da 10,7, probablemente por una carga que cayó en un hueco de datos). KFKW23 tiene 13 bajas candidatas: 3 con una carga cerca y 2 sin datos para cuadrar. De las 8 que se pudieron cuadrar, **ninguna** tiene litros faltantes: el balance de 5 h alrededor de cada una da entre −78 y +21 L.
5. **El mismo balance sirve para verificar la capacidad declarada.** LFGR63 tiene 200 L cargados y los datos dan ~560 L; KZXB64 tiene 600 y los datos dan ~500. Con una capacidad mal cargada, todos los litros de Booster Fleet salen mal.
6. **Un bidón de 10 a 20 L no se ve en el nivel.** Con 5 a 7,6 L por punto, 20 L son 3 a 4 puntos, dentro del ruido de una detención en la mitad de los camiones. Ni sumando todas las detenciones de 30 días (nivel que bajó en el mismo lugar menos lo que quemó el motor ahí) se separa una pérdida acumulada chica: el piso a 3 σ es ~140 L en KZXB64, ~270 L en LFGR63, ~360 L en JLKT54 y ~600 L en KFKW23 y JWTH77 (PLFL57, con 50 detenciones, ~50 L). La extracción chica y repetida solo se detecta comparando **litros cargados (boleta) contra litros quemados por el motor (IO 83)** en el período, que no depende del sensor de nivel. Por eso D4 pasa a ser parte del método y no una mejora.

## Método

### 1. Calibración por camión

- **Litros por punto (L/pt).** Con IO 83: mediana de `litros del motor / puntos que bajó el nivel` en los ciclos entre cargas, empezando 4 h después de cada carga parcial y con ≥ 10 puntos de baja. Con menos de 3 ciclos válidos, se usa `capacidad / 100`. Sin IO 83: `capacidad / 100`.
- **Aviso interno de capacidad.** Si L/pt × 100 difiere más de 15 % de la capacidad declarada (KZXB64 tenía 600 y sus datos dan 501: 17 %), Booster ve «revisar la capacidad» en el panel de plataforma. No se corrige sola.
- **Ruido del sensor.** Desvío absoluto mediano de la variación por detención en los últimos 30 días, en puntos.

### 2. Bajas candidatas (nivel asentado en el mismo lugar)

- Detención: ≥ 5 min a ≤ 3 km/h sin alejarse más de 150 m del primer punto, con el motor encendido o apagado. Una posición 0,0 (sin GPS) no es un lugar. Una detención de 2 a 5 min solo cuenta si es carga.
- Nivel al inicio: mediana de los 3 primeros minutos; si hay menos de 2 lecturas, las 6 anteriores. Nivel al final: mediana de los 3 últimos minutos (incluye las lecturas al dar contacto).
- Candidata si `inicio − final ≥ max(5 puntos, 4 × ruido)` y el nivel no recupera la mitad de la baja entre 10 y 30 min después de retomar la marcha.
- No se evalúa bajo 15 % de nivel ni dentro de las 4 h siguientes a una carga que no llegó a 100 %.
- Una carga se detecta por la serie de nivel (subida ≥ 8 puntos entre el nivel antes de llegar y la lectura estable más alta de la detención), no por la duración: la del 28-oct duró 3 min.

### 3. Confirmación por balance

- **Con IO 83.** Ventana de 5 h centrada en la detención: nivel asentado = media recortada (sin el 10 % de cada extremo) de 30 min, 2 h antes y 2 h después. Faltante = `(puntos que bajó) × L/pt − litros del motor`. Confirma si el faltante es `≥ max(30 L, 25 % de los litros del motor)`. Si hay una carga dentro de la ventana o una que todavía se asienta cuando la ventana abre, queda sin confirmar (solo Booster); si no hay datos, también.
- **Sin IO 83.** Se reemplaza el motor por `km recorridos × L/100 km del camión` (mediana de sus ciclos completos). La confianza es menor: ver D2.
- **Balance en detenciones (bajas chicas repetidas).** Por período: suma con signo de `(inicio − final) × L/pt − litros del motor en la detención` en las detenciones evaluables. Se marca si la suma supera `3 × σ × √n` (σ = desvío estándar por detención del mismo camión, sin las de ±8 puntos o más). Con IO 83 confirma; sin IO 83, solo Booster. El piso queda escrito en la salida para que se lea qué pérdida puede ver ese camión.

### 4. Conciliación con las cargas registradas (D4)

- **Por carga.** La subida asentada (`(nivel asentado después − nivel antes) × L/pt`) contra los litros registrados. Diferencia `≥ max(30 L, 20 %)` → «carga incompleta».
- **Por período (la que ve los bidones).** `faltante = Σ litros cargados − Σ litros del motor − (nivel final − nivel inicial) × L/pt`. La tolerancia es la del contador del motor (`tolerancia_contador`, 3 % de los litros del motor hasta medirla con las primeras boletas) más 2 puntos de nivel en cada extremo. Si el faltante supera la tolerancia, es una desviación confirmada del período, con los litros como rango.
- Sin IO 83 no hay balance por período.

## Salidas

- **Al cliente (Booster Fleet):** «Desviación de combustible por analizar» solo cuando el balance confirma. Siempre con fecha, hora, lugar y litros como rango (faltante ± tolerancia del camión), y la evidencia: nivel antes y después, litros del motor y km en la ventana. Nunca «robo».
- **A Booster (panel de plataforma):** candidatas no confirmadas, sin datos para cuadrar y avisos de capacidad, para revisarlas antes de que un cliente las vea.
- **Litros por trayecto y km/L:** no cambian; siguen saliendo de porcentaje × capacidad (o del 83).

## Criterios de éxito

1. **Prueba retrospectiva** sobre 30 días de los seis camiones con CAN (JLKT54, JWTH77, KFKW23, KZXB64, LFGR63, PLFL57), con el código real y no con el prototipo: **≤ 1 desviación mostrada al cliente por camión al mes**, y cada una con su evidencia revisada a mano. Hoy, con la regla vigente: 28 en 17 días en JLKT54.
2. **El 28-oct 09:38 de JLKT54 no aparece** como desviación al cliente.
3. **Prueba controlada (la que prueba que detecta):** en un camión con IO 83, se extraen ≥ 40 L conocidos con el camión detenido. Booster Fleet la muestra con fecha, hora y lugar correctos y los litros dentro de ±25 %. La coordina operación con el transportista.
4. **Capacidad:** con las capacidades ya corregidas, ningún camión con ciclos suficientes queda fuera de ±15 %; con las antiguas (LFGR63 200, KZXB64 600) el algoritmo las marca.
6. **Piso de detección:** la salida dice, por camión y período, desde cuántos litros acumulados puede ver una pérdida; la prueba retrospectiva lo publica para los seis.
5. Tests unitarios por regla (rojo exhibido antes de implementar), sobre series armadas a partir de los casos de arriba.

## Prueba retrospectiva (entrega 1, 2026-11-27)

Código real de `packages/fuel-deviation` sobre 30 días de prod (solo lectura, exportados al scratchpad de la sesión), con las capacidades ya corregidas:

| Camión | Calibración | Cargas | Candidatas | Al cliente | Solo Booster | Descartadas por balance | Balance en detenciones (30 d) |
|---|---|---|---|---|---|---|---|
| JLKT54 | declarada, 7,6 L/pt (sin 83) | 12 | 0 | 0 | 0 | 0 | −198 L, piso 322 L |
| JWTH77 | ninguna (sin 83 ni capacidad) | 46 | 4 | 0 | 4 | 0 | sin litros |
| KFKW23 | del camión, 5,28 L/pt, 13 ciclos | 22 | 9 | 0 | 3 | 6 | +140 L, piso 465 L |
| KZXB64 | del camión, 5,01 L/pt, 3 ciclos | 12 | 0 | 0 | 0 | 0 | −54 L, piso 136 L |
| LFGR63 | del camión, 5,72 L/pt, 5 ciclos | 11 | 1 | 0 | 1 | 0 | −117 L, piso 246 L |
| PLFL57 | ninguna (un ciclo, sin capacidad) | 1 | 0 | 0 | 0 | 0 | sin litros |

- Criterio 1: **0 desviaciones al cliente** en los seis (regla vigente: 28 en 17 días en JLKT54). Criterio 2: el 28-oct 09:38 no aparece ni como candidata.
- Criterio 4: con las capacidades antiguas el algoritmo marca LFGR63 (200 L) y KZXB64 (600 L); con las corregidas, ninguno.
- KFKW23 tiene bajas de 15 a 17 puntos en una detención (80 a 90 L según el nivel) en las que el motor explica todo: el balance da entre −17 y +13 L. Es el caso que la regla vigente mostraría como desviación.
- JWTH77 marca 46 «cargas» en 30 días (los demás, 11 a 22): su nivel sube ≥ 8 puntos en detenciones sin carga. Hay que revisar ese sensor antes de encenderle el 89.
- Lo que esta prueba **no** prueba: que detecta. Para eso está la prueba controlada (criterio 3), pendiente por decisión del PO.

## Decisiones del PO (2026-11-27)

- **D1. Qué ve el cliente:** solo desviaciones confirmadas; las candidatas, solo Booster. Aprobada.
- **D2. Camiones solo con IO 89 (JLKT54, JWTH77):** litros por trayecto y km/L sí; desviaciones solo para Booster hasta que pasen las dos pruebas. Aprobada.
- **D3. Tolerancias.** El PO: la extracción indebida es de a poco, bidones de 10 o 20 L que se van sumando. Queda así: la baja única se mantiene para el evento grande (≥ `max(5 puntos, 4 × ruido)` y faltante ≥ `max(30 L, 25 %)`); la extracción chica se busca por acumulado, con el balance en detenciones (§3) y sobre todo con el balance de cargas contra motor por período (§4), que es el único que llega a 10 o 20 L. Lo que cada camión puede ver queda escrito como piso en la salida.
- **D4. Registro de cargas de combustible:** un lugar donde se cargan fecha y litros (y lugar si se tiene), para ir mejorando la precisión. Aprobada; es la entrega 2.
- **Capacidad y fuente:** el PO pide corregirlas directamente y que el cálculo use los datos del camión. L/pt sale del propio camión (§1) y la capacidad declarada solo se usa si no hay ciclos suficientes.

## Configuración de prod (2026-11-27)

Camiones que mandan combustible por CAN y están en `sin_sensor`: JLKT54 (89, 760 L), JWTH77 (89, sin capacidad), KFKW23 (83 y 89, sin capacidad), PLFL57 (83 y 89 en ~37 % de los puntos, sin capacidad). KWYB30 manda RPM y velocidad por CAN, pero no combustible ni odómetro (revisar la configuración del equipo). RCPC20, KZBB26 y VFZH-68 solo mandan posición. Corregido el 2026-11-27 por pedido del PO (SQL en transacción, corrido en seco y aplicado; no hay pantalla de Booster para editar un vehículo de cliente): KFKW23 → fuente 83 y 560 L; PLFL57 → fuente 83 (un solo ciclo, sin capacidad medible); LFGR63 200 → 560 L; KZXB64 600 → 500 L. JLKT54 y JWTH77 siguen en `sin_sensor` a propósito: con el 89 la regla vigente les mostraría desviaciones falsas al cliente; se encienden en la entrega 3.

## Fuera de alcance

Alertas por push, correo o WhatsApp; autodetección de la fuente; cambios en litros por trayecto y km/L; la configuración de los equipos Teltonika; una pantalla de Booster para editar fuente y capacidad de un vehículo de cliente (hoy no existe; se propone aparte).
