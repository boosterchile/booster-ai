# Follow-up: `npm audit (HIGH+)` y Trivy en rojo por CVEs de dependencias

**Dimensión**: security / dependencias · **Estado**: pendiente · **Fuente**: CI de #739 (2026-10-06); fallan igual en `main` (security.yml run 37293367416, donde además falla Gitleaks).

## Problema

`pnpm audit --audit-level=high --prod` reporta, con el lockfile actual:

| Severidad | Paquete | Vía | Versión parchada |
|---|---|---|---|
| critical | `seroval` (GHSA-p6vx-979v-rg4c, GHSA memoria TypedArray) | `apps/web > @tanstack/react-router > @tanstack/router-core` | ≥ 1.6.2 |
| high | `@grpc/grpc-js` (GHSA-m9gg-hp2v-232j) | `apps/api > @google-cloud/kms > google-gax` | ≥ 1.14.5 |
| high | `@fastify/busboy` ×2 (GHSA-xjh9-v7x6-24jw, GHSA-x8mw-p69m-v3mx) | `apps/api > firebase-admin` | ≥ 3.2.1 |
| high | `node-forge` (GHSA-86w9-cpqp-85rv) | `apps/api` directo | **sin parche** (`<0.0.0`) |

El job «Trivy filesystem + config scan» termina con exit 1 en el scan de filesystem; con severidad HIGH,CRITICAL sobre el lockfile es la misma clase de hallazgo. El detalle de Trivy no se extrajo del log en esta pasada.

## Por qué no se arregló en #739

Son CVEs del lockfile, previas a la rama y presentes en `main`. Subir dependencias transitivas es un cambio aparte, con su propio riesgo y su propia verificación. El job lo contempla: «si no se puede arreglar, documentar en el PR más issue con tracking». No bloquea el merge: los checks obligatorios de `main` son `CI Success` y `E2E conductor`.

## Plan de pago

1. `pnpm.overrides` en el `package.json` raíz (ya existe el bloque): `seroval@>=1.6.2`, `@grpc/grpc-js@>=1.14.5`, `@fastify/busboy@>=3.2.1`. `pnpm install`, suite completa, `pnpm audit --prod`.
2. `node-forge`: no hay versión parchada. Ver quién lo usa en `apps/api` (`grep -rn "node-forge" apps/api/src`) y decidir reemplazo o aceptación documentada del riesgo.
3. Si quedan hallazgos sin parche, `.trivyignore` / `pnpm audit` allowlist con fecha y motivo, nunca en silencio.
4. Gitleaks en `main`: revisar el hallazgo del run 37293367416 por separado.
