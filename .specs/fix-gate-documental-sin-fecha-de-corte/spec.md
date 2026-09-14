# Gate documental del cierre: sin fecha de corte, el guard no aplica

**Estado**: aceptada · **Fecha**: 2026-09-13 · **Pedido por**: PO (decisión D1a del plan «Conductor y huella punta a punta»)

## 1. El problema

`PATCH /assignments/:id/confirmar-entrega` responde 409 `documento_requerido` en
producción para TODA orden, porque:

- `REQUIRE_DOCUMENT_TO_CLOSE` es `booleanFlag(true)` por defecto (`apps/api/src/config.ts`).
- `REQUIRE_DOCUMENT_TO_CLOSE_SINCE` nunca se definió en Terraform.
- Los comentarios de `config.ts` y `server.ts` prometen que «sin esta var, el
  guard NO se aplica», pero `puedeCerrarConDocumentos` solo eximía cuando la
  fecha existía: con `null` aplicaba a todas las órdenes (y un test lo fijaba así).

Consecuencia medida (memorias 2026-08-02 y 2026-08-16): ningún conductor ni
transportista puede cerrar una entrega, ninguna pantalla sube el documento que
desbloquearía el cierre, y en toda la historia de producción hay **cero
certificados emitidos**.

## 2. Cimiento

ADR-070 §cierre («solo para órdenes creadas tras el feature (O-7); las órdenes
legacy/en-curso quedan exentas») y `.specs/repositorio-documental-transporte/spec.md`
§O-7 («comparar `viajes.creado_en` ≥ fecha de corte … no bloquear viajes en ruta
sin documento»). La precondición nace con el rollout y su fecha; sin fecha no hay
cohorte a la que aplicarla. Este fix alinea el código con el ADR; no lo reabre.

## 3. Entradas y salidas

- Entrada: `FlagsCierreDocumental` con `requireDocumentSince: null` y flag ON.
- Salida: `{ puedeCerrar: true, razon: 'sin_fecha_de_corte' }`, antes de mirar
  documentos o TED. Con fecha configurada, comportamiento idéntico al anterior.
- Nueva razón `sin_fecha_de_corte` en `RazonCierre` para que el log del cierre
  distinga «guard apagado por flag» de «guard sin cohorte».

## 4. Criterios de salida

- [x] Test rojo exhibido para `null` → cierra sin documento (y sin exigir TED).
- [x] Test de no-regresión con fecha configurada → sigue exigiendo documento.
- [x] Suite unitaria completa de `apps/api`, typecheck y biome en verde.
- [ ] Verificación en prod tras el próximo deploy manual: una entrega real
      cierra sin 409 mientras `_SINCE` siga ausente.

## 5. Fuera de alcance

- Definir la fecha de corte del rollout (decisión del PO cuando exista la UI de
  subida de documentos, etapa E3 del plan).
- La UI de subida de documentos (oficina o conductor).
