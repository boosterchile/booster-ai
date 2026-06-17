# P0-E — Sin aislamiento Firebase/reCAPTCHA dev vs prod

**Dimensión**: security · **Esfuerzo**: M
**Fuente**: audit 2026-06-14

## Problema
`apps/web/.env.local:18`: `VITE_RECAPTCHA_SITE_KEY` real de producción (prefijo `6Lc5B…`). NO trackeado en git (`.gitignore` lo excluye, confirmado), pero el comentario "La actual está asociada al proyecto de prod — revisar al migrar a dev" revela una sola cuenta Firebase/reCAPTCHA sin separación de ambientes. Relacionado: P2-5 (App Check debug token activo en DEV → válido contra prod si el proyecto es compartido).

## Impacto
Las acciones de desarrollo golpean el proyecto de producción (reCAPTCHA, App Check, Auth). Los debug tokens de App Check serían válidos contra prod.

## Plan de pago
1. Crear proyecto Firebase separado para dev.
2. Rotar la site key reCAPTCHA de prod (estuvo en entorno de desarrollo).
3. Completar `.env.local` apuntando al proyecto dev.
4. Verificar que el App Check debug token (P2-5) solo aplique al proyecto dev.

## NO ejecutar ahora
Requiere crear infra GCP/Firebase nueva + rotación de credenciales. Diagnóstico.
