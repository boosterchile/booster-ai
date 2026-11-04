# Spec: retiro-superficie-demo-t10-03 — la superficie demo sale del código, de CI y de Terraform

- Fecha: 2026-10-07
- Estado: Vigente
- Programa: TRL 10, fase A, criterio T10-03 (`.specs/trl10/spec.md`, ADR-082); Slot 2 de `docs/frentes-vivos.md`
- Antecedentes: `.specs/retiro-demo-codigo-muerto/`, `.specs/retiro-es-demo-auth-hot-path/` (#698, #711)

## 1. Problema

El criterio del Slot 2 / T10-03 exige que `grep -rl 'es_demo\|isDemo\|DEMO_\|demo\.boosterchile'` sobre `apps/`, `packages/` e `infrastructure/` devuelva cero archivos y que `demo.boosterchile.com` no tenga registro DNS ni recurso en Terraform. Al 2026-10-07 había 44 archivos. Lo que quedaba después de #698 y #711 era maquinaria sin lector:
- el middleware is-demo y sus cuatro gates de CI;
- el registro y el endurecimiento de cuentas demo, con su job de TTL y su scheduler;
- la ruta pública `/api/v1/demo/cache-warm`;
- el flag `demo_mode_activated` y su variable;
- los secretos demo, sus env del api y el subdominio.

## 2. Decisiones del PO (2026-10-07)

Autorizadas: retirar los gates demo de CI (`security.yml`), el contrato del flag (`GET /feature-flags`), el Terraform demo (incluido un IAM binding de secreto) y la columna `empresas.es_demo` por migración contract. Las 4 cuentas de `cuentas_demo` ya están deshabilitadas en Identity Platform, así que la herramienta que las endurecía se borra.

## 3. Entregas (dos PRs, por expand/contract)

**PR 1 — este.** No cambia el schema de BD.
- API: middleware `is-demo-enforcement` + allowlist; servicios `harden-demo-accounts`, `cuentas-demo`, `demo-account-ttl-alerter`; ruta `demo-cache-warm`; job `POST /admin/jobs/demo-account-ttl-alert`; config `DEMO_MODE_ACTIVATED` y `DEMO_OLD_UIDS`; `demo_mode_activated` de `/feature-flags`. El scorecard GPS deja de filtrar por `es_demo` (0 filas en true) y el alta de empresa deja de escribirlo (la columna tiene default `false`).
- Scripts y CI: `check-is-demo-*`, `check-allowlist-pr-guard`, `harden-demo-accounts.mjs`, `demo-dry-run.mjs`; los 4 jobs demo de `security.yml`. El parser `collectMiddlewaresPerPath` pasa a `scripts/collect-middlewares-per-path.ts`, porque lo usa el gate de impersonación, que se queda.
- `shared-schemas`: `domain/cuentas-demo.ts`.
- Web: el flag del hook, comentarios de ruteo y el enlace «Abrir demo» del editor de ajustes del sitio.
- Terraform:
  - salen las env `DEMO_*` del api, el origen CORS demo, los 9 secretos demo, el binding viewer de `github-deployer` sobre `demo-seed-password`, las 2 métricas + 2 alertas demo, el scheduler TTL, la variable `demo_mode_activated` y la host rule/path matcher demo;
  - **cert en dos pasos**: se agrega `google_compute_managed_ssl_certificate.principal` sin demo y el proxy sirve los dos certs.

**PR 2 — después del release del PR 1.**
- Migración contract: `DROP COLUMN empresas.es_demo` y `DROP TABLE cuentas_demo` + enum `persona_demo`, con TDD, rojo exhibido y corrida en seco.
- Tests de impersonación que prueban el desacople `es_demo`.
- Terraform paso 2, con `principal` ACTIVE: salen `main`, `cert_domains_con_demo` y `google_dns_record_set.demo`.

## 4. Por qué dos PRs

- **La columna:** durante el canario del release del PR 1, la revisión anterior (99 % del tráfico) sigue consultando `empresas.es_demo`. Borrarla en ese mismo release rompería esas consultas. La migración contract va en un release posterior, cuando ninguna revisión viva lee la columna.
- **El cert:** el proxy HTTPS tenía un solo certificado gestionado. Sacar `demo` de sus dominios crea un cert nuevo, que queda en PROVISIONING 15-60 minutos. Si el proxy apuntara solo a él, `api` y `app` quedarían sin TLS válido. El reemplazo sin corte es servir los dos certs hasta que el nuevo quede ACTIVE. El registro DNS demo se conserva hasta entonces, porque el cert viejo lo necesita para renovarse.

## 5. Criterios de éxito

PR 1:
1. `pnpm --filter @booster-ai/api test`, `@booster-ai/web test` y `@booster-ai/shared-schemas test` en verde; typecheck limpio en los tres.
2. `check-route-default-deny.ts` y `check-impersonation-wire-completeness.ts` en OK.
3. El grep del criterio solo encuentra `schema.ts`, los tests de impersonación ligados a la columna y el par cert/DNS de `networking.tf`, todos del PR 2.
4. `terraform fmt -check` limpio. `Terraform Drift Check`, después del apply, muestra solo la creación de `principal` y el cambio del proxy, más los destroys listados en §3.

PR 2: el grep del criterio devuelve 0 archivos y `demo.boosterchile.com` no resuelve.

## 6. Acciones del PO

- Release del PR 1 y luego `terraform apply`. Es irreversible para los secretos, así que va con un plan registrado antes (ADR-076).
- Quitar `demo.boosterchile.com` de los authorized domains de Identity Platform (es manual; Terraform los ignora).
- Confirmar que `principal` está ACTIVE (`gcloud compute ssl-certificates describe`) antes de mergear el PR 2.
