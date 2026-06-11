# Plan: fix-xff-trust-boundary

- Spec: .specs/fix-xff-trust-boundary/spec.md
- Created: 2026-06-11
- Status: Complete

### T1: middleware/client-ip.ts (canónico) + tests [DONE 2026-06-11]
### T2: rate-limit-pin/signup + demo-cache-warm + me.ts (consent IP) al util; test viejo del bug corregido [DONE 2026-06-11]

Hallazgo extra durante build: me.ts:568 usaba XFF[0] para la IP de evidencia
de consentimiento Ley 19.628 (falsificable por el propio cliente) — incluido.
