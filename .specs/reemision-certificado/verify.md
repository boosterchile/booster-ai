# Verificación: reemision-certificado

## Parte 1 — toda emisión queda versionada (2026-11-11)

`emitirCertificadoViaje` registra la versión 1 en `certificados_viaje` dentro
de la misma transacción que marca el certificado como emitido, y deja
`metricas_viaje.certificado_vigente_id` apuntando a ella
(`registrarPrimeraVersion` en `services/certificados-versionados.ts`).

- Nada visible cambia: las cuatro columnas `certificado_*` de `metricas_viaje`
  se escriben igual que antes.
- El relleno de certificados (`jobs/backfill-certificados.ts`) pasa por la
  misma función, así que también versiona.
- Si el viaje ya tuviera una versión, las restricciones de la tabla rechazan
  la segunda y la emisión no se registra. No ocurre en el flujo normal: un
  certificado ya emitido se omite antes (`already_issued`).

### Criterio 1 de la spec

`test/integration/certificado-version-1.integration.test.ts`: la emisión deja
una fila `vigente`, versión 1; con ella registrada `crearVersion` crea la
versión 2 y espeja las métricas; un viaje no puede tener dos versiones 1; si la
transacción falla, la versión no queda.

`test/unit/emitir-certificado-viaje.test.ts`: la emisión llama al registro con
los datos del PDF firmado y de la decisión de fuente, y el UPDATE de las
métricas incluye el id de la versión.

### Lo que no cubre

- No hay un test que firme y suba un PDF real: KMS y el bucket se simulan,
  igual que en los tests que ya existían.
- Los 7 certificados emitidos antes de este cambio siguen sin versión. Es la
  parte 2 (relleno, con visto del PO).

## Parte 2 — relleno de la versión 1 (2026-11-11)

`apps/api/src/jobs/rellenar-versiones-certificado.ts` y
`services/rellenar-versiones-certificado.ts`. En seco por defecto; para
escribir exige `DRY_RUN=false` y confirmar el destino.

### Corrida en seco sobre una copia de producción

Producción leída en solo lectura el 2026-11-11: 10 filas en `metricas_viaje`,
8 con certificado emitido, 1 versión en `certificados_viaje` (la sembrada por
la migración 0067). Se cargó en un PostgreSQL 17 local con las migraciones de
main aplicadas; las huellas, fechas y versiones de llave son las de
producción, y los viajes y las direcciones del PDF son sintéticos.

```
antes          emitidos 8 | versiones 1 | sin_version 7 | distintas 0
1. en seco     revisados 8, creadas 7, enlazadas 0, sinCambios 1, omitidas 0  → versiones 1 (no escribió)
2. escribiendo revisados 8, creadas 7, enlazadas 0, sinCambios 1, omitidas 0  → versiones 8 | sin_version 0 | distintas 0
               8 versiones 1, todas vigentes
3. segunda     revisados 8, creadas 0, enlazadas 0, sinCambios 8, omitidas 0
```

`distintas` cuenta las versiones vigentes cuya huella, fecha o versión de
llave no coincide con las columnas `certificado_*` de sus métricas.

Criterio 2 de la spec: 7 versiones por crear, 1 ya existente, 0 certificados
sin versión al terminar. Se cumple en la copia.

### Lista de verificación para producción

1. #929 desplegado: sin él, un certificado emitido entre el relleno y el
   despliegue quedaría sin versión.
2. Job en seco contra producción: `creadas` igual a los certificados sin
   versión y `omitidas` en 0.
3. Job con `DRY_RUN=false` y el destino confirmado.
4. Segunda corrida en seco: 0 creadas, 0 enlazadas.

El orden con #929 importa en un solo sentido: si el relleno corre antes del
despliegue, basta repetirlo después.

