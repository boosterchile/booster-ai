# El observatorio separa las emisiones por presentación

**Estado**: pedida por el PO el 2026-11-26 (chat) · **Fecha**: 2026-11-26

Sigue a `.specs/sello-huella-toda-la-web`: el observatorio quedó como el único
agregado de la web que suma todas las clases en una cifra y la muestra
«Estimado». Esta spec separa la vista de emisiones por presentación de
ADR-091, para que cada fila lleve su sello real.

## 1. Qué hay en `main` (`6d4558d6`)

- El export horario (`POST /admin/jobs/observatorio-export`) reemplaza
  `observatory.viajes` con un load job `WRITE_TRUNCATE` (NDJSON). La tabla no
  tiene la presentación.
- `urban_flow_metrics_emisiones` agrupa por región, comuna, mes y clase de
  vehículo. El API la lee con `SELECT *` y la web escribe cada cifra con
  `presentacion="estimado"` fijo.

## 2. Salidas

- **Export.** Cada fila lleva `presentacion`, calculada con
  `presentacionDesdeMetricas` (la misma función que el certificado y el resto
  de la web).
- **Tabla.** `observatory.viajes` agrega la columna `presentacion`, `STRING`
  `NULLABLE` (agregar una columna anulable no recrea la tabla).
- **Vista.** `urban_flow_metrics_emisiones` agrupa además por
  `COALESCE(presentacion, 'estimado') AS presentacion`. El umbral de
  anonimato (ADR-096) no cambia.
- **Web.** Cada fila de Emisiones lleva el sello de su `presentacion`. Una
  fila sin presentación, o con un valor fuera del contrato, sale «Estimado».

## 3. Orden de despliegue

Un load job falla si la fila trae un campo que la tabla no tiene. Si el api se
libera antes del `terraform apply`, el export no puede mandar `presentacion`.

- Bandera `OBSERVATORIO_PRESENTACION_ACTIVADA` (por defecto `false`). Con ella
  apagada el export no manda el campo.
- `compute.tf` la calcula desde el esquema de la tabla: es `true` solo si la
  columna existe. Así se enciende en el mismo `apply` que crea la columna, y
  Terraform aplica la tabla antes que el servicio.
- Antes del `apply`, la vista no tiene `presentacion` y la web muestra
  «Estimado», igual que hoy. El orden entre release y `apply` no importa.

El `apply` lo corre el PO. Queda junto al de #1096 (umbral 1), que sigue pendiente
sobre el mismo archivo.

## 4. Criterios de éxito

1. `proyeccion.test.ts`: `proyectarViaje` da la presentación de cada fila de
   ADR-091 (TDD, rojo exhibido: dominio GLEC).
2. `bigquery.test.ts`: con la bandera apagada el export no manda
   `presentacion`; encendida, sí.
3. `platform-admin-observatorio.test.tsx`: cada fila de Emisiones lleva el
   sello de su presentación; sin ella, «Estimado».
4. `terraform fmt` y `terraform validate` sin errores; la vista de emisiones
   agrupa por presentación.
5. `pnpm run ci` en verde.

## 5. Fuera de alcance

- El `terraform apply` (lo corre el PO).
- Las otras vistas (franjas, OD, activos): no muestran emisiones.
