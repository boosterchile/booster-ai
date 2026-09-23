# Spec — Alineación del contrato del agente

**Estado**: aceptada por el PO el 2026-09-23 (autorización explícita para editar `CLAUDE.md` y lo que ya no calza con ADR-069, ADR-076 y ADR-078).

## Entradas

- `CLAUDE.md` reescrito el 2026-07-06 (ADR-072), con el bloque de frentes vivos añadido después.
- `AGENTS.md` como segundo contrato que todavía nombra a Claude como herramienta primaria e invita a usar plugins.
- `docs/handoff/CURRENT.md` congelado el 2026-07-25.
- Decisiones ya vigentes: ADR-069 (sin emisión DTE), ADR-076 (vigencia y checks en `main`), ADR-078 (el repo no activa plugins).

## Salidas

- `CLAUDE.md` nombra al agente, no a una herramienta. Describe auth Firebase + RUT (ADR-028/035), saca DTE/SII del dominio crítico, separa el merge por checks del gate humano de deploy, y dice dónde corre cada verificación (pre-commit, CI, plan de Terraform).
- `AGENTS.md` queda como índice que apunta a ese contrato.
- `docs/frentes-vivos.md` remite las excepciones de slot al contrato.
- `docs/handoff/CURRENT.md` cabe en ~150 líneas y fecha el estado al 2026-09-23. El texto del 2026-07-25 queda en un snapshot.

## Criterios de éxito

1. El contrato no cita «JWT Zero-Trust» ni lista DTE/SII como dominio crítico de TDD.
2. El contrato no pide buscar `superpowers` ni `booster-skills`.
3. Un incidente, un arreglo de seguridad, el propio contrato y un pedido explícito del PO no quedan congelados por los tres slots.
4. `docs/handoff/CURRENT.md` tiene como máximo ~150 líneas y no presenta el 2026-07-25 como si fuera hoy.
5. Ningún ADR se edita. Los quality gates de `.github/workflows/` no se tocan.
