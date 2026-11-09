# Spec: documentos-conductor

- Author: Felipe Vicencio (PO) + agente
- Date: 2026-11-09
- Status: Aceptada por el PO (pedido del 2026-11-04, plan por etapas, etapa 1, punto 1)
- Linked: `.specs/gestor-documental-viaje/` (panel documental), ADR-070 (repositorio documental), `.specs/capacidades-por-rol/spec.md` (`veSoloSuViaje`)

## 1. Objetivo

El conductor ve en su pantalla los documentos de su viaje: la guía de despacho y la factura que suben el generador o su oficina. Así puede acreditar el origen y el destino de la carga ante una fiscalización en ruta.

## 2. Problema verificado en `main` (2026-11-09)

1. `apps/web/src/routes/conductor.tsx`: el botón «Documentos» solo muestra el texto «La guía y la factura las carga tu oficina». No lista nada.
2. `apps/api/src/routes/transport-documents.ts` (`authorizeOverTrip`): un miembro de la transportista con asignación vigente lee los documentos de cualquier viaje de su empresa. Para el rol `conductor` eso es demasiado: la regla de capacidades (`veSoloSuViaje`) dice que ve solo su viaje.

## 3. Entradas y salidas

- **API, sin endpoints nuevos.**
  - `GET /transport-orders/:id/documents` y `GET /documents/:id` no cambian de forma.
  - Con el rol `conductor`, solo autorizan si `asignaciones.conductor_id` (que es un `usuarios.id`) es el usuario de la sesión. Si no, responden 403, igual que el IDOR de hoy.
- **Web.**
  - El botón «Documentos» del conductor lista los documentos del viaje: tipo, folio y emisor si se decodificaron.
  - Cada documento tiene un botón «Ver» que abre la URL firmada (5 min, la de hoy).
  - Es solo lectura: el conductor no sube ni corrige.
- **Sin cambios** en schema, migraciones ni el gate de cierre.

## 4. Criterios de éxito

- **SC1.** Un conductor con la asignación a su nombre lista los documentos del viaje y obtiene la URL de cada uno.
- **SC2.** Un conductor de la misma transportista, con un viaje asignado a otro conductor, recibe 403 en el listado y en el detalle.
- **SC3.** Dueño, admin, despachador y visualizador de la transportista, y el generador dueño, siguen leyendo igual que hoy.
- **SC4.** En la pantalla del conductor, «Documentos» muestra la lista. Si no hay documentos, dice que la oficina todavía no los carga. Si el API falla, lo dice y permite reintentar.
- **SC5.** Auth es dominio crítico: los tests de SC2 se muestran en rojo antes del cambio.

## 5. Fuera de alcance

- Las instrucciones de retiro (QR o comprobante del lugar de retiro). Van en `.specs/instrucciones-retiro/`, con tabla propia (decisión del PO del 2026-11-09).
- Uso sin conexión de los documentos.
