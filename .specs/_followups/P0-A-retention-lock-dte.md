# P0-A 🔒 — Retention Lock DTE/SII en `false`

> ✅ **MOOT / SUPERSEDED por [ADR-069](../../docs/adr/069-deprecate-dte-emission-sovos.md) (2026-06-22)**. El gate `is_locked=true`
> se condicionaba a "emisión real de DTE en prod". El PO pivoteó el negocio: Booster
> deja de ser **EMISOR** de DTE (ADR-069, frente F3 mergeado) → pasa a
> **receptor/archivador**. ADR-069 §4 declara explícitamente **"P0-A no aplica"** y
> obsoleta `.specs/sec-h3-dte-retention-lock`. La retención de documentos de TERCEROS
> que Booster archiva (otra obligación: custodio, no contribuyente) se maneja bajo la
> política **O-3** del frente F4 (ancla a `fecha_emision`, ADR-070), ya en prod. Este
> stub queda como registro histórico — sin acción de lock WORM mientras no haya emisión.

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
