# P0-C 🔒 — Firebase UIDs reales (PII) hardcoded y versionados

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
