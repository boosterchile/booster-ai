# Follow-up: migrar zod 3 → 4 (GHSA-mrhx-c7xc-m3w5)

**Dimensión**: security / dependencias · **Estado**: abierto, riesgo aceptado de forma temporal (sujeto al visto del PO) · **Fuente**: corrida programada de `security.yml` del 2026-10-26 (run 40292341404), que corta la racha de T10-07 en `.specs/trl10/spec.md` · **Revisión**: a más tardar el 2026-12-31.

## Problema

GHSA-mrhx-c7xc-m3w5 (CVE-2023-54404, high, CWE-770, impacto solo en disponibilidad): zod acumula un issue por cada elemento inválido de un arreglo, sin tope ni corte temprano. GitHub la revisó el 2026-10-23 con rango `< 4.6.6`. La última 3.x es 3.25.76 y no hay parche en esa línea. Todo el monorepo usa 3.25.76 (11 `package.json`), y `pnpm audit --prod` y Trivy la marcan por `apps/api`.

Mientras no se migre, la advisory queda en `auditConfig.ignoreGhsas` (`pnpm-workspace.yaml`) y en `.trivyignore`, con su justificación. El análisis de exposición en los servicios de Booster se entregó al PO por canal privado, porque el repo es público.

## Qué corrige 4.6.6 (medido en local, 2026-10-29)

Arreglo de un millón de elementos inválidos (cuerpo JSON de ~2 MB), Node 24:

| zod | Esquema | Issues | Heap |
|---|---|---|---|
| 3.25.76 | `z.array(item)` | 1.000.000 | ~350 MB |
| 3.25.76 | `z.array(item).max(50)` | 1.000.001 | ~300 MB |
| 4.6.7 | `z.array(item)` | 1.000.000 | ~450 MB |
| 4.6.7 | `z.array(item).max(50)` | 1 | ~0 MB |

En zod 3, `.max()` no corta: valida todos los elementos igual. Desde 4.6.6, una restricción de largo que falla aborta antes de validar los elementos. **Migrar no alcanza por sí solo**: hay que acotar con `.max()` los arreglos de los esquemas de entrada.

## Costo medido de la migración

Copia aparte de `main` (1b10cfa3) con `zod ^4.6.7` en los 11 `package.json` y `@hookform/resolvers ^5`:

- **Superficie**: 123 archivos importan zod (`shared-schemas` 45, `api` 41, `web` 19, `config` 8, resto 10).
- **Typecheck**: 35 errores únicos en unos 10 sitios. `z.record` de un argumento (5), `invalid_type_error` (3), introspección de `_def.checks` en `shared-schemas/src/avl-ids/equipo-telemetria.ts` y la firma genérica de `packages/config/src/parseEnv.ts` (`ZodTypeDef`).
- **Tests**: 73 rojos en 16 archivos, de unos 5.500. `api` 57, `shared-schemas` 8, `document-service` 5, `web` 1, `telemetry-processor` 1, `telemetry-tcp-gateway` 1.
- **Causas de los rojos**:
  1. `z.string().uuid()` es estricto en v4 (exige versión y variante RFC): rechaza IDs como `00000000-0000-0000-0000-000000000001` con 400. Son 58 usos. `z.guid()` conserva la semántica de v3.
  2. El cuerpo 400 de `@hono/zod-validator` sin hook cambia de forma: v3 serializa `error.issues` (arreglo); v4 serializa `error.name` y `error.message` (texto JSON). Es un contrato público de la API.
  3. Cambian los mensajes por defecto, y `invalid_type_error`, `required_error` y `errorMap` pasan a `error`. Afecta mensajes en español que llegan a la UI.
  4. `@hookform/resolvers` 3.10 solo acepta zod 3. Hay que subir `web` a 5.x (major), que arrastra `ajv` → `fast-uri` con 7 GHSA high: necesita override `fast-uri >= 3.1.7`.
- **Siguen funcionando, deprecados**: `.strict()` (7), `.passthrough()` (13), `.merge()` (5), `.email()` (17), `.url()` (32).
- `@tanstack/router-plugin` (dependencia de desarrollo de `web`) sigue trayendo zod 3; no cuenta para `--prod`.
- **Estimación (inferida)**: uno a dos días de trabajo, más dos decisiones del PO (puntos 1 y 2).

## Plan de pago

1. Spec en `.specs/zod-4/` con las decisiones del PO: forma del cuerpo 400 (hook común que conserve `error.issues` o contrato nuevo) y `z.uuid()` estricto o `z.guid()`.
2. Migrar `packages/shared-schemas` y `packages/config`, después las apps, con `@hookform/resolvers` 5 y el override de `fast-uri`.
3. Acotar con `.max()` los arreglos de los esquemas de entrada.
4. Quitar `GHSA-mrhx-c7xc-m3w5` de `auditConfig.ignoreGhsas` y las dos líneas de `.trivyignore`. `pnpm audit --audit-level=high --prod` en verde sin la excepción.
