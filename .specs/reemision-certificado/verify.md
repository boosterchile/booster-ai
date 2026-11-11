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


## Parte 3 — migración 0082 y servicio de reemisión (2026-11-11)

`apps/api/src/services/reemitir-certificado.ts`. Sin job ni endpoint: lo usará
el job de la parte 5.

### Migración 0082 (`expand`)

- `certificados_viaje.motivo_reemision varchar(40)`, opcional.
- `ck_certificados_viaje_motivo`: la versión 1 no lleva motivo; una posterior
  lleva uno de la lista cerrada (hoy solo `factor_impreso_no_corresponde`). El
  `IS NOT NULL` es explícito: sin él, un `IN` con nulo deja pasar la fila.
- `tipo_evento_viaje` suma `certificado_reemitido` (también en
  `shared-schemas`).
- En producción hay 1 fila en la tabla, versión 1 sin motivo: la restricción
  la acepta.

### Qué hace el servicio

1. Comprueba que el viaje está entregado, que el certificado está emitido y
   que su versión vigente es la que espejan las métricas.
2. Comprueba que el factor guardado es el anterior indicado, que el nuevo es
   distinto y que los litros por el nuevo factor dan las emisiones guardadas
   (tolerancia del redondeo de litros y emisiones).
3. Genera, firma y sube el PDF con el factor corregido, en memoria.
4. En una transacción: corrige el factor con guarda sobre el valor anterior y
   la huella vigente, registra la versión nueva con su motivo y deja el
   evento con las dos huellas y quién lo pidió.

### Cambios fuera de lo que lista la spec

- **Ruta por versión en el bucket**: la versión 1 sigue en `{tracking}.pdf`;
  la n en `{tracking}.v{n}.pdf`. Los tres lectores de PDF y firma
  (`assignments`, `trip-requests-v2`, `certificates`) leen la versión desde la
  URI guardada.
- **El número de versión sale de la mayor registrada**, no de la vigente:
  después de revertir una reemisión la vigente vuelve a ser la 1, pero la 2 ya
  tiene su PDF. La transacción comprueba que la versión registrada sea la del
  PDF subido.
- **Desde la versión 2 la subida no pisa un objeto existente**
  (`ifGenerationMatch: 0` en GCS; el bucket local imita la precondición). Dos
  reemisiones concurrentes no se sobrescriben: la segunda falla y no registra
  nada. La versión 1 sube como siempre.
- `armarDatosEmision` se extrajo de `emitirCertificadoViaje` para generar el
  PDF con el dato corregido sin escribir en la base.

### Criterios de la spec

- **3**: `test/integration/reemitir-certificado.integration.test.ts` (15
  tests) — crea la versión 2 con el factor corregido y deja la 1
  `reemplazado`; el evento; con el factor anterior distinto o un factor nuevo
  que no explica la cifra no escribe; si generar, firmar o subir falla la base
  no cambia; si el certificado cambió en medio, no registra nada.
- **4**: mismo archivo — la verificación pública con la huella de la 1
  responde reemplazada por la 2.
- **6**: la versión 2 va a otra ruta y la subida no sobrescribe
  (`storage.test.ts`, `backend-local.test.ts`). Sin un bucket real, no hay
  test que liste el bucket después de reemitir.
- **7**: ver la evidencia del PR.

El criterio 5 (lo que imprime el certificado reemitido) es la parte 4.

### Lo que no cubre

- KMS y el bucket se simulan; no hay test que firme y suba a GCS.
- Si la transacción falla después de subir, el PDF queda huérfano en el
  bucket (spec §9) y se registra en el log.

## Parte 4 — el certificado reemitido dice qué reemplaza (2026-11-11)

Un certificado de versión mayor que 1 lleva, bajo las fechas y en una línea:

> Reemplaza a la versión 1, emitida el 03-11-2026. Motivo: el factor de
> emisión impreso no era el usado en el cálculo.

Arriba sigue «Versión 2 · reemplaza a v1», como fijó HC-004.

- La fecha es la de emisión de la versión reemplazada, en hora de Chile.
- «Reemplaza a» nombra la versión que estaba vigente. Después de revertir la
  2, la 3 reemplaza a la 1.
- La lista cerrada de motivos y su texto viven en el generador
  (`src/reemision.ts`); el API la reexporta y la restricción
  `ck_certificados_viaje_motivo` de la base la repite.
- La plantilla valida la versión: una versión mayor que 1 sin versión
  anterior, fecha o motivo válidos no se genera. Un certificado firmado que
  diga «versión 2» sin decir qué reemplaza no resiste una auditoría (§8-2).
- El texto del motivo se acortó para que la línea quepa a 9 pt. El test
  comprueba que cada motivo de la lista cabe en una línea.

### Criterio 5

`packages/certificate-generator/test/reemision-plantilla.test.ts`, con las
cifras del certificado afectado: imprime el factor 3,24, combustible 182,33 L y
emisiones 590,75 kg; 182,33 × 3,24 da la cifra impresa dentro del redondeo a
2 decimales. Con el factor viejo (3,25) la cuenta no cierra.

`apps/api/test/integration/reemitir-certificado.integration.test.ts`: la
reemisión pasa al PDF la versión anterior, su fecha y el motivo, y con esos
datos el PDF real se genera.

### Lo que no cubre

- Ningún test abre el PDF firmado: la firma y la subida se simulan.
- El aviso al generador de §8-1 no está en ninguna parte de la tabla §5. Queda
  para decidir dónde entra (la parte 5 o una propia).

## Parte 5 — job de reemisión, en seco por defecto (2026-11-11)

`apps/api/src/jobs/reemitir-certificado.ts`. Un viaje por corrida, elegido por
código de seguimiento; la corrección (motivo, factor anterior y nuevo) va en
variables. En seco por defecto.

- `prepararReemision` hace todas las comprobaciones y arma el PDF. La usan la
  reemisión y la corrida en seco, así que las dos comprueban exactamente lo
  mismo.
- En seco, `simularReemision` además genera el PDF en memoria (sin firmar):
  si la plantilla lo rechazara, se vería aquí y no al firmar.
- Para escribir exige `CONFIRMAR_DESTINO` igual al destino que imprime la
  corrida en seco, y la llave de Cloud KMS y el bucket GCS (rechaza los
  `local:` y `file:` del E2E). Lo rechaza antes de conectarse.
- El código de seguimiento se acepta en minúsculas.
- El solicitante (`SOLICITADO_POR_USER_ID`) queda en el evento del viaje. Si
  no existe, se rechaza antes de firmar: de lo contrario, la transacción
  fallaría con el PDF ya subido.

### Corrida en seco sobre una copia de producción

El certificado afectado es **BOO-YWKZWR**: imprime 3,25 y sus emisiones
(590,746 kg) son 182,33 L × 3,24. Su fila de `metricas_viaje` se leyó de
producción en solo lectura el 2026-11-11 (48 columnas) y se cargó en un
PostgreSQL 17 local con las migraciones de esta rama; el viaje, la empresa y el
usuario son sintéticos. En producción el certificado todavía no tiene versión
registrada: el relleno de la parte 2 no se ha corrido.

```
0. estado inicial          versiones=0 factor=3.25000 eventos_reemision=0
1. reemisión en seco       ok:false, code: sin_version_vigente              (exit 1)
2a. relleno en seco        revisados 1, creadas 1, omitidas 0
2b. relleno escribiendo    revisados 1, creadas 1, omitidas 0  → versiones=1
3. reemisión en seco       ok:true, versionVigente 1 → versionNueva 2,
                           ruta certificates/<empresa>/BOO-YWKZWR.v2.pdf,
                           factor 3.25 → 3.24, 182.33 L, 590.746 kg,
                           PDF en memoria 76 458 bytes                       (exit 0)
4a. factor nuevo 3.30      ok:false, correccion_no_explica_cifra            (exit 1)
4b. factor anterior 3.24   ok:false, correccion_no_corresponde              (exit 1)
4c. escribir sin destino   «CONFIRMAR_DESTINO debe ser …; no se escribió nada» (exit 1)
5. estado final            versiones=1 factor=3.25000 eventos_reemision=0
```

La huella vigente que informa el paso 3 es la del certificado publicado en
producción. Una vista previa sin firmar del PDF de la versión 2 muestra
«Versión 2 · reemplaza a v1», la línea «Reemplaza a la versión 1, emitida el
03-11-2026. Motivo: el factor de emisión impreso no era el usado en el
cálculo.», el factor 3,24 y la cifra de 590,75 kg con 182,33 L. La fuente de
factores impresa (GLEC v2.0, Tabla 32) es la del 3,24.

### Lista de verificación para la parte 6 (la ejecuta el PO)

1. Desplegado en producción lo de las partes 1 a 3 (#929, #930 y #931: la
   emisión versionada, la migración 0082 y la verificación pública por
   versión). El job se corre desde un checkout de `main` al día con las partes
   4 (#932) y 5 (esta): el PDF lo arma ese proceso local, no el servicio
   desplegado, y sin la parte 4 saldría sin la línea de reemplazo.
2. `rellenar-versiones-certificado.ts` en seco y después escribiendo (parte 2).
3. Este job en seco contra producción: `ok: true`, `versionNueva: 2` y la
   huella vigente igual a la del certificado publicado.
4. Este job con `DRY_RUN=false`, el destino confirmado, la llave y el bucket
   de producción (las variables del servicio api en Cloud Run; el job rechaza
   los `local:` y `file:` del E2E) y `SOLICITADO_POR_USER_ID`. Desde el Mac, la
   firma con KMS puede fallar al pedir el token («Premature close», como en el
   backfill de 2026-09): falla antes de subir y de escribir, y se resuelve
   sirviendo el token con un metadata server local.
5. Comprobar:
   - `GET /certificates/BOO-YWKZWR/verify` sin huella, y con `?sha256=` igual a
     la huella nueva que imprime el job, responde válido con esa huella;
   - con la huella de la versión 1 responde «reemplazado por v2»;
   - en el bucket están `BOO-YWKZWR.v2.pdf` y su `.sig`, y el PDF de la versión
     1 y su firma siguen ahí;
   - una segunda corrida en seco responde `correccion_no_corresponde` (el
     factor guardado ya es 3,24).

No hay reverso ejecutable. `revertirVersion` vuelve vigente la versión 1 pero
no repone el factor guardado; un reverso exige también reponer
`factor_emision_usado` con guarda, en la misma transacción y con el visto del
PO (detalle en `apps/api/src/jobs/README.md`).

### Lo que no cubre

- La firma con KMS y la subida a GCS solo se prueban simuladas.
- El aviso al generador (§8-1) no está en ninguna parte de la tabla §5.

