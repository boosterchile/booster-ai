# Spec — Runbooks y on-call (T10-18)

Programa TRL 10, fase C ([ADR-082](../../docs/adr/082-objetivo-trl10-supersede-precomercial.md), `.specs/trl10/spec.md`).

## Entradas

- `docs/runbooks/` tiene `service-*.md` y runbooks de procedimiento, sin ventana
  de respuesta declarada, sin plantilla de post-mortem y sin runbooks de
  mandato de cobro ni de huella/certificados GLEC.
- Ventana de respuesta fijada por el PO el 2026-10-08: hábil L–V 09:00–19:00
  America/Santiago con acuse ≤ 1 h; fuera de horario solo P0, acuse ≤ 30 min
  best-effort.

## Salidas

- `docs/runbooks/on-call.md`: ventana, severidades P0/P1/P2 mapeadas a las
  alertas existentes, circuito de incidente, límites de ADR-076.
- `docs/runbooks/post-mortem-template.md`: plantilla sin culpas → `docs/incidents/`.
- `docs/runbooks/incidentes-glec.md`: 4 escenarios (certificados no emitidos,
  huella degradada, certificado incorrecto, `/verify`).
- `docs/runbooks/mandato-de-cobro.md`: estado real (modo conector, flag aún no
  implementado), activación, salida de emergencia, tabla de incidentes.
- Índice `docs/runbooks/README.md` actualizado.

## Criterios de éxito

- [x] Los cuatro archivos existen y el índice los enlaza.
- [x] Cada referencia a código, alerta o ADR existe en el repo, o se marca
      explícitamente como pendiente de un PR abierto (#747, #749, #754, T10-25).
