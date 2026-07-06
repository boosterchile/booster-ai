# LoginUniversal — no honra `?redirect=` (gate antes de flipear auth_universal_v1_activated)

**Dimensión**: web / auth · **Estado**: pendiente, gated por el flip del flag `auth_universal_v1_activated` (default OFF).
**Fuente**: review W1.3 hito-2 (2026-07-06), commit 0fce642.

## Problema

W1.3 hizo que el flujo de login legacy preserve `?redirect=` (con `safeRedirectTarget` anti open-redirect) para que el link de onboarding-admin sobreviva el round-trip por login. `LoginUniversal.tsx` (flujo RUT+clave, flag `auth_universal_v1_activated` default OFF en `use-feature-flags.ts:51`) NO fue cableado: si el flag se enciende, un aprobado que abra su link `?token=` sin sesión y caiga en el login universal perderá el destino y aterrizará en `/app` sin consumir el token.

## Impacto

Hoy ninguno (flag OFF). Al flipear el flag, rompe el E2E de onboarding admin-provisioned para usuarios sin sesión.

## Plan de pago

En el MISMO PR que encienda `auth_universal_v1_activated`:
1. Replicar en `LoginUniversal` el patrón `postLoginTarget`/`safeRedirectTarget` de `login.tsx:827-835`.
2. Test: login universal con `?redirect=/onboarding-admin?token=X` → navega al destino con token intacto; redirect externo → `/app`.
3. De paso (minors del mismo review): `login.tsx:80` con sesión activa ignora `postLoginTarget`; cubrir con tests los bypass `//` y `\` de `safeRedirectTarget`.
