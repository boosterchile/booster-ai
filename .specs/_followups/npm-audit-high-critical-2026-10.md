# Follow-up: `npm audit (HIGH+)` y Trivy en rojo por CVEs de dependencias

**Dimensión**: security / dependencias · **Estado**: resuelto 2026-10-06 en `fix/deps-audit-high-critical-2026-10` · **Fuente**: CI de #739 (2026-10-06); fallan igual en `main` (security.yml run 37293367416, donde además falla Gitleaks).

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

## Resolución (2026-10-06)

- `pnpm-workspace.yaml` overrides: `seroval@<1.6.2 → >=1.6.2` (resuelve 1.6.8), `@fastify/busboy@<3.2.1 → >=3.2.1` (3.2.2), y el pin existente de `@grpc/grpc-js` sube de 1.14.4 a 1.14.5.
- `node-forge` GHSA-86w9-cpqp-85rv: sin versión parchada. Riesgo aceptado con `auditConfig.ignoreGhsas` y justificación en el mismo archivo: la vulnerabilidad está en la verificación de firmas RSA y Booster solo usa node-forge para construir certificados y ASN.1 (`packages/certificate-generator`); no hay llamadas a `verify()`. Revisar cuando salga parche o si se agrega verificación.
- `pnpm audit --prod --audit-level=high`: exit 0 (quedan 20 de severidad baja o moderada).
- Trivy (`ignore-unfixed: true`) no cuenta node-forge por no tener fix; los otros tres quedan parchados. No se pudo correr en local (descarga de la DB bloqueada); lo confirma CI.
- Gitleaks en `main`: no se tocó en este cambio.
