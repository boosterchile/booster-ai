# P0-A 🔒 — Retention Lock DTE/SII en `false`

**Dimensión**: security / sre · **Estado**: CONGELADO legal — requiere versionado + revisión legal, NO editar directo.
**Fuente**: audit 2026-06-14 (`.specs/revision-completa-2026-06-14/review.md`)

## Problema
`infrastructure/storage.tf:145-151` y `crash-traces.tf:86`: `retention_policy { retention_period = 189216000; is_locked = false }`. La política de 6 años existe pero no está bloqueada (WORM). Un admin GCP puede destruir DTEs antes del plazo legal.

## Impacto
Viola Código Tributario Art. 17 + Resolución SII Exenta N°45 **si hay DTEs reales emitidos**. Hoy `DTE_PROVIDER=disabled` y el bucket está vacío → el gate del comentario es válido y NO es bloqueante todavía.

## Plan de pago (gated)
El PR que active `DTE_PROVIDER=sovos` (primer DTE real) DEBE, en el mismo PR:
1. Cambiar `is_locked = true` en ambos buckets (irreversible — verificar bucket correcto).
2. Sign-off del PO + asesor legal documentado.
3. Versionar la decisión en ADR-007.
Paquete coordinado con P1-F (subscription/DLQ `document-events`) y P1-G (alerta emisión fallida).

## NO ejecutar ahora
Activar el lock sobre un bucket es irreversible. No tocar hasta el sign-off legal + decisión de activar Sovos.
