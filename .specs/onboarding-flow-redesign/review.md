# Review — onboarding-flow-redesign

## Devils-advocate pass (DEFINE) — 2026-06-08

Sub-agent `agent-rigor:devils-advocate` contra `spec.md` (Draft) + código vivo. **Veredicto: 2 P0 (reapertura de SEC-001) + 6 residuales.** Todas incorporadas al spec v2.

### P0 — reapertura de SEC-001 (bloqueantes)

| # | Hallazgo (verificado en código) | Resolución en spec v2 |
|---|---|---|
| P0-1 | El predicado "por email" reabre SEC-001. `solicitudes_registro` NO tiene `firebase_uid` (`schema.ts:2212-2226`) → solo anclaje por email. Google sign-in vivo (ADR-057) + signup-request anónimo → una fila `aprobado` para X@gmail.com permite a cualquiera con Google sign-in de ese email auto-provisionarse como dueño del RUT que tipee. Por-email + no-consumible = self-serve disfrazado. | **§6 (constraint, ya NO open question)**: el predicado es un **token de un solo uso** emitido en el approve (firmado, con nonce), entregado en el email link, **consumido atómicamente** al completar onboarding. NO se ancla en "existe fila aprobado por email". Requiere migración (columna token/consumido). |
| P0-2 | SC2 (frontera de seguridad) listado como criterio de éxito mientras su definición era OQ abierta. | SC2 reescrito alrededor del token + T3 reforzado (cubre Google sign-in con email aprobado + reuso post-onboarding). |

### Residuales (incorporados)

| # | Hallazgo | Resolución |
|---|---|---|
| R1 (F1) | 3.1 (quitar precreate) rompe el account-linking de `/me` para aprobados-Google (`me.ts:62-86` re-vincula uid Google↔email usando el row precreado). Mi spec lo llamó "a medias" — falso, tiene consumidor vivo. | §7 documenta el efecto en `/me`; el token autoriza el onboarding sin importar el método de login; T añadido para el camino Google. |
| R2 | Sin kill-switch para el route `admin_provisioned` (el flag SEC-001 no lo cubre por diseño). | §6/§11: flag propio `ADMIN_PROVISIONED_ONBOARDING_ENABLED` default OFF, separado. |
| R3 | `emailVerified` no chequeado en `/empresas/onboarding` (`empresas.ts:43` solo exige email presente; `me.ts:54-62` ya lo restringe). | §6 constraint: el route hereda la restricción `emailVerified=true`. |
| R4 | Mi risk row "el reaper limpia el huérfano" es FALSA: `reaper-predicate.ts:124-129` protege a los aprobados (reapable=false mientras `solicitudActive`). El huérfano + token persisten. | §9 reescrito: definir TTL/expiración del token, no apoyarse en el reaper. |
| R5 | El journey demo/prospecto-exploratorio del stub origen ("no colapsar journeys") se borró del scope sin decisión. | §5 Out-of-scope: devuelto explícito (diferido, decisión de producto separada). |
| R6 | Contradicción §11: con `SIGNUP_REQUEST_FLOW_ACTIVATED=OFF` el approve admin devuelve 503 → el admin tampoco procesa. "Se acumulan en paralelo" es engañoso. | §11 corregido: el endpoint público acumula, pero el lado admin está congelado hasta el flip. |
| (extra) | El harness CI default-deny de ADR-057 (SC-G1b) falla el build si una ruta nueva no se clasifica. | §6/§11: las rutas nuevas (Fase 1 + gestor Fase 4) deben clasificarse en el boundary-audit. |
| (extra) | El contrato `SignupRequestNotifier` ya existe → Fase 2 es swap de implementación, no "construir infra". | §7 ajustado. |

### No objetado a fondo (su propio devils-advocate cuando tengan diseño)
Fases 3-5 (conductor/gestor/stakeholder). La Fase 1 + el predicado son el prerequisito que decide si el programa arranca con seguridad.

### Archivos verificados por el sub-agent
`onboarding.ts:90-121`, `signup-request.ts:222-277`, `empresas.ts:43,75`, `me.ts:54-123`, `reaper-predicate.ts:124-129`, `schema.ts:2212-2226` (sin firebase_uid), `docs/adr/057-*` (Google vivo), `.specs/_followups/onboarding-flow-redesign.md` (demo vs prod).

---

## Devils-advocate pass (PLAN — Fase 1) — 2026-06-08

Sub-agent `agent-rigor:devils-advocate` contra `plan.md` (Active) + spec v2 + código vivo.
**Veredicto: 3 P0 (atomicidad de tareas + estado roto intermedio + huérfano Firebase) + 4 P1 + 2 P2.**
Foco: ¿las T1.x son atómicas? ¿la Fase 1 deja el sistema funcional commit-a-commit? ¿el token one-shot es realmente atómico? ¿hay omisiones que rompen la seguridad/funcionalidad?

### Premisa
- Asumido: que `onboardEmpresa` puede "consumir el token en su transacción" sin cambiar su contrato. **FALSO en código vivo**: `onboardEmpresa` (onboarding.ts:90) NO recibe `solicitudId` ni toca `solicitudes_registro` hoy; su único arg de flujo es `selfServiceEnabled`. Consumir el token = cambio de firma del service (nuevo param + nueva escritura dentro de la tx). Esa modificación de contrato no tiene tarea propia: está escondida dentro de T1.5 ("+ onboarding.ts").
- Más doloroso si es falso: T1.5 deja de ser "el route" y pasa a ser "el route + el rediseño del contrato del service core de seguridad". Eso revienta el LOC y la atomicidad declarados.

### P0 — bloqueantes

| # | Hallazgo | Cambio concreto |
|---|---|---|
| **P0-3** | **T1.5 son cuatro tareas disfrazadas y cruza dos archivos de criticidad distinta.** Empaqueta: (1) cambiar la firma de `onboardEmpresa` para aceptar+consumir el token dentro de la tx (onboarding.ts, service de seguridad), (2) el route nuevo en empresas.ts, (3) el gate triple (flag+emailVerified+token-verify), (4) los 4 negativos T3. "~100 LOC" no es waiver honesto: el cambio de contrato de `onboardEmpresa` + su re-test + el route + 4 negativos no entra en 100 LOC sin recortar tests. Y mezcla service-core con route en un commit → no se puede revisar/revertir el predicado de seguridad por separado. | **Partir T1.5 en dos**: **T1.5a** — `onboardEmpresa` acepta `onboardingTokenConsumption?` y consume `solicitudes_registro` (`consumido_en`) dentro de su tx (service + test, incluye el negativo "token ya consumido" a nivel service); **T1.5b** — route `/empresas/onboarding-admin` que arma el gate (flag+emailVerified+verify) y delega. T3(c)/(d) viven en T1.5a (service), T3(a)/(b) en T1.5b (route). Sube T1.5a a `Depends: T1.1, T1.2`; T1.5b a `Depends: T1.5a, T1.3, T1.4`. |
| **P0-4** | **La Fase 1 NO está funcional commit-a-commit: T1.3 deja a los aprobados en limbo entre commits.** T1.3 (quita el precreate del `users` row) mergea ANTES de T1.5 (el único caller del nuevo path). Entre el merge de T1.3 y el de T1.5, `approveSignupRequest` ya no crea el row Y `onboardEmpresa` aún no sabe consumir token → todo aprobado en esa ventana queda exactamente en el limbo que el spec dice destrabar (spec §2). El propio plan lo admite implícitamente en el Rollback de T1.3 ("revertir junto con T1.5"). Una tarea cuyo rollback exige arrastrar otra tarea **no es atómica** (viola la definición: compila-testea-mergea-revierte sola). | **Acoplar el corte del precreate al kill-switch**, no a un commit suelto. Opciones: (a) reordenar para que T1.3 sea el ÚLTIMO commit de código de la fase, después de T1.5b, de modo que el path nuevo exista antes de quitar el viejo; o (b) gatear el comportamiento de T1.3 con el MISMO flag `ADMIN_PROVISIONED_ONBOARDING_ENABLED` (default OFF): con flag OFF approve sigue precreando (comportamiento viejo, SEC-001 ya congelado vía `SIGNUP_REQUEST_FLOW_ACTIVATED`), con flag ON approve emite token y no precrea. Así cada commit es deployable y el rollback de T1.3 es flag-flip, no revert-coordinado. Documentar cuál se elige; hoy el plan no elige. |
| **P0-5** | **El TTL (T1.7) NO puede limpiar el Firebase user huérfano que crea T1.3 — y el plan dice que sí.** T1.3 crea el Firebase user en el approve (igual que hoy, signup-request.ts:222 ya deja "orphan Firebase user / TODO cleanup manual" en el race). T1.7 limpia "la solicitud/cuenta huérfana" por `expira_en`. Pero `solicitudes_registro` NO guarda `firebase_uid` (schema.ts:2212; el spec §6 lo confirma) → el job no tiene cómo resolver qué Firebase user borrar a partir de una solicitud expirada. Resultado: el TTL marca la solicitud expirada pero el Firebase user (credencial viva, email verificable) queda. Eso es precisamente la superficie que el token intenta cerrar, persistiendo indefinidamente. Además T1.7 es un **script `tsx` manual** (jobs/README.md: "no Cloud Run Jobs todavía… se corre manualmente") → el TTL no se ejecuta solo. Un TTL que nadie dispara no es un TTL. | (1) Añadir `firebase_uid` a la migración T1.1 (persistido en el approve, T1.3) para que el reaper/job pueda identificar y borrar el Firebase user huérfano. (2) Declarar explícitamente el **mecanismo de disparo** del job (cron/Cloud Scheduler) o documentar como waiver que el TTL es manual y por tanto NO es mitigación de seguridad sino higiene operacional — en cuyo caso el riesgo "Firebase user huérfano" del spec §9 sigue ABIERTO y debe decirlo. (3) Acoplar T1.7 al diseño del token: T1.5a escribe el estado que T1.7 consume; hoy T1.7 `Depends: T1.1` solamente, ignorando que el predicado de borrado depende de cómo T1.5a marca consumo/expiración. |

### P1

| # | Hallazgo | Cambio concreto |
|---|---|---|
| **P1-1 (omisión, camino Google / T6 del spec)** | **`/me` reabre el vector que el token cierra, y NINGUNA tarea de Fase 1 lo toca.** El token blinda `onboardEmpresa`. Pero `/me` (me.ts:66-89) hace account-linking automático: para cualquier `claims.emailVerified` con un `users` row del mismo email, re-vincula `firebase_uid` al uid de Google **sin token**. El spec §7/T6 dice "el token autoriza el onboarding sin depender del email-linking", pero eso solo aplica al path de onboarding; el linking de `/me` sigue operando sobre rows que ya existan. Con T1.3 (no precreate) un aprobado-Google no tiene row aún → cae en `needs_onboarding` (ok). Pero el plan **no tiene tarea que verifique ni teste el camino Google de `/me`**, pese a que el cierre de Fase 1 lo exige ("camino Google testeado (T6)") y T6 es success-criterion del spec. El cierre referencia T6 como gate pero ninguna T1.x lo produce. | Añadir **T1.8 — Camino Google de `/me` post-no-precreate**: test que demuestra que un aprobado que entra por Google (uid distinto, sin row) cae en `needs_onboarding` y completa vía token; y que el linking de `/me` no auto-provisiona un dueño sin token. Sin esta tarea, el gate de cierre "T6 testeado" no tiene artefacto. |
| **P1-2 (atomicidad / race del token)** | **El plan no prueba que el consumo sea atómico contra concurrencia; "dentro de la transacción" no basta.** T1.5 dice "valida el token y lo consume atómicamente (`consumido_en`) dentro de la transacción". Pero validar-luego-consumir dentro de una tx sigue permitiendo doble-uso si dos requests entran a la vez y el `UPDATE … SET consumido_en` no es condicional sobre `consumido_en IS NULL` con la fila bloqueada (`already_processed_race` de approve usa exactamente ese patrón `WHERE estado=…` — el plan debería heredarlo). El acceptance de T1.5 no especifica el `UPDATE … WHERE consumido_en IS NULL RETURNING` ni `SELECT … FOR UPDATE`; deja la atomicidad a la palabra "atómicamente". | El acceptance de T1.5a debe **especificar el mecanismo**: `UPDATE solicitudes_registro SET consumido_en=now() WHERE id=? AND consumido_en IS NULL RETURNING` (o `FOR UPDATE` en el SELECT) y un test de concurrencia (dos consumos simultáneos → uno gana, el otro 409/rechazado). "Atómicamente" sin la cláusula condicional es vibes. |
| **P1-3 (acople T1.5↔T1.7 / token sin TTL)** | **Si T1.5 mergea antes de T1.7, existe una ventana donde se emiten tokens sin TTL operativo.** T1.1 crea la columna `expira_en` y T1.2/T1.3 la pueblan, pero T1.7 (lo único que actúa sobre la expiración) llega después y, peor, es manual (P0-5). Entre T1.5 (route vivo, flag se podría encender en test/canary) y T1.7, un token expirado es rechazado por `verify` (si T1.2 chequea `expira_en`) — **bien** — pero el huérfano nunca se limpia. La pregunta real: ¿`verifyOnboardingToken` (T1.2) rechaza por `expira_en` por sí solo, sin depender de T1.7? El acceptance de T1.2 dice "expirado/inválido" → asumamos que sí. Entonces el TTL-job es solo limpieza, NO control de acceso. Eso **contradice** el risk del spec §9 que lista `expira_en` + job como mitigación del huérfano: la mitigación de ACCESO es el verify (T1.2), la de HIGIENE es el job (T1.7). El plan los confunde. | Separar en el plan los dos roles: (a) **rechazo por expiración = T1.2** (parte del predicado, bloqueante de Fase 1); (b) **borrado del huérfano = T1.7** (higiene, puede ir después con waiver explícito si el verify ya rechaza). Si se acepta (b) diferido, decir en el ledger que el Firebase user huérfano persiste hasta el run manual del job y que eso es residual aceptado. |
| **P1-4 (acceptance no trazable / waiver de LOC deshonesto en T1.3)** | **T1.3 "~90 LOC" incluye cambio de comportamiento del approve + mantener `already_processed_race` + emitir token + persistir hash + pasar token al notify payload, y su acceptance mezcla SC1+T1 sin separar el negativo.** Además su Rollback ("revert… revertir junto con T1.5") es la confesión de P0-4. El acceptance no traza qué test cubre "token pasado al notify payload" (¿es parte de T1 o de Fase 2 email?). | Tras aplicar P0-4 (gatear con flag), reescribir acceptance de T1.3 separando: comportamiento flag-OFF (precrea, viejo) y flag-ON (emite token, no precrea), cada uno con su test. El rollback pasa a ser "flag OFF", honesto y atómico. |

### P2

| # | Hallazgo | Cambio concreto |
|---|---|---|
| **P2-1** | **T1.2 dice "unit-test puro sin DB" pero el estado one-shot (`consumido_en`) vive en DB.** Es defendible: T1.2 firma/verifica el token criptográficamente (nonce+expira), el consumo es de T1.5a. Pero el acceptance debería decir explícitamente que T1.2 verifica forma+firma+expiración y que la unicidad/consumo es responsabilidad de T1.5a — sino "verifyOnboardingToken → válido/expirado/inválido" se lee como si T1.2 garantizara one-shot, que es justo lo que NO hace sin DB. | Una línea en acceptance T1.2: "one-shot NO se enforce-a aquí; el consumo atómico es T1.5a". |
| **P2-2** | **Drift vocab: T1.7 "ubicación según patrón de jobs del repo" + "Define el TTL (OQ1)" dentro de una tarea de implementación.** Decidir el TTL (decisión de producto/seguridad, OQ1) está embebido en la tarea de código y se cierra "con propuesta + security-auditor en REVIEW" → la tarea no puede estar verde sin una decisión que aún no existe. Eso es un "se decide después" disfrazado de acceptance. | Mover la decisión del valor TTL a **out-of-band** (ya hay un bullet, pero el plan la duplica dentro de T1.7) y dejar T1.7 con el valor como parámetro inyectado. Confirmar OQ1 ANTES de que T1.7 pueda cerrar, no "durante REVIEW". |

### Trazabilidad acceptance → SC/T (chequeo)
- SC1→T1.3 ✓, SC2→T1.2+T1.5 (parcial: el "atómicamente" no está especificado, P1-2), SC3→T1.4+T1.5 ✓, SC8→cierre ✓.
- **T6 (camino Google) NO tiene tarea productora** (P1-1) pese a ser gate de cierre. 
- T3(d) token expirado: depende de que T1.2 chequee `expira_en` — el acceptance de T1.5 lista T3(d) pero el rechazo por expiración nace en T1.2; trazabilidad cruzada sin dueño claro (P1-3).

### Reversibilidad
- Costo de deshacer en 30 días: con P0-4 sin resolver, alto — el revert de T1.3 arrastra T1.5 y deja datos (Firebase users sin row, tokens). Con el gateo por flag propuesto, bajo (flag-flip). 
- Mecanismo: kill-switch `ADMIN_PROVISIONED_ONBOARDING_ENABLED` — **bien diseñado para el route, pero NO cubre el comportamiento de approve de T1.3** (P0-4). El spec §9 ya advierte "estado creado por exploit requiere data-cleanup, no revert" → el plan no operacionaliza ese cleanup (es justamente el job huérfano roto, P0-5).

### Evidencia
- "onboardEmpresa consume el token en su transacción" → código (onboarding.ts:90, sin solicitudId) → **insuficiente** (requiere cambio de contrato no asignado, P0-3).
- "el reaper/TTL limpia el huérfano" → reaper-predicate.ts:117-129 (protege aprobados) + schema sin firebase_uid → **el TTL no puede borrar el Firebase user** (P0-5). Evidencia contradice la mitigación del spec.
- "consumido atómicamente" → solo la palabra en el acceptance → **vibes** (P1-2); el patrón correcto existe en el repo (approve `WHERE estado=…`) pero no se cita.
- "Fase 1 entregable commit-a-commit" → orden T1.3 antes de T1.5 → **falso** (P0-4).

### Veredicto
- **Objeciones fuertes (resolver antes de BUILD)**: P0-3 (partir T1.5 en T1.5a/T1.5b — el cambio de contrato de `onboardEmpresa` es tarea propia), P0-4 (gatear T1.3 con el flag o reordenarlo último — no hay estado roto intermedio), P0-5 (firebase_uid en T1.1 + mecanismo de disparo del TTL, o declarar el huérfano como residual abierto).
- **P1 a incorporar**: P1-1 (T1.8 camino Google de `/me`), P1-2 (especificar `WHERE consumido_en IS NULL` + test concurrencia), P1-3 (separar rechazo-por-expiración [T1.2, acceso] de borrado-huérfano [T1.7, higiene]), P1-4 (acceptance/rollback honesto de T1.3 tras el gateo).
- **Residuales aceptables (documentar)**: P2-1 (alcance de T1.2), P2-2 (TTL como parámetro, decisión OQ1 movida out-of-band y resuelta antes del cierre).
- **Fuera de alcance de este pass**: Fases 2-5 (su propio devils-advocate al descomponerse, como dice el plan correctamente).
