# Followup: translate-auth-error-unify

**Status**: ✅ **RESUELTO (2026-06-22)** vía **Opción B** (colocación, copy verbatim).
**Created**: 2026-05-27 by Sprint 2c-B T2 PR (per plan v4 F-B1 acceptance — option (a) login-domain-only extraction; AuthProvidersSection.tsx untouched).

## Resolución (Opción B, sin cambio de UX)

`apps/web/src/lib/translate-auth-error.ts` ahora exporta **dos** funciones en el
mismo módulo: `translateLoginAuthError` (rename de la de login, `+message`) y
`translateProviderAuthError` (extraída **verbatim** desde `AuthProvidersSection.tsx`).
El componente importa la segunda y borró su función inline; `login.tsx` usa la primera.
**Copy preservado byte a byte** → sin reconciliación UX necesaria (la divergencia por
dominio es intencional y queda fijada por tests, incl. un invariante explícito de que
`auth/email-already-in-use` produce copy distinto en cada dominio). Resuelto antes de
"Post-Sprint-2c-B" porque es un refactor de comportamiento idéntico (riesgo nulo para
el sprint). Evidencia (node 24): web 110 files/1047 passed (47 del módulo), typecheck 0,
biome 0. **La sub-decisión fail-closed NO aplica a este finding** (era de booleanFlag).

---

## Objetivo

Unificar las DOS implementaciones de `translateAuthError` que viven en distintos dominios apps/web:

1. **Login/signup domain** — `apps/web/src/lib/translate-auth-error.ts` (extraído en Sprint 2c-B T2 desde `apps/web/src/routes/login.tsx`). 10 cases canonical + 1 case `auth/internal-error` con `BLOCKED_SIGNUP_PENDING_APPROVAL` substring detection.
2. **Provider-linking domain** — `apps/web/src/components/profile/AuthProvidersSection.tsx:598-621` (inline function NO extraída). 10 cases para flujos linkWithCredential / unlink / re-link de providers OAuth.

Las DOS funciones overlap en **5 códigos** pero producen **distinto copy en español** para al menos `auth/email-already-in-use`:
- Login domain → "Ya existe una cuenta con ese email. Inicia sesión."
- Linking domain → "Esa cuenta ya pertenece a otro usuario de Booster. Cerrá sesión y entrá con esa cuenta directamente."

## Por qué no se unificó en Sprint 2c-B T2

Per plan v4 F-B1 fix:
> "different domains (login vs provider-linking) with different Spanish copy for overlapping codes. Forcing unification requires UX-copy reconciliation that is out-of-scope for 2c-B."

Sprint 2c-B T2 narrowed scope a login-domain-only extraction. AuthProvidersSection.tsx no se tocó.

## Opciones de unificación

### Option A — Single function con context discriminant

```typescript
export function translateAuthError(
  code: string | undefined,
  context: 'login' | 'provider-linking',
  message?: string,
): string | null { ... }
```

Pro: una sola tabla; less drift risk.
Con: cada call site debe pasar `context`; switch interno crece.

### Option B — Dos funciones exportadas del mismo módulo

```typescript
export function translateLoginAuthError(code, message?): string | null { ... }
export function translateProviderAuthError(code, message?): string | null { ... }
```

Pro: clear domain separation; cada uno tiene su propia tabla.
Con: duplica codes que pueden coincidir; pero permite copy diferenciado por dominio (probablemente el correcto trade-off para UX).

### Option C — Status quo

Mantener separados; agregar tests de no-regression en cada función; documentar en este followup que es deliberado.

## Recomendación

**Option B** preferida. Razón: las copies divergentes existen por motivo de UX (provider-linking errors necesitan messaging que apunte a "cerrá sesión y entrá con esa cuenta directamente"; signup errors apuntan a "inicia sesión"). Forzar single-context loses this affordance.

## Acceptance criteria si se ejecuta

- `apps/web/src/lib/translate-auth-error.ts` exporta `translateLoginAuthError` (rename del current) + `translateProviderAuthError` (extraído desde AuthProvidersSection.tsx).
- `apps/web/src/components/profile/AuthProvidersSection.tsx` modificado: remove inline function + import desde new module.
- Tests: 20+ casos cross-domain (10 login + 10 linking + overlap verification).
- UX copy review: PO valida que ambas variantes preservan intent del dominio.
- Cross-source-literals.test.ts (creado en Sprint 2c-B T2) sigue passing.

## Trigger (cuándo ejecutar)

- Post-Sprint-2c-B CERRADO (gate-friendly: no production impact).
- O cuando una de las dos funciones gane un caso new que también merece la otra (drift signal).

## Notas

- Bajo prioridad. Las dos funciones funcionan correctamente en sus dominios.
- Si pasa >180 días sin ejecutar, PO debe re-evaluar si la duplicación se acepta de facto.
