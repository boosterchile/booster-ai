# Una sola verdad por dato (frente 1 del rediseño)

**Estado**: pedida por el PO el 2026-11-25 (goal de la sesión) · **Fecha**: 2026-11-25

Implementa el frente 1 de [`docs/design/rediseno-2026-11-25/FRENTES.md`](../../docs/design/rediseno-2026-11-25/FRENTES.md).
El rediseño pone cifras en la primera línea de cada pantalla; esta spec hace
que la misma cifra salga del mismo cálculo y se escriba igual en todas.

## 1. Qué se encontró en `main` (`afc3e044`)

1. **Documentos pendientes, dos cálculos.** Flota (`/app/booster-fleet`) usa
   `armarPanelBoosterFleet` de `packages/shared-schemas`: exige los documentos
   obligatorios y cuenta como pendiente lo vencido, lo faltante, lo que no
   tiene fecha, lo que no tiene archivo y lo por vencer. El Inicio del
   transportista y Cumplimiento usan `GET /cumplimiento`, que solo mira filas
   existentes con fecha: un documento que falta no cuenta. Conductores calcula
   por su cuenta el estado de la licencia y no muestra otros documentos.
2. **Estado de la flota, tres vocabularios.** `/app/flota` dice «reportando»,
   el Inicio dice «sin señal», Booster Fleet dice «sin lectura» y el panel de
   administración dice «Sin equipo».
3. **Emisiones, nueve formatos.** Entre 0 y 3 decimales, punto o coma decimal,
   «CO2e» y «CO₂e», con y sin unidad, en `OfferCard`, `ResultadoViaje`,
   `inicio/generador`, `certificados`, `rutas`, `cargas`, el observatorio y
   las zonas de organizaciones.
4. **Umbral de anonimato, dos valores.** 10 vehículos en el observatorio y 5
   viajes en los agregados de organizaciones.
5. **El Inicio del panel de administración no muestra cifras.**
6. **Las fechas de vencimiento se leían inválidas.** `fecha_vencimiento` es
   `date` en la base y el esquema de drizzle la declara `timestamp`: leída
   tal cual llega como `Invalid Date`. Booster Fleet marcaba todo documento
   con fecha como «Sin fecha de vencimiento». Se encontró al correr la prueba
   del criterio 4 contra Postgres real.

## 2. Decisiones del PO

- El umbral de anonimato es 1 camión (README del rediseño, punto 8; goal del
  2026-11-25). Supersede lo que fijaban ADR-012, ADR-034 y ADR-041: lo
  registra ADR-096, autorizado por el PO en la sesión del 2026-11-25.
- El Inicio del panel muestra el bloque «Indicadores del negocio» del frente
  10, para que la prueba tenga cifras que comparar (respuesta del PO en la
  sesión del 2026-11-25).

## 3. Salidas

### 3.1 Formateador único de cifras de emisiones (PR 1)

`apps/web/src/lib/formato-emisiones.ts` es el único lugar de `apps/web` que
escribe una cifra de emisiones o el texto «CO₂e».

- `formatoEmisiones(kg)`: recibe kilogramos (número, texto numérico o nulo).
  Coma decimal y punto de miles (`es-CL`), siempre con unidad:
  - nulo, vacío o no numérico → `Sin dato`;
  - menos de 1 kg en valor absoluto → 3 decimales, `0,034 kg CO₂e`;
  - desde 1 kg y bajo 1.000 kg → 1 decimal, `375,2 kg CO₂e`;
  - desde 1.000 kg → toneladas con 2 decimales, `1,25 t CO₂e`.
- `formatoIntensidad(g)`: `62 g CO₂e/t·km`, sin decimales.
- `formatoFactorEmision(kgPorLitro)`: `2,68 kg CO₂e/L`, 2 decimales.
- `CO2E`: la constante `'CO₂e'`, para rótulos.

### 3.2 Umbral de anonimato único (PR 2)

`UMBRAL_ANONIMATO = 1` en `packages/shared-schemas`. Lo usan los agregados de
organizaciones, las zonas, el observatorio (API y vistas de BigQuery) y los
textos de la web. ADR-096 registra la decisión.

### 3.3 Documentos, estado de flota, indicadores y prueba (PR 3)

- **Documentos pendientes.** Un cálculo: `calcularDocumental` en
  `packages/shared-schemas`, alimentado por un único lector en el API. Lo
  sirven `GET /booster-fleet` y `GET /cumplimiento`. Pendiente es todo
  documento cuyo estado no es `vigente`, incluido el obligatorio que falta.
  Flota, el Inicio del transportista, Cumplimiento y Conductores muestran esa
  cifra.
- **Estado de flota.** Tres palabras definidas una vez en
  `packages/shared-schemas`: «reportando», «sin equipo» y «sin lectura».
- **Indicadores del negocio** en el Inicio del panel: empresas activas,
  cargas, certificados medidos y estimados, camiones con huella medida,
  documentos pendientes y emisiones certificadas. `GET /admin/indicadores`.
- **Fechas de documentos.** El lector único lee `fecha_vencimiento` como
  texto `AAAA-MM-DD`. Una prueba de integración lo fija.

## 4. Criterios de éxito

1. `formato-emisiones.test.ts` fija los cuatro tramos y la coma decimal.
2. `sin-cifras-de-emisiones-sueltas.test.ts` recorre `apps/web/src` y falla
   si un archivo distinto del formateador escribe «CO₂e», «CO2e» o «CO2» en
   un texto, o da formato numérico a un campo de emisiones.
3. Con 1 vehículo o 1 viaje, el observatorio y los agregados de
   organizaciones entregan el dato; un test por cada uno lo fija.
4. Una prueba Playwright (`apps/web/e2e-conductor/una-sola-verdad.spec.ts`)
   siembra una empresa (`apps/api/scripts/seed-una-verdad-e2e.ts`), la carga
   en Flota, en el Inicio con servicio completo, en Cumplimiento, en
   Conductores, en el Inicio con Booster Fleet solo, en Certificados y en el
   Inicio del panel, y falla si dos pantallas muestran valores distintos para
   documentos pendientes, camiones, conductores con documentos pendientes,
   certificados o emisiones certificadas. Las pantallas se excluyen entre sí
   por las banderas de la empresa (el Inicio con servicio completo exige que
   reciba ofertas, el de Booster Fleet que no, Certificados que sea
   generadora): la siembra cambia solo esas banderas entre una carga y otra;
   camiones, documentos y certificados son los mismos.
5. `pnpm run ci` en verde en cada PR.

## 5. Fuera de alcance

- El glosario de «retiro», «publicar carga» y los formatos de patente,
  fecha y hora en todas las pantallas. Este frente deja un solo
  vocabulario de estado de flota y un solo formato de emisiones; el
  glosario completo va con el sistema visual (frente 8).
- `GET /documentos/vehiculo/:id` y `/documentos/conductor/:id` serializan la
  fecha con el mismo esquema de drizzle y no se tocaron aquí.

- El sello «Medido» / «Estimado» junto a cada cifra (frente 2).
- El resto del Inicio del panel: pendientes con antigüedad (frente 10).
- El cambio de menú y la fusión de Cumplimiento dentro de Flota (frente 5).
- Reescribir los textos de toda la aplicación con el glosario: esta spec
  deja los formatos y los aplica a las pantallas del frente 1.
- El `terraform apply` de las vistas de BigQuery en producción: lo corre el
  PO. Hasta entonces el observatorio sigue filtrando con el umbral de la
  vista desplegada.
