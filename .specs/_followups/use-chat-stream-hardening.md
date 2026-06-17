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
Pendiente (BAJA). Los tres se pueden abordar en un solo ciclo corto (todo en `use-chat-stream.ts` + su test).
