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
6. El job se vuelve a correr justo antes de desplegar la parte 4: entre el
   relleno y esa parte, las rutas no siguen a la asignación.
