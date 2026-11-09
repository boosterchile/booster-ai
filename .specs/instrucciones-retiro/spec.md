# Spec: instrucciones-retiro

- Author: Felipe Vicencio (PO) + agente
- Date: 2026-11-09
- Status: Aceptada por el PO (pedido del 2026-11-04, plan por etapas, etapa 1, punto 1; decisiones del 2026-11-09)
- Linked: `.specs/documentos-conductor/spec.md`, ADR-070 (repositorio documental, que esta spec **no** usa)

## 1. Objetivo

El conductor tiene a mano lo que necesita para retirar la carga. Muchas veces el retiro es en un lugar distinto del domicilio del generador, y ese lugar le entrega al generador un QR o comprobante para identificarse. El generador lo sube a Booster y el conductor lo muestra en el punto de retiro.

## 2. Decisiones del PO (2026-11-09)

- El QR **no lo genera Booster**. Lo emite el lugar de retiro; el generador lo recibe y lo sube.
- Se guarda **aparte** del repositorio documental:
  - no pasa por el decodificador del TED;
  - no tiene retención de 6 años;
  - no cuenta para el cierre de la entrega.

## 3. Modelo

Tabla nueva `instrucciones_retiro`, una fila por viaje (la vigente). Migración aditiva, expand-only.

| Columna | Tipo | Nota |
|---|---|---|
| `id` | uuid PK | |
| `viaje_id` | uuid FK `viajes`, UNIQUE | `on delete restrict` |
| `archivo_path` | text null | objeto GCS `instrucciones-retiro/{viajeId}/{uuid}.{ext}` |
| `archivo_mime` | text null | PDF, JPEG o PNG |
| `lugar` | text null | dirección del retiro si no es el origen del viaje |
| `nota` | text null | contacto, horario, andén |
| `subido_por` | uuid FK `usuarios` | |
| `creado_en`, `actualizado_en` | timestamptz | |

- CHECK: debe haber archivo o nota. `archivo_path` y `archivo_mime` van juntos (los dos o ninguno).
- Reemplazar actualiza la fila. El objeto anterior queda en el bucket hasta que su ciclo de vida lo borra.
- **Bucket**: `uploads_raw`. No tiene retención y borra los objetos a los 90 días; un QR de retiro solo sirve hasta el retiro.
  - La cuenta de runtime ya puede escribir (`roles/storage.objectUser` del proyecto). No hay cambios de IAM.
  - El api recibe el nombre del bucket por la variable `INSTRUCCIONES_RETIRO_BUCKET` (cambio en `infrastructure/compute.tf`, módulo `service_api`). Sin la variable, la subida responde 503 `storage_unavailable`.

## 4. API

- `PUT /viajes/:id/instrucciones-retiro`
  - Multipart: `file` opcional (PDF, JPEG o PNG, máx. 15 MB, con validación de magic bytes), `lugar` opcional, `nota` opcional.
  - Solo el generador dueño del viaje con rol de gestión (`puedePublicarCarga`). Visualizador → 403 `read_only`.
  - Sin archivo nuevo, conserva el archivo anterior.
  - Si quedan sin archivo y sin nota → 400 `instrucciones_vacias`.
  - Respuesta 200 con el detalle.
- `GET /viajes/:id/instrucciones-retiro`
  - Pueden leer:
    - el generador dueño;
    - la transportista con asignación vigente;
    - el conductor solo si la asignación es suya (misma regla que `documentos-conductor`).
  - 200 con `{ lugar, nota, archivo: { mime, url } | null, actualizado_en }`. La URL está firmada y dura 5 minutos.
  - 404 `sin_instrucciones` si no hay.
- Los tipos permitidos, la validación de magic bytes y la autorización sobre el viaje se comparten con `transport-documents.ts`, no se duplican.

## 5. Web

- **Generador**, en el detalle de la carga: bloque «Instrucciones de retiro» con lugar, nota y archivo, más un botón para cargarlas o reemplazarlas.
- **Conductor**, en la tarjeta del viaje mientras está por recoger:
  - «Instrucciones de retiro» con el lugar y la nota;
  - el QR como imagen grande para escanear, o un botón «Ver» si es PDF;
  - si no hay instrucciones, no se muestra nada.

## 6. Criterios de éxito

- **SC1.** La migración crea la tabla con el UNIQUE y el CHECK. El test de integración contra `information_schema` va en rojo antes de la migración.
- **SC2.** El generador dueño sube un PNG con nota y lo reemplaza por otro. Queda una sola fila y el GET devuelve el último.
- **SC3.** Un visualizador del generador → 403. Una empresa ajena → 403. Un archivo con magic bytes que no calzan → 400 `mime_mismatch`.
- **SC4.** El conductor de la asignación lee las instrucciones y otro conductor de la misma transportista recibe 403.
- **SC5.** El cierre de la entrega no cambia: las instrucciones no cuentan como documento.
- **SC6.** Tests, lint (incluido `lint:rls` y el default-deny de rutas), typecheck y build en verde.

## 7. Fuera de alcance

- Que la bodega valide el QR en Booster. El QR lo valida el lugar de retiro con su propio sistema.
- Historial de versiones de las instrucciones.
