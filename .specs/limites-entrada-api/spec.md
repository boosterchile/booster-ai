# Spec: limites-entrada-api

- Author: Felipe Vicencio (con Claude)
- Date: 2026-10-29
- Status: Propuesta. Necesita el visto del PO: cambia el contrato público de la API (respuesta 413 nueva).
- Origen: endurecimiento de las entradas de `apps/api`. El análisis que lo motiva se entregó al PO por canal privado.
- Slot: no ocupa slot de producto; entra como trabajo de seguridad (`CLAUDE.md`, ciclo de trabajo §1).
- Relacionado: `.specs/_followups/zod-4-migracion-2026-10.md` (paso 3 de su plan de pago).

## 1. Objective

Que `apps/api` rechace cuerpos de request más grandes de lo que envía cualquier cliente legítimo, y que los arreglos de los esquemas de entrada tengan un tope de largo que se compruebe antes de validar sus elementos.

Hoy `apps/api` no tiene límite de cuerpo propio: el único tope es el de Cloud Run (32 MiB). Dos arreglos de entrada no tienen tope de largo.

## 2. Medición del cuerpo legítimo más grande

Método: revisión de los validadores de cuerpo de `apps/api/src/routes` y `middleware`, de los esquemas compartidos que usan, de las llamadas de `apps/web` y de los servicios que llaman a la API (bot de WhatsApp, push de Pub/Sub). Cada cuerpo se armó con todos sus campos en el máximo que permite su esquema y se midió con `Buffer.byteLength(JSON.stringify(body))`.

| Cuerpo | ASCII | Peor caso UTF-8 (3 B por unidad) |
|---|---|---|
| Borrador de configuración del sitio (`POST /admin/site-settings/draft`) | 6,4 KiB | 16,9 KiB |
| Mensaje de chat de texto (4.000 caracteres) | 3,9 KiB | 11,7 KiB |
| Zona con las 52 comunas de la RM | 0,5 KiB | 0,5 KiB |
| Alta de carga (`POST /trip-requests-v2`) | 2,6 KiB | 6,7 KiB |
| Sobre push de Pub/Sub con un evento de seguridad | < 1 KiB | < 1 KiB |

El cuerpo JSON legítimo más grande es el borrador de configuración del sitio: 17 KiB en el peor caso. El resto de los cuerpos (onboarding, conductor, vehículo, documentos, ofertas) son objetos de campos escalares con topes menores; que no superan a los de la tabla se infiere de sus topes, no se midió uno por uno. Los textos sin `.max()` son URLs, identificadores o textos cortos.

Dos rutas reciben `multipart/form-data` con un archivo, y su tope ya está en el handler:

| Ruta | Tope del archivo |
|---|---|
| `POST /transport-orders/:id/documents` | 15 MiB (`MAX_DOCUMENT_BYTES`) |
| `POST /admin/site-settings/assets` | 500 KiB (`MAX_ASSET_BYTES`) |

### Decisión

- Límite general: **64 KiB**, unas 3,7 veces el peor caso legítimo.
- Excepciones explícitas: las dos rutas multipart, con su tope de archivo más 64 KiB para el sobre multipart. El 413 `file_too_large` de cada handler sigue igual.

## 3. Arreglos de entrada

| Esquema | Campo | Tope | Por qué ese número |
|---|---|---|---|
| `zoneCreateBodySchema`, `zoneUpdateBodySchema` | `comuna_codes` | 346 | Comunas del catálogo (`COMUNAS_CHILE`) |
| Alta de consentimiento (`me-consents.ts`) | `data_categories` | 6 | Valores del enum de categorías |

En zod 3, `.max()` se comprueba después de validar cada elemento: el arreglo se recorre entero aunque sea demasiado largo. El helper `boundedArray` (`packages/shared-schemas/src/primitives/bounded-array.ts`) compara el largo en un `z.preprocess`, antes que los elementos, y corta con un solo issue `too_big`, igual al que produce `.max()`. Al migrar a zod 4 se reemplaza por `.max()`.

Barrido: los esquemas de cuerpo de `apps/api` no tienen otros arreglos ni records alcanzables por un usuario. El record de `attributes` del sobre de Pub/Sub se lee después de verificar el OIDC del push.

## 4. Success criteria

- [x] SC-1: un cuerpo de más de 64 KiB, en cualquier ruta sin excepción, recibe 413 `{ error: 'payload_too_large', code: 'payload_too_large', max_bytes }`, con o sin `Content-Length`, antes de autenticar y de leer el cuerpo.
- [x] SC-2: un cuerpo de hasta 64 KiB pasa sin cambios, y el handler lo puede leer después del middleware.
- [x] SC-3: las dos rutas multipart aceptan hasta su tope más 64 KiB. Por sobre eso, 413 `payload_too_large`.
- [x] SC-4: `comuna_codes` con más de 346 elementos da 400 con un solo issue `too_big`, sin validar los elementos. Hasta 346, los elementos se validan como antes. `null` y omitido, igual que antes.
- [x] SC-5: `data_categories` con más de 6 elementos da 400 con un solo issue `too_big`. El mínimo de 1 y su mensaje no cambian.
- [x] SC-6: cada 413 deja un log `warn` con método, ruta, límite y largo declarado.
- [x] SC-7: TDD con rojo exhibido. Tests, lint, typecheck y build en verde.

## 5. User-visible behaviour

Ninguno para la web ni para el bot: ningún cliente envía hoy cuerpos JSON cerca de 64 KiB, la web no envía `comuna_codes` ni `data_categories` y valida el tamaño del archivo antes de subirlo. Un cliente que envíe más recibe 413 (cuerpo) o 400 (arreglo).

## 6. Out of scope

- La migración a zod 4: `.specs/_followups/zod-4-migracion-2026-10.md`.
- Un hook común de `zValidator` que recorte los issues de la respuesta 400. Cambia el contrato del 400 y encaja con la decisión pendiente de esa migración. Queda para el PO (§7).
- Límites de cuerpo en otros servicios y en el balanceador.

## 7. Decisiones del PO

1. Visto al 413 nuevo y a los dos topes (contrato público).
2. Opcional: el hook común del 400, aquí o en la migración a zod 4.
