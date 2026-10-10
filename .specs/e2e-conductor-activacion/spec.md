# Spec: e2e-conductor-activacion — el E2E del conductor empieza por la activación

- Fecha: 2026-10-07
- Estado: Vigente
- Programa: TRL 10, fase A, criterio T10-02 (`.specs/trl10/spec.md`, ADR-082)
- Relacionado: `.specs/conductor-e2e-auth-emulator/` (E2E original, Slot 3 paso 6)

## 1. Problema

T10-02 exige que el flujo **activar → recogida → posición → entrega → certificado** tenga E2E Playwright verde en CI contra el API local. El E2E actual (`apps/web/e2e-conductor/flujo-conductor.spec.ts`) empieza en el login: el seed T2 crea al conductor ya activo, con cuenta Firebase y clave numérica. La activación, que es el paso donde hoy se cae prod (1 de 7 conductores activados al 2026-09-22), no se ejercita.

## 2. Entradas

- Seed T2 (`apps/api/scripts/seed-conductor-e2e.ts`), que corre antes de cada intento.
- Pantalla pública `/login/conductor` (`LoginConductorRoute`) y endpoint `POST /auth/driver-activate`, sin cambios.

## 3. Salidas

- **Seed:** el conductor T2 (`71717171-3`) queda en el estado en que lo deja el alta de su empresa (`POST /conductores`):
  - `usuarios.firebase_uid = 'pending-rut:71717171-3'`, sin `clave_numerica_hash`, `estado = 'pendiente_verificacion'`;
  - `activacion_pin_hash` del PIN fijo de E2E `246810`;
  - membresía `conductor` en la empresa transportista con `estado = 'pendiente_invitacion'`;
  - fila en `conductores` de la empresa transportista. El seed no la creaba: el login directo no la necesitaba, pero `driver-activate` responde 503 `not_a_driver` sin ella.
  
  Generador y transportista siguen como hoy (activos, clave `482913`).
- **E2E:** el test del flujo entra por `/login/conductor`, activa con RUT + PIN + clave nueva, cae en `/app/conductor` con sesión y sigue con recogida, posición, entrega y resultado, sin cambios en esos pasos.
- **Prueba de la credencial:** después de la entrega, el test cierra la sesión y vuelve a entrar con RUT + la clave elegida por el login principal. Eso prueba que la credencial es la clave del conductor y no el PIN.

## 3b. Ampliación 2026-10-07 — el E2E exige el certificado emitido

T10-02 termina en «→ certificado»; el test aceptaba «Certificado en proceso», y en CI nunca se emitía (sin KMS ni GCS: `config_missing`). Además el seed no creaba `metricas_viaje`, que en prod crea `calcularMetricasEstimadas` al aceptar la oferta: sin esa fila tampoco hay huella ni certificado (`metrics_missing`). Decisión del PO (2026-10-07): firmante local en el E2E.

- **Backend local en `@booster-ai/certificate-generator`** (`backend-local.ts`): `CERTIFICATE_SIGNING_KEY_ID=local:<nombre>` firma con una clave RSA 4096 efímera en memoria (PKCS#1 v1.5 SHA-256, el mismo algoritmo de la key KMS); `CERTIFICATES_BUCKET=file:<dir>` guarda PDF, sidecar y cert X.509 en disco. El resto del pipeline (X.509, PAdES, sidecar) es el de producción. Sin signed URL: la descarga del PDF sigue requiriendo GCS.
- **Doble guarda de producción**: el package lanza `BackendLocalEnProduccionError` con `NODE_ENV=production`, y `config.ts` rechaza ambos prefijos en producción (`certificate-backend-invariants.ts`), así que el API no arranca.
- **Seed**: llama a `calcularMetricasEstimadas` tras crear la asignación (sin Routes API).
- **E2E**: tras la entrega exige «kg CO2e», el botón «Descargar certificado» y `GET /certificates/:tracking/verify` con `valid: true`, `kms_key_id: local:e2e`, `pdf_sha256` y `cert_pem`.
- **Workflow** (`e2e-pr.yml`, permiso del PO): el job `e2e-conductor-run` define las dos variables. Fuera de alcance: ampliar su filtro de paths a `packages/certificate-generator/**` (T10-10).

## 4. Criterios de éxito

1. Con el seed actual, el test nuevo falla en la activación (rojo exhibido: `driver-activate` responde 410 porque la cuenta ya está activa).
2. Con el seed nuevo, `pnpm --filter @booster-ai/web test:e2e:conductor` pasa local contra Postgres + emulador de Auth + API, igual que en CI.
3. `gate-rol.spec.ts` sigue verde (usa al generador, que no cambia).
4. El seed sigue idempotente: correrlo dos veces seguidas deja al conductor pendiente otra vez, con el mismo PIN.
5. Sin cambios en `apps/web/src`. Los cambios en `apps/api/src`, `packages/certificate-generator` y `e2e-pr.yml` son los de §3b.
6. Rojo exhibido del certificado: con el seed con métricas y sin backend, el test falla esperando «Descargar certificado» y el API registra `config_missing`; con el backend local pasa.

## 5. Fuera de alcance

- Crear al conductor desde la UI del transportista. El alta (`POST /conductores`) ya tiene tests de ruta; este frente prueba lo que viene después.
- El envío del PIN por WhatsApp o correo (T10-04).
- Ampliar el filtro de paths de `e2e-pr.yml` para que corra con cambios en `apps/api/src/**` (es un quality gate; va en T10-10 con permiso del PO).
