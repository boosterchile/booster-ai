# Verificación: ruta-parada-servicio

## Parte 3 — relleno (2026-11-11)

### Corrida en seco sobre una copia de producción

Producción todavía no tiene la migración 0078 (se aplica con el próximo
release), así que el job no puede correr allá, ni siquiera en seco. La corrida
se hizo sobre una copia local:

- Las 10 asignaciones de producción se leyeron en solo lectura el 2026-11-11
  (`scripts/db/agent-query.sh`): identificadores, estado, precio y fechas.
- Se cargaron en un PostgreSQL 17 local con las migraciones 0000 a 0078
  aplicadas. Empresas, vehículos, usuarios, viajes y ofertas son filas
  sintéticas con los mismos identificadores; el relleno no lee nada de ellas.

Conteos antes:

```
 asignaciones | rutas | paradas | eventos | sin_ruta | distintas
           10 |     0 |       0 |       0 |       10 |         0
```

1. En seco (`DRY_RUN` sin definir):

```
{"msg": "rellenar-rutas destino", "destino": "127.0.0.1:5499/test_copia_prod", "dryRun": true}
{"msg": "rellenar-rutas resultado", "dryRun": true, "revisadas": 10, "creadas": 10, "conciliadas": 0, "sinCambios": 0, "omitidas": 0}
 asignaciones | rutas | paradas | eventos | sin_ruta | distintas
           10 |     0 |       0 |       0 |       10 |         0
```

2. Escribiendo (`DRY_RUN=false` con `CONFIRMAR_DESTINO`):

```
{"msg": "rellenar-rutas resultado", "dryRun": false, "revisadas": 10, "creadas": 10, "conciliadas": 0, "sinCambios": 0, "omitidas": 0}
 asignaciones | rutas | paradas | eventos | sin_ruta | distintas
           10 |    10 |      20 |      10 |        0 |         0

 asignacion |    ruta     | n | con_conductor | fechas_iguales | paradas_resueltas
 entregado  | cerrada     | 9 |             8 |              9 |                18
 asignado   | planificada | 1 |             0 |              1 |                 0
```

3. Segunda corrida:

```
{"msg": "rellenar-rutas resultado", "dryRun": false, "revisadas": 10, "creadas": 0, "conciliadas": 0, "sinCambios": 10, "omitidas": 0}
 asignaciones | rutas | paradas | eventos | sin_ruta | distintas
           10 |    10 |      20 |      10 |        0 |         0
```

Criterio 3 de la spec (§10): tantas rutas como asignaciones, cero asignaciones
sin ruta, y vehículo, conductor y arrastre iguales a los de la asignación en
todas. Se cumple en la copia.

`distintas` cuenta las asignaciones cuya ruta difiere de ella en empresa,
vehículo, arrastre o conductor.

### Lo que esta corrida no cubre

- No es producción. Antes de escribir allá, el PO corre el job en seco contra
  producción, después del release que aplica la 0078, y compara con estos
  conteos más las asignaciones nuevas desde el 2026-11-11.
- Ninguna asignación de producción está `recogido` ni `cancelado`. Esos casos
  y la conciliación de rutas ya creadas se prueban solo con los tests de
  integración.

### Lista de verificación para producción

1. Release con la migración 0078 desplegado y los servicios sirviendo ese commit.
2. Job en seco contra producción: `omitidas` en 0 y `creadas` igual al número
   de asignaciones sin ruta.
3. Si hay omitidas, se revisan una a una antes de escribir; el job no las toca.
4. Job con `DRY_RUN=false` y el destino confirmado.
5. Segunda corrida en seco: 0 creadas, 0 conciliadas.
6. Si el relleno se corre antes de desplegar la parte 4a, se repite después de
   desplegarla: hasta entonces las rutas no siguen a la asignación.

## Parte 4a — la ruta sigue a la asignación (2026-11-11)

Asignar conductor (y cambiar el camión), confirmar la recogida, confirmar la
entrega y cancelar la carga dejan la ruta igual a la asignación en la misma
transacción (`services/sincronizar-ruta-de-asignacion.ts`). El relleno usa la
misma regla.

- Una asignación sin ruta la recibe con su primera escritura, así que el orden
  entre el relleno y este despliegue no rompe nada.
- La sincronización no rechaza la operación del usuario. Si no puede decidir el
  estado (hoy, una recogida confirmada por la oficina sin conductor asignado),
  iguala vehículo, arrastre y conductor, deja el estado de la ruta como estaba y
  lo registra en el log; el job de relleno lo informa como omitida. Al asignar
  el conductor, la ruta pasa a `en_curso`.
- Los lectores no cambian en esta parte: vehículo, conductor y arrastre se
  siguen leyendo de la asignación. Eso es la parte 4b.

Evidencia en el PR: rojo 6 de 7 en
`test/integration/ruta-sigue-asignacion.integration.test.ts` antes de
implementar; verde después.

## Parte 4b — los lectores leen de la ruta (2026-11-11)

Los 25 archivos de `apps/api/src` que leían vehículo, arrastre o conductor de
`asignaciones` usan ahora `db/configuracion-de-asignacion.ts`: tres expresiones
que leen la ruta de la asignación y dos filtros (por conductor y por vehículo).

- Una asignación sin ruta entrega sus propias columnas. El despliegue no
  depende de que el relleno ya se haya corrido.
- Las columnas de `asignaciones` se siguen escribiendo y quedan iguales a la
  ruta (parte 4a). Se retiran en la parte 8.
- `test/unit/lectores-de-ruta.test.ts` falla si un archivo vuelve a leerlas
  directo.

Criterio 4 de la spec (respuestas idénticas): los tests de rutas y de
integración que ya existían pasan sin tocarlos, y
`test/integration/configuracion-de-asignacion.integration.test.ts` prueba que
la expresión entrega lo mismo que la asignación cuando la ruta está al día. No
hay una comparación respuesta por respuesta contra producción.

Lo que no se midió: el plan de ejecución de los filtros con volumen real. Con
las tablas de hoy (10 asignaciones) no dice nada; los filtros están escritos
para poder usar `idx_rutas_conductor` e `idx_rutas_vehiculo`.

## Parte 5b — la ruta como fuente de verdad con varios servicios (2026-11-11)

Plan aprobado en `plan.md`. Sin cambios para las rutas de un servicio: los
tests de `ruta-sigue-asignacion` y `rellenar-rutas` siguen en verde sin
tocarse (criterio 7 de la spec).

- `services/cargar-ruta.ts`: carga la ruta y la arma como la entiende
  `route-planner` (paradas en orden, servicios, capacidad de sus unidades).
- `conciliarRutaCompartida`: en una ruta con más de un servicio, cada parada
  toma la fecha de la asignación de su servicio, en cualquier orden (D5), y el
  estado sale de `estadoQueCorresponde`. No copia el vehículo de ninguna
  asignación. El conductor solo cambia al asignar conductor, y se declara para
  toda la ruta y sus asignaciones vivas (D1).
- `asignar-conductor`: en una ruta con varios servicios no cambia el camión
  (`ruta_con_varios_servicios`); se declara en la ruta, que lo valida entero.
- Cambio de peso después del match: en una ruta con otros servicios se mide
  contra el tramo más cargado, no contra el camión vacío.

**Distinto del plan:** una carga cancelada no se saca de la ruta. Queda en
ella como servicio cancelado, que es como lo modela el paquete: no cuenta a
bordo si no se recogió, no deja la ruta pendiente y conserva la historia.

Evidencia: `test/integration/ruta-consolidada.integration.test.ts` (11 tests,
10 en rojo antes de implementar) y `test/unit/ruta-compartida.test.ts`.

## Parte 6a — la hoja de ruta en la API del conductor (2026-11-11)

Spec §4.8 y §5 («la asignación entrega además la ruta y sus paradas»).
`GET /me/assignments` agrega, sin cambiar lo que ya entregaba:

- en cada asignación, `ruta_id`;
- `rutas`: una entrada por ruta del conductor, con `id`, `estado` y sus
  `paradas` en orden. Cada parada trae `orden`, `tipo`, `resuelta_en`,
  `asignacion_id`, `cancelado`, `codigo_seguimiento`, `direccion`, `ventana`
  (solo la recogida), `contacto` (el destinatario, solo la entrega), `notas`,
  `referencia`, `tipo_carga` y `peso_kg`.

La hoja incluye las paradas ya resueltas y las de servicios entregados o
cancelados, para que el orden se entienda completo. Solo salen rutas donde el
usuario es el conductor declarado. No depende de `RUTAS_API_ACTIVADA`: con un
servicio por ruta, la hoja tiene dos paradas.

Evidencia: `test/unit/me-assignments.test.ts` (4 tests nuevos, en rojo antes)
y `test/integration/ruta-consolidada.integration.test.ts` (hoja de una ruta
con dos servicios; otro conductor de la misma empresa no la ve).

Falta la pantalla del conductor que la muestra (parte 6, interfaz).
