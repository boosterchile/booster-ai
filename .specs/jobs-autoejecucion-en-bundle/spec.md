# Spec — Los jobs del api no se autoejecutan dentro del bundle

**Origen:** primer deploy del api en staging (2026-11-24, corrida [45408947990](https://github.com/boosterchile/booster-ai/actions/runs/45408947990)), paso `deploy-canary`.

## Problema

Dos jobs del api terminan con una guarda de «ejecución directa», pensada para correrlos a mano con `tsx`:

```ts
const isMain = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;
if (isMain) { main().catch(/* … */ process.exit(1)); }
```

- `apps/api/src/jobs/reap-orphan-onboarding-firebase.ts`
- `apps/api/src/jobs/reap-inert-idp-accounts.ts`

`routes/admin-jobs.ts` importa ambos, así que tsup los incluye en `dist/main.js`. Dentro del bundle, `import.meta.url` es la URL de `main.js`, que es también `process.argv[1]`: la guarda da verdadero y el `main()` de cada job corre **en cada arranque del api**, fuera de su programación (Cloud Scheduler los invoca por HTTP).

Consecuencias observadas:

- **Staging:** la base está vacía en el primer arranque. El job consulta una tabla que las migraciones aún no crearon, falla y llama a `process.exit(1)` mientras el api todavía migra. El contenedor no pasa el chequeo de arranque y la revisión nunca queda lista:

  ```
  Acquiring migration advisory lock
  [reap-orphan-onboarding-firebase] failed: error: relation "solicitudes_registro" does not exist
  Container called exit(1).
  ```

- **Prod:** los dos jobs corren en cada arranque de instancia del api. En la revisión `booster-ai-api-00497-x44` hay registros `reaper.run.done` y `onboarding-orphan-reaper.run.done` un segundo después de `Acquiring migration advisory lock` (2026-11-24 02:30:55Z). Ambos resúmenes dicen `destructive: false`: el api de prod no define las variables que los vuelven destructivos.

Los demás jobs con una guarda equivalente (`corregir-distancia-no-plausible`, `hc001-fuente-combustible-can`, `reemitir-certificado`, `rellenar-rutas`, `rellenar-versiones-certificado`) no entran al bundle del api: ningún archivo fuera de `jobs/` los importa.

## Objetivo

Que un job solo se autoejecute cuando el proceso se lanzó ejecutando ese archivo, y nunca por estar incluido en el bundle de otro punto de entrada.

## Salidas

- `apps/api/src/jobs/ejecucion-directa.ts`: función pura `esEjecucionDirecta(metaUrl, argv1, nombreJob)`. Verdadero solo si `argv1` es el archivo de `metaUrl` **y** el nombre de ese archivo, sin extensión, es `nombreJob`.
- Los dos jobs usan esa función con su propio nombre.

## Criterios de éxito

- [x] Ejecutado directo (`tsx src/jobs/<job>.ts`): la guarda da verdadero.
- [x] Dentro del bundle (`import.meta.url` y `argv[1]` apuntan a `dist/main.js`): da falso.
- [x] Sin `argv[1]`, o con otro archivo: da falso.
- [x] Rojo exhibido antes de la implementación (los jobs tocan cuentas de autenticación).
- [x] Tests, lint, typecheck y build del api en verde.
- [x] En el bundle construido, `main.js` ya no contiene la guarda antigua.
- [ ] **Lo comprueba el siguiente deploy:** el api de staging arranca y completa sus migraciones.

## Fuera de alcance

- Cambiar qué hacen los jobs, su programación o sus variables.
- Desplegar a prod: el arreglo llega con el siguiente release, que decide el PO.

## Sin verificar

- Que el api de staging no tenga otro bloqueo de arranque después de este.
