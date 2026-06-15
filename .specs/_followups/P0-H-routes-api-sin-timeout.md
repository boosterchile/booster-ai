# P0-H — Google Routes API sin timeout (agota concurrencia Cloud Run)

> ✅ **RESUELTO en #468** (merged 2026-06-14). `AbortController` 10s + code `timeout` en `RoutesApiError`, patrón de `gemini-client.ts`. TDD: `routes-api.test.ts` (11 tests).

**Dimensión**: sre · **Esfuerzo**: S · **QUICK WIN**
**Fuente**: audit 2026-06-14

## Problema
`apps/api/src/services/routes-api.ts:179`: `fetch()` a Google Routes API sin `AbortController`/timeout. Es el único cliente HTTP externo del repo sin timeout (Twilio, Sovos, Gemini sí lo tienen).

## Impacto
Una degradación de Routes API (respuesta >30s) bloquea slots de concurrencia del Cloud Run del API indefinidamente → cascada de latencia en el camino de tracking público.

## Plan de pago
1. Copiar el patrón existente de `gemini-client.ts:88-90` (AbortController + timeout 8-10s).
2. Manejar el `AbortError` con log estructurado + métrica + fallback explícito (no swallow).
3. Test del path de timeout.

## NO ejecutar ahora
Quick win recomendado, pero fix aparte (rama + PR + evidencia). Diagnóstico.
