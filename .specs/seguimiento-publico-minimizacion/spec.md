# Spec: seguimiento-publico-minimizacion

- **Author**: agente (Claude), por encargo del PO
- **Date**: 2026-11-09
- **Status**: Aceptada por el PO en el chat del 2026-11-09 («Sí, hazlos»)
- **Linked**: `.specs/tracking-live-unificado/`, `.specs/seguimiento-por-correo/`, `.specs/editar-anular-cargas/` §12-P8, Ley 21.719 (principios de finalidad y proporcionalidad)

## 1. Objetivo

El seguimiento público (`/tracking/:token`, sin sesión) y el correo que lleva su
enlace muestran solo lo que un destinatario necesita para esperar su carga:
código, estado, zona de origen y destino, tipo de vehículo, posición y hora
estimada. Este cambio fija esa regla en cinco puntos y agrega quién opera el
servicio.

## 2. Estado verificado en main (`cc5ff61e`)

- `GET /public/tracking/:token` responde con `Cache-Control: private, no-store`
  y ninguna otra cabecera de privacidad. La web sirve `/tracking/*` con las
  mismas cabeceras que el resto de la aplicación.
- `resolverPosicionEnVivo` elige la fuente de la posición por vehículo
  (Teltonika) o por asignación (móvil del conductor), en los estados
  `asignado` y `en_proceso`.
- El correo del enlace (`notify-tracking-link-email.ts`) lleva el mismo texto a
  generador y destinatario.
- La respuesta pública trae `origin_address` y `destination_address` como texto
  libre de la carga.
- El pie de la página pública no nombra al operador del servicio.

## 3. Cambios

### 3.1 Cabeceras

- La API pública responde, en 200 y en 404, con `X-Robots-Tag: noindex, nofollow`
  y `Referrer-Policy: no-referrer`.
- La web sirve `/tracking/*` con las mismas dos cabeceras.
- El enlace al mapa externo de la página pública lleva `rel="noopener noreferrer"`.

### 3.2 La posición es la del viaje que se sigue

Regla: la posición por vehículo (Teltonika) solo se usa para una asignación
cuando ese vehículo no tiene **otra** asignación con el viaje `en_proceso`. Si
la tiene, la asignación en estado `asignado` usa únicamente la posición del
móvil del conductor de esa asignación; sin ella, no hay posición.

Una asignación cuyo viaje ya está `en_proceso` no cambia.

La regla vive en `resolverPosicionEnVivo`, que comparten el seguimiento público
y el detalle de la carga del generador.

### 3.3 Correo del enlace

- La patente va enmascarada con la misma regla de la página pública (`maskPlate`).
- El nombre de la empresa transportista va solo en el correo al generador, que
  ya lo ve en su panel. Al destinatario le llega la patente enmascarada.
- Si generador y destinatario comparten correo, se envía una vez, con el texto
  del generador.

### 3.4 Origen y destino por zona

`trip.origin_address` y `trip.destination_address` de la respuesta pública pasan
a ser «Comuna, Región» (o solo la región si la carga no tiene comuna). Las
claves no cambian de nombre ni de tipo. La dirección completa se sigue usando
dentro del servidor para calcular la hora estimada y no sale en la respuesta.

**Cambio de contrato de API pública** (mismo esquema, contenido más general).
El generador sigue viendo las direcciones completas en su panel con sesión.

### 3.5 Operador del servicio

El pie de la página pública dice «Servicio operado por Booster Chile SpA» y
enlaza a `/legal/terminos`. Es el mismo texto que esa página ya publica. No se
agrega texto legal nuevo.

## 4. Criterios de éxito

1. Test de ruta: 200 y 404 traen `x-robots-tag` y `referrer-policy`.
2. Test unitario e integración de `resolverPosicionEnVivo`: vehículo con otra
   asignación `en_proceso` + esta en `asignado` → no devuelve Teltonika; con
   móvil de esta asignación → `mobile`; sin él → `source: null`. El caso
   `en_proceso` y el caso sin otra asignación siguen dando `teltonika`.
3. Test del correo: ningún correo contiene la patente completa; el del
   destinatario no contiene el nombre de la transportista; el del generador sí.
4. Test del servicio público: la respuesta no contiene el texto de dirección de
   la carga; contiene comuna y región.
5. Test de la página: el pie nombra al operador y enlaza a los términos; el
   enlace al mapa lleva `noreferrer`.
6. Tests, lint, typecheck y build en verde.

## 5. Fuera de alcance (decisiones del PO)

- Que el generador pueda regenerar el enlace, y si el enlace cambia cuando
  cambia el destinatario. `.specs/editar-anular-cargas` §12-P8 fija hoy «mismo
  token»; cambiarlo es decisión del PO.
- Textos legales, consentimiento, retención y canal de derechos: dependen de la
  revisión del abogado.
