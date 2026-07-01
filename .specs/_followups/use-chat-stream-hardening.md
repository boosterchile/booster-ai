# Follow-up: endurecer use-chat-stream (reconnect policy + empresa-change + consolidación)

**Origen**: review devils-advocate de `fix-sse-ticket-x-empresa` (2026-06-14). Tres hallazgos NO bloqueantes, ninguno regresión del cambio de `X-Empresa-Id`; todos pre-existentes en el hook.
**Severidad**: BAJA (realtime es no-crítico; degrada a polling/refetch).
**Archivo**: `apps/web/src/hooks/use-chat-stream.ts`.

## 1. Política de reconnect: cortar en errores permanentes (FUERTE en el review)

Hoy el hook trata todo `!res.ok` del mint igual (`use-chat-stream.ts` branch del catch): un 403 (empresa stale/revocada o user sin acceso real) entra en reconnect loop con backoff ≤30s **indefinidamente**, reintentando el mismo request que no puede tener éxito. Un 503 (Redis) sí es transitorio y debe reintentarse.

**Acción propuesta**: distinguir error permanente (401/403) de transitorio (5xx / network / abort). En permanente: log + `onDisconnect` + **NO** reagendar reconnect (el realtime queda off; el polling/useQuery cubre la lectura). En transitorio: mantener el backoff actual. Test: 403 del mint → no se agenda reconnect; 503 → sí.

## 2. Cambio de empresa activa en stream vivo no re-mintea (MENOR)

El `useEffect` depende de `[enabled, opts.assignmentId]`, no de la empresa activa. Si el user cambia de empresa con un stream abierto, el ticket vigente no se re-emite hasta el próximo reconnect natural. Inocuo para seguridad (la empresa se fija en el mint + re-autorización server-side), pero el realtime puede quedar atado a la empresa anterior hasta reconnect.

**Acción propuesta**: o agregar la empresa activa a las deps del effect (re-mintea al cambiar), o exponer un mecanismo de "refrescar stream" cuando `setActiveEmpresaId` cambia. Evaluar junto con (1).

## 3. Consolidar el fetch del ticket con el api-client (MENOR, de spec §8)

El fetch del mint duplica lo que `api-client.ts` ya hace (Bearer + X-Empresa-Id). Migrar a `api.post(...)` unificaría la inyección de headers (incluida cualquier futura: trace headers, etc.). Cuidar: el api-client arma su propio Content-Type/AbortController; el hook tiene un timeout de 10s y manejo de error específico que no debe perderse.

## Estado

**Parcial (2026-06-22)** — #1 resuelto; #2/#3 deuda conscientemente no tomada.

- **#1 (reconnect en error permanente)** — ✅ RESUELTO. `use-chat-stream.ts`: un
  mint con **401/403** ya NO reagenda reconnect (log + `onDisconnect` + return); el
  realtime queda off y el polling/useQuery cubre la lectura. Los transitorios
  (5xx/network/abort/timeout) siguen con backoff. TDD: 3 casos (403→sin reconnect,
  401→sin reconnect, 503→reconnect), fake timers.
- **#2 (re-mint al cambiar empresa activa)** — NO tomado. `getActiveEmpresaId()` es
  estado de módulo (api-client), no reactivo; no hay subscripción a `setActiveEmpresaId`.
  Re-mintear al cambiar empresa exige plumbing reactivo (event emitter o pasar la
  empresa como prop reactiva del caller). **Seguridad intacta** (empresa fija en el
  mint + re-autz server-side); el costo afecta solo a users multi-empresa que cambian
  de empresa con un stream vivo (caso raro, degrada a polling hasta el próximo
  reconnect). No justifica el riesgo del plumbing por ahora.
- **#3 (consolidar el fetch con api-client)** — NO tomado. `api-client.ts` **no tiene
  timeout propio** (verificado: sin AbortController/setTimeout); migrar el mint a
  `api.post` perdería el **timeout duro de 10s** del hook = net-negativo. La
  duplicación (Bearer + X-Empresa-Id) es mínima. Re-evaluar si el api-client gana un
  timeout configurable.
