# Spec — bootstrap-platform-admin (Gap A del alta de usuarios)

**Fecha**: 2026-07-07 · **Rama**: `feat/bootstrap-platform-admin` (desde `origin/main@43a5af0`) · **Origen**: `docs/corfo/hito-2/diagnostico-alta-usuarios.md` §7 (2ª pasada), decisión de alcance del PO del mismo día (Workstream 1 del corte mínimo).

## Problema

No existe ningún mecanismo reproducible en el repo que cree y habilite al **primer platform admin** — el actor que aprueba todas las altas (ADR-052 lo asume como precondición sin diseñar su nacimiento). Consecuencia encadenada: sin admin operable no hay approve, sin approve no hay alta de NINGÚN usuario (diagnóstico §3 Gap A, §7.1).

Es un arreglo de **diseño** (mecanismo versionado, testeado, re-ejecutable), no un UPDATE de datos ad-hoc.

## Entradas

- `--email` (debe estar en la allowlist `BOOSTER_PLATFORM_ADMIN_EMAILS` provista por env — el script NO edita la allowlist; su fuente de verdad es Terraform).
- `--rut` (cualquier formato aceptado por `ensureRutHasDash` + `rutSchema`; se persiste en forma canónica).
- `--full-name`.
- Clave numérica (6 dígitos): env `BOOTSTRAP_ADMIN_CLAVE` o prompt TTY oculto con doble confirmación. **Jamás por argv.**
- Flags: `--rotate-clave` (reemplaza clave existente; sin él, clave ya seteada = no-op), `--dry-run` (reporta sin escribir).
- Contexto de ejecución: ADC (Firebase Admin SDK) + `DATABASE_URL` (túnel IAP a db-bastion). Operador humano, no CI.

## Salidas

- Cuenta Firebase para el email (creada o reutilizada).
- Fila `usuarios` reconciliada: `firebase_uid` correcto, `email`, `full_name`, `rut` canónico, `clave_numerica_hash` (scrypt real), `is_platform_admin=true`, `status='activo'`.
- Reporte por stdout de cada acción (`created`/`reconciled`/`unchanged` + detalle) y exit code 0; cualquier abort = exit 1 sin escrituras parciales (transacción).

## Criterios de éxito (binarios)

1. **Desde cero**: BD sin fila y Firebase sin cuenta → una corrida deja al admin en estado tal que `POST /auth/login-rut` con `{rut, clave}` responde `200 + custom_token` (contrato exacto de LoginUniversal) y `requirePlatformAdmin` acepta su contexto → puede aprobar una solicitud (`POST /admin/signup-requests/:id/approve` → `200 outcome=approved`).
2. **Idempotencia**: segunda corrida con la misma entrada → `unchanged`, cero escrituras.
3. **No destructivo**: RUT ya declarado y distinto → abort. RUT perteneciente a OTRO usuario → abort. Email fuera de allowlist → abort. Clave existente sin `--rotate-clave` → no-op. Nunca borra ni pisa credenciales silenciosamente.
4. **Verificación en prod** (Workstream 3): script corrido por el owner → admin entra por la UI real (tarjeta Booster, RUT+clave) → aprueba `piloto-smoke`. Evidencia capturada.

## No-alcance

- Editar la allowlist (Terraform, decisión PO).
- Tocar passwords de Firebase (el admin opera con RUT+clave; Google queda de fallback legacy).
- Modificar un RUT ya declarado (espeja la inmutabilidad de `PATCH /me/profile`).
- Email real de notificación (Fase 2, desviación 8 ya declarada).

## Diseño

- **Service testeable**: `apps/api/src/services/bootstrap-platform-admin.ts` — toda la lógica; recibe `db`, `firebaseAuth` (interface `Auth`), `logger`, `allowlist`, `input`. Reutiliza: `rutSchema`/`ensureRutHasDash` (`shared-schemas/primitives/chile.ts`), `hashClaveNumerica`/`isValidClaveFormat` (`services/clave-numerica.ts`), schema `users` de Drizzle.
- **CLI fino**: `apps/api/scripts/bootstrap-platform-admin.ts` — patrón `classify-google-idp-accounts.ts` (tsx, ADC, pg.Pool). Solo parsing de args, prompt de clave, wiring y reporte.
- **Runbook**: `docs/qa/runbook-bootstrap-platform-admin.md`.

## Testing (TDD — dominio crítico auth; rojo exhibido en el PR)

`apps/api/test/integration/bootstrap-platform-admin.integration.test.ts` sobre la infra existente (`createTestDb` + migraciones reales de `setup-global.ts`; Postgres real vía `TEST_DATABASE_URL`). **Firebase Auth = stub in-memory del interface `Auth`** (declarado: el tramo Firebase real lo cubre el smoke del Workstream 3 en prod; test con emulator = hardening fechado próxima semana). Los tests materializan los criterios 1-3 montando las rutas reales (`createAuthUniversalRoutes`, `createAdminSignupRequestsRoutes`) con `resolveUserContext` real.

## Riesgos declarados

- Local sin Docker: integration corre contra PG efímero local (17) y en CI contra PG 15 (autoridad).
- `createCustomToken` real (Firebase) no se ejercita en tests — cubierto por smoke prod (WS3).
- La ejecución en prod requiere ADC del owner y túnel a la BD; el agente NO la ejecuta (gate humano).
