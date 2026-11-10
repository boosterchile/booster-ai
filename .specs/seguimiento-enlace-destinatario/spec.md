# Spec: seguimiento-enlace-destinatario

- **Author**: agente (Claude), por encargo del PO
- **Date**: 2026-11-09
- **Status**: Aceptada por el PO en el chat del 2026-11-09 («Sí, que cambie»)
- **Linked**: `.specs/editar-anular-cargas/` §8 y §12-P8 (esta spec reemplaza P8), `.specs/seguimiento-publico-minimizacion/`, `.specs/seguimiento-por-correo/`

## 1. Objetivo

El enlace público de seguimiento de una carga lo tiene quien debe recibirla.
Cuando el generador cambia el contacto del destinatario después del match, el
enlace cambia: el anterior deja de responder y el nuevo llega al contacto
vigente.

## 2. Estado verificado en main (`357abb5f`)

- `PATCH /trip-requests-v2/:id/datos-libres` reemplaza el destinatario completo.
  Si el teléfono cambia a un valor no nulo y hay asignación activa, reenvía el
  enlace por WhatsApp al número nuevo **con el mismo token** (§12-P8).
- Un correo nuevo del destinatario no recibe nada.
- El token (`asignaciones.tracking_token_publico`) se acuña al aceptar la oferta
  y no cambia nunca.

## 3. Regla

### 3.1 Cuándo cambia el enlace

En la misma transacción de la edición, el token se reemplaza por un UUID nuevo
cuando se cumplen las tres condiciones:

1. el viaje tiene una asignación activa (`asignado` o `recogido`) con token;
2. el destinatario tenía un contacto: teléfono o correo no nulo;
3. ese contacto cambió o se quitó. El correo se compara sin distinguir
   mayúsculas.

No cambia cuando solo cambia el nombre, cuando se agrega un contacto donde no
había ninguno, ni cuando se agrega el segundo contacto sin tocar el primero.
`tracking_token_expira_en` no se toca.

Con el token reemplazado, `GET /public/tracking/<token anterior>` responde el
mismo 404 neutro que un token inexistente.

### 3.2 A quién le llega el enlace vigente

Después del commit, sin revertir la edición si un envío falla:

- **Enlace reemplazado:** al teléfono (WhatsApp) y al correo vigentes del
  destinatario, los que existan.
- **Enlace sin reemplazar:** al teléfono nuevo, como hoy, y al correo nuevo si
  cambió a un valor no nulo.

El correo al destinatario usa el texto del destinatario de
`seguimiento-publico-minimizacion` §3.3 (patente enmascarada, sin el nombre de
la transportista). No usa la marca `tracking_link_email_enviado_en`, que es del
envío al asignar.

Al generador no se le reenvía: ve el enlace vigente en el detalle de su carga.

### 3.3 Respuesta y pantalla

- La respuesta del PATCH agrega `enlace_seguimiento_renovado: boolean` dentro de
  `trip_request`. **Cambio de contrato de API** (campo nuevo, aditivo).
- La tarjeta «Contacto y notas» del generador, al guardar con el enlace
  reemplazado, avisa: «El enlace de seguimiento cambió. El anterior dejó de
  funcionar.»

## 4. Criterios de éxito

1. Test del servicio: con contacto anterior cambiado o quitado y asignación con
   token, se escribe un token nuevo distinto del anterior y el resultado dice
   `enlaceRenovado: true` con los contactos vigentes. Solo nombre, contacto
   agregado, sin asignación o asignación sin token → no se escribe token.
2. Test de integración contra PostgreSQL: tras el PATCH el token de la
   asignación es otro, el anterior no resuelve y el nuevo sí.
3. Test de ruta: reenvía por WhatsApp y por correo según §3.2; la respuesta
   trae `enlace_seguimiento_renovado`; un envío que falla no cambia el 200.
4. Test del correo: el reenvío va solo al correo indicado, con el enlace
   vigente, patente enmascarada y sin el nombre de la transportista.
5. Test de la tarjeta: muestra el aviso solo cuando el enlace se reemplazó.
6. Tests, lint, typecheck y build en verde.

## 5. Fuera de alcance

- Un botón para que el generador reemplace el enlace sin cambiar el
  destinatario.
- Reenviar el enlace al generador por WhatsApp o correo.
- Sin migración: no hay columnas nuevas.
