# Spec — E2E contra staging que pruebe algo

**Estado:** pedida por el PO en el chat el 2026-11-24 («haz las pruebas», «Sí, prepáralo»).
**Origen:** staging quedó en servicio ese día ([ADR-083](../../docs/adr/083-staging-gemelo-y-extraccion-con-shadow.md)); al crear `STAGING_URL`, el workflow «E2E Staging» corrió contra staging y terminó en verde con sus 20 tests saltados.

## Problema

La suite `apps/web/e2e/`, la única que corre contra un entorno desplegado, no prueba nada:

- `perfil-validacion.spec.ts` se salta sin `E2E_USER_EMAIL` y `E2E_USER_PASSWORD`, y `e2e-staging.yml` nunca se las pasa. Además su fixture inicia sesión con campos «Email» y «Contraseña», que el login universal por RUT y clave numérica (ADR-035) ya no tiene.
- `redis-ratelimit-smoke.spec.ts` se salta sin `RUN_PROD_SMOKE=1`, tiene fija la URL del api de prod y envía un cuerpo que el api ya no acepta.

El workflow lleva en verde sin ejecutar un solo test, también cuando apuntaba a prod.

## Objetivo

Que cada corrida de «E2E Staging» ejecute pruebas reales contra staging: siempre las públicas, y las de sesión cuando exista un usuario de prueba.

## Salidas

- `apps/web/e2e/humo-publico.spec.ts` (nuevo): pruebas sin sesión, que corren siempre. La PWA carga y ofrece los tipos de acceso; `/app` sin sesión lleva al login; las pantallas de activación de conductor y de solicitud de acceso se dibujan; el api responde en `/health` y `/ready` y rechaza `/me` sin sesión.
- `apps/web/e2e/fixtures.ts`: sesión por RUT y clave numérica, con las credenciales de cada rol tomadas del entorno, por los mismos `data-testid` que usa la suite local (`e2e-conductor/helpers.ts`). `apiUrl()` deriva el api de `BASE_URL` (`app.` → `api.`) o lo toma de `E2E_API_URL`.
- `apps/web/e2e/perfil-validacion.spec.ts`: usa la sesión nueva; se salta sin credenciales, con un mensaje que dice cuáles faltan.
- `apps/web/e2e/redis-ratelimit-smoke.spec.ts`: api derivado de `BASE_URL`; se activa con `RUN_RATELIMIT_SMOKE=1` y se niega a correr contra un host que no sea de staging.
- `.github/workflows/e2e-staging.yml`: pasa el RUT (variable) y la clave (secreto) de cada rol, y activa el smoke de rate limit solo cuando el destino es staging.

## Criterios de éxito

- [x] Las pruebas públicas pasan contra `https://app.staging.boosterchile.com`, corridas desde local con Chromium.
- [x] Sin credenciales, las pruebas de sesión se saltan y las públicas corren: la corrida ya no queda en «todo saltado».
- [x] El smoke de rate limit pasa contra staging y se niega contra un host que no es de staging.
- [x] Lint y typecheck de la web en verde.
- [ ] **Lo comprueba el PO o el nightly:** con el usuario de prueba sembrado, las pruebas de sesión corren.

## Usuarios de prueba en staging

**Decisión del PO (chat, 2026-11-24):** el E2E usa dos empresas de prueba creadas en staging, «Transportes Van Oosterwyk» como transportista y «Prueba Generador SpA» como generador. Esos nombres existen en prod como empresas reales; en staging son datos de prueba con RUT ficticios.

Las siembras locales (`apps/api/scripts/seed-*-e2e.ts`) no sirven para esto: usan claves escritas en el código de un repo público, apuntan al emulador de Auth, y `requireSafeDatabaseUrl` las hace abortar a propósito contra una base desplegada. Staging es alcanzable desde internet: un usuario con una clave publicada sería una cuenta abierta. Por eso la siembra de staging es un script aparte, con guardas propias.

### Salidas

- `apps/api/scripts/seed-staging-e2e.ts` (`pnpm --filter @booster-ai/api seed:staging-e2e`): crea o actualiza las dos empresas, el dueño de cada una (cuenta en Identity Platform de staging y `clave_numerica_hash`), y para el transportista una zona XIII y un camión activo. Idempotente; no borra nada que no haya creado.
- `apps/api/scripts/seed-staging-e2e-guardas.ts`: guardas puras, con tests.
  - Exige `SEED_E2E_DESTINO=staging` y `GOOGLE_CLOUD_PROJECT=booster-ai-stg-494222`.
  - Rechaza el emulador de Auth.
  - Las claves vienen del entorno: seis dígitos, ni publicadas en el repo ni triviales.
  - Aborta sin escribir si la base tiene una de las dos razones sociales con un RUT que no es el de la siembra: así se ve prod.
- `scripts/db/seed-staging-e2e.sh`: abre el túnel IAP al bastion de staging, arma la URL de la base desde Secret Manager sin imprimirla, genera las dos claves al azar, corre la siembra y deja en GitHub lo que lee el workflow (`STAGING_E2E_TRANSPORTISTA_RUT` y `STAGING_E2E_GENERADOR_RUT` como variables; `STAGING_E2E_TRANSPORTISTA_CLAVE` y `STAGING_E2E_GENERADOR_CLAVE` como secretos). Lo corre el PO.
- `apps/web/e2e/`: `fixtures.ts` con sesión por rol, `perfil-validacion.spec.ts` (transportista) y `sesion-generador.spec.ts`.

### Límite de intentos de login

El login por RUT admite 5 intentos cada 15 minutos por RUT y cuenta también los exitosos; en staging nadie lo limpia entre corridas. Por eso cada rol inicia sesión una sola vez por corrida (`abrirSesion` en `beforeAll`) y las pruebas con sesión corren solo en Chromium de escritorio. Más de cinco corridas del workflow en 15 minutos harían fallar el login.

### Criterios de éxito

- [x] Rojo exhibido en las guardas antes de implementarlas (los usuarios son cuentas de autenticación).
- [x] Cada guarda aborta la siembra antes de conectarse a la base: sin destino, con el proyecto de prod, con el emulador, con una clave publicada y con una trivial.
- [x] Sin credenciales, la suite corre contra staging en los cuatro navegadores: pasan las públicas y se saltan las de sesión.
- [ ] **Lo corre el PO:** `scripts/db/seed-staging-e2e.sh` siembra staging y configura GitHub.
- [ ] **Lo comprueba la siguiente corrida de «E2E Staging»:** las pruebas con sesión de los dos roles pasan.

### Sin verificar

- La siembra contra una base y un Identity Platform reales: no se pudo ejecutar fuera de staging, porque rechaza el emulador. Su primera corrida es la del PO.
- Las pruebas con sesión: dependen de esa siembra.

## Fuera de alcance

- La suite local (`e2e-conductor/`, `e2e-local/`), que funciona y es check obligatorio.
- Volver obligatorio el check «E2E Staging».

## Sin verificar

- `perfil-validacion.spec.ts` con sesión real: los nombres de los campos del perfil no se pudieron comprobar sin un usuario.
