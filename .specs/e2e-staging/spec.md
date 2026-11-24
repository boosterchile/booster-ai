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
- `apps/web/e2e/fixtures.ts`: sesión por RUT y clave numérica con `E2E_USER_RUT`, `E2E_USER_CLAVE` y `E2E_USER_TIPO`, por los mismos `data-testid` que usa la suite local (`e2e-conductor/helpers.ts`). `apiUrl()` deriva el api de `BASE_URL` (`app.` → `api.`) o lo toma de `E2E_API_URL`.
- `apps/web/e2e/perfil-validacion.spec.ts`: usa la sesión nueva; se salta sin credenciales, con un mensaje que dice cuáles faltan.
- `apps/web/e2e/redis-ratelimit-smoke.spec.ts`: api derivado de `BASE_URL`; se activa con `RUN_RATELIMIT_SMOKE=1` y se niega a correr contra un host que no sea de staging.
- `.github/workflows/e2e-staging.yml`: pasa `E2E_USER_RUT` (variable), `E2E_USER_CLAVE` (secreto) y activa el smoke de rate limit solo cuando el destino es staging.

## Criterios de éxito

- [x] Las pruebas públicas pasan contra `https://app.staging.boosterchile.com`, corridas desde local con Chromium.
- [x] Sin credenciales, las pruebas de sesión se saltan y las públicas corren: la corrida ya no queda en «todo saltado».
- [x] El smoke de rate limit pasa contra staging y se niega contra un host que no es de staging.
- [x] Lint y typecheck de la web en verde.
- [ ] **Lo comprueba el PO o el nightly:** con el usuario de prueba sembrado, las pruebas de sesión corren.

## Usuario de prueba en staging: decisión pendiente del PO

Las pruebas de sesión necesitan un usuario activo en staging, con empresa, y su clave numérica. Hoy no hay forma de crearlo sin tocar una decisión existente:

- Las siembras del repo (`apps/api/scripts/seed-*-e2e.ts`) usan claves que están escritas en el código de un repo público y apuntan al emulador de Auth. Además `requireSafeDatabaseUrl` las hace abortar a propósito contra una base de prod o de staging.
- Staging es alcanzable desde internet: un usuario con una clave publicada en el repo sería una cuenta abierta.

Opciones:

1. **Siembra dedicada para staging.** Un script nuevo que exija un destino explícito, use Identity Platform real y tome la clave de una variable de entorno; lo corre el PO por el túnel del bastion. Deja un usuario estable para el nightly. Implica aceptar que una siembra escriba en la base de staging, que es lo que la guarda actual impide.
2. **Alta por el producto.** Crear la empresa y su dueño desde el panel de plataforma de staging y activarlo en `/activar`. No agrega código, pero necesita antes un platform-admin en staging y deja el alta sin automatizar.

Hasta que el PO elija, las pruebas de sesión se saltan y la corrida sigue valiendo por las públicas.

## Fuera de alcance

- La suite local (`e2e-conductor/`, `e2e-local/`), que funciona y es check obligatorio.
- Volver obligatorio el check «E2E Staging».

## Sin verificar

- `perfil-validacion.spec.ts` con sesión real: los nombres de los campos del perfil no se pudieron comprobar sin un usuario.
