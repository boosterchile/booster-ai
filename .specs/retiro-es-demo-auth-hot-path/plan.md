# Plan: retiro-es-demo-auth-hot-path

Spec: `.specs/retiro-es-demo-auth-hot-path/spec.md`

## Orden

1. Exportar `findHotPathDemoEnforcement` (código sin comentarios) y un test que lee `apps/api/src/server.ts` y espera `[]`. Correrlo en rojo contra el cableado actual.
2. Quitar de `server.ts` imports, instancia y mounts de `demoExpiresMiddleware` e `isDemoEnforcementMiddleware`.
3. Hacer que `main()` del script use el veredicto nuevo (exit 1 si hay hits). Reescribir los tests que exigían el wire.
4. Ajustar comentarios que describirían un chain que ya no existe (`server.ts`, `config.ts`, `firebase-auth.ts`, `chat.ts`, `admin-signup-requests.ts`).
5. Nota corta en los dos módulos: no se montan en el request productivo.
6. Typecheck + lint del package `api` y vitest de los tests tocados.

## Fuera de este plan

No se edita `.github/workflows/security.yml`. El job `is-demo-wire-completeness` sigue llamando al mismo script.
