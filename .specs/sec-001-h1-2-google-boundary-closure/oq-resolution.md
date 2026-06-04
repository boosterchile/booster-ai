# OQ resolution (T3 / SC-G3, gates pre-/build)

- **Spec**: [`spec.md`](./spec.md) §12 · **Plan**: [`plan.md`](./plan.md) T3
- **Date**: 2026-06-04 · **Decisor**: Felipe Vicencio (PO), confirmado 2026-06-04
- Resuelve los 3 OQ que el DA Round 2 dejó como gates antes de `/build` del reaper.

## OQ-G1 — `REAPER_GRACE_DAYS` → **30 días** (justificado por dato, no por SLA imaginada)

**Dato (query prod via bastion, read-only, 2026-06-04):** `solicitudes_registro` está **VACÍA** (total=0; aprobadas=0; pendientes=0; rechazadas=0). El flujo signup-request (ADR-052) **nunca se usó en prod** (frontend no cableado; pilotos provisionados a mano).

**Conclusión (confirma P1-2 del DA):** no existe latencia de aprobación empírica que derive el grace, porque no hay aprobaciones. La población que el grace realmente protege es **self-signup Google SIN solicitud** (el vector H1.2) — sin fila `solicitudes`, solo el timer los protege.

**Decisión:** `REAPER_GRACE_DAYS = 30`. Rationale explícito (no un número al azar):
- Holgado contra cualquier onboarding manual y contra la ventana de account-linking legítimo (un usuario Google que aún no pegó `/me` para linkear su `firebase_uid`), reforzada por el `lastSignInTime` guard.
- `disable-before-delete` (decidido) lo hace reversible: aunque el grace fuera corto, el primer paso no destruye.
- **Revisar cuando el flujo signup-request se active** (Stream B) — ahí sí habrá latencia real para calibrar.

## OQ-G6 — normalización del match → **(b) matchear la forma degradada guardada**

**Contexto:** no existe un `normalizeEmail` canónico único (3 writers divergentes: `me.ts`/`onboarding.ts` crudo, `signup-request.ts` lowercase+trim, `email-normalize.ts` NFC+IDN sin dots/plus). `users.email` se guardó **crudo o lowercase**, nunca canónico.

**Decisión:** el reaper compara el email **case-insensitive (lowercase+trim)** y el hard-guard rehúsa reapear si la cuenta IdP matchea una fila `users` por **raw OR lowercase** (inclusivo → no pierde filas legítimas). Se **dropean las claims NFC/IDN/plus-tag** (el dato nunca las tuvo).
- Rationale: el dual-guard es una salvaguarda de seguridad → debe ser **inclusivo**; un lookup canónico más estricto que el dato guardado podría **no matchear** una fila cruda → false-positive reap (el riesgo que marcó el DA). Matchear la forma guardada es lo seguro.
- El normalizador compartido real + **backfill** de `users.email`/`solicitudes` se **difiere a Stream B** (que rediseña signup/onboarding y ya toca esos write paths — lugar correcto para introducirlo sin scope-creep en un job de higiene).
- **Impacto en el plan:** **T6 se disuelve** (no se extrae normalizador acá); su lógica de match degradado se absorbe en **T7** (predicado del reaper).
- **T11 del spec** (test de normalización) se ajusta: probar que el match lowercase+trim captura `Foo@x.cl`≡`foo@x.cl` (caso realista, capitalización Gmail) y que NO depende de NFC/IDN/plus.

## OQ-G3 — scope del reaper → **Google-only (+ email-present + dual-match)**

**Decisión:** el reaper solo considera cuentas IdP cuyo `providerData` incluye **`google.com`**, **Y** con email presente, **Y** aplica el dual-match contra `users` (uid+email).
- Rationale: email/password self-signup está **OFF** (Sprint 2b) → Google es el **único provider auto-creado**; apunta exactamente al vector H1.2.
- **Elimina estructuralmente R-G8** (phone/SAML sin email matchearían el predicado trivialmente — Google-only los excluye; y un Google account siempre tiene email).
- No hay otro provider auto-creado (login conductor = RUT+PIN por custom token, no phone-provider). Provider-agnostic sería diseñar para un futuro hipotético (CLAUDE.md anti-pattern); si se re-habilita otro self-signup, esa decisión revisita el scope del reaper.

## Estado
**Las 3 OQ resueltas y confirmadas por el PO.** Gate de `/build` del reaper desbloqueado (T3 done). Próximo: T2 (harness), T4 (clasificación), T5 (ADR), luego T7/T8 (reaper con G1=30d, G6=match-degradado, G3=Google-only).
