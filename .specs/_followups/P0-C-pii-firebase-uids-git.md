# P0-C 🔒 — Firebase UIDs reales (PII) hardcoded y versionados

> ✅ **CÓDIGO RESUELTO en [#496](https://github.com/boosterchile/booster-ai/pull/496)** (`796c0c3`, merged). Los UIDs salen del código
> vivo: `apps/api/src/services/harden-demo-accounts.ts:59-73` los lee de
> `DEMO_OLD_UIDS` (env var validada por Zod, CSV), con inyección por `opts.oldUids`
> en tests. Spec: `.specs/p0c-uids-demo-secret-manager/`. Verificado en vivo
> contra `main` (2026-06-22).
> ⚠️ **Pendiente (legal, NO-código)**: la decisión sobre `git filter-repo` del
> historial sigue abierta (los UIDs persisten en commits previos) — ver §Plan de
> pago paso 2.

**Dimensión**: security · **Estado**: requiere revisión legal (PII en historial git).
**Fuente**: audit 2026-06-14

## Problema
`apps/api/src/services/harden-demo-accounts.ts:33-38`: cuatro Firebase UIDs reales como `OLD_DEMO_UIDS` (post-disclosure 2026-05-24, ADR-053). Versionados en código y retenidos en el historial git indefinidamente.

## Impacto
Los identificadores de usuario son PII bajo Ley 19.628. Persisten en el historial aunque se borren del HEAD.

## Plan de pago
1. Mover `OLD_DEMO_UIDS` a env var / Secret Manager (saca del código vivo).
2. Ticket legal: decidir si se requiere `git filter-repo` sobre el historial (decisión legal-técnica con asesor — reescribir historial de `main` tiene costo operacional alto).
3. Documentar la decisión.

## NO ejecutar ahora
`git filter-repo` sobre `main` es destructivo y requiere coordinación + sign-off. Diagnóstico solamente.
