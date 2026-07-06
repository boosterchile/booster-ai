# Login — retirar botón legacy "Crea una" (self-signup Firebase dead-end)

**Dimensión**: web / ux / security-postura · **Estado**: pendiente, gated por activación W1.
**Fuente**: review W1.2 hito-2 (2026-07-06); SC3 de `.specs/onboarding-flow-redesign/` (self-onboarding nunca se reenciende).

## Problema

`apps/web/src/routes/login.tsx` conserva el botón legacy "Crea una" que dispara el self-signup directo de Firebase. Con `EMPRESA_SELF_ONBOARDING_ENABLED=false` permanente (SC3), ese camino crea una cuenta Firebase que muere en el dead-end `/onboarding` (403). Desde W1.2 convive con el flujo correcto ("¿No tienes cuenta? Solicita acceso" → `/solicitar-acceso`), lo que confunde: dos CTAs de alta, uno funcional y otro trampa.

## Impacto

- UX: usuarios nuevos pueden elegir el camino muerto y quedar con cuenta Firebase huérfana (las recoge el reaper de ADR-057, pero es fricción evitable).
- Postura: mantiene superficie de creación de cuentas IdP sin propósito.

## Plan de pago

Tras activar W1 (flip aprobado por el PO) y verificar el E2E del flujo solicitar-acceso→approve→onboarding-admin en prod:
1. Retirar el botón "Crea una" y su handler de `login.tsx` (+ tests).
2. Dejar `/solicitar-acceso` como único CTA de alta.
3. Opcional: redirect de la página vieja `/onboarding` hacia un mensaje que apunte a solicitar-acceso.
