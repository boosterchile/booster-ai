# Estado de traspaso — alta de usuarios (hito 2 CORFO)

**Fecha**: 2026-07-07, tarde-noche America/Santiago · **Sesión**: cierre Workstream 1 (Gap A) del corte mínimo aprobado por el PO · **Operaciones en prod ejecutadas y verificadas por el owner** (`dev@boosterchile.com`); el agente aportó el código, los tests y este registro. Contexto completo: `diagnostico-alta-usuarios.md` (§1-§7).

---

## 1. GAP A CERRADO Y VALIDADO EN PROD ✅ (criterio binario del hito cumplido)

`bootstrap-platform-admin` (PR [#569](https://github.com/boosterchile/booster-ai/pull/569), rama `feat/bootstrap-platform-admin`) **ejecutado en prod por el owner** contra `dev@boosterchile.com`. Estado final verificado en BD:

| Campo | Valor |
|---|---|
| `rut` | `14289398-3` |
| `es_admin_plataforma` | `true` |
| `clave_numerica_hash` | seteada (scrypt) |
| `estado` | `activo` |

**Login por la UI real CONFIRMADO**: el admin entra por `app.boosterchile.com` (RUT + clave, flujo LoginUniversal) y ve el panel `/app/platform-admin`. Con esto el actor que aprueba todas las altas **nace, se autentica y opera por un mecanismo reproducible y versionado** — exactamente lo que el Gap A del diagnóstico pedía. El flujo quedó validado end-to-end en prod, no solo en CI.

Estado del PR #569: **MERGEADO por el PO** (2026-07-07 21:14Z / 17:14 Santiago, squash `0d1a26f` en `main`) — gate ejercido por él. Nota operativa: el push a `main` dispara `release.yml` con su gate humano de deploy (Environment `production`); la validación en prod del script fue por túnel directo a la BD y no dependía del deploy.

## 2. Reconciliación de cuentas (Opción 1: mover RUT, no borrar)

- El RUT `14289398-3` estaba declarado en **`fvicencio@gmail.com`** (cuenta personal del owner, con 7 viajes de TEST de mayo y 1 membresía).
- Se liberó de esa cuenta (`UPDATE rut=NULL`, operación manual del owner con backup previo) y el script lo asignó a `dev@` en su corrida normal.
- **`fvicencio@gmail.com` conserva sus viajes de test y su membresía intactos. No se borró ninguna cuenta.**
- Backup previo: `/tmp/backup-usuarios-20260707-185041.csv`. ⚠️ `/tmp` es volátil (se pierde al reiniciar): si se quiere conservar, moverlo a una ubicación durable **privada** (contiene PII de `usuarios` — no al repo).

## 3. Hallazgo de modelo de datos (verificado por el owner en esta sesión)

- El **multi-rol** (una persona como transportista Y conductor) se implementa por **tablas satélite** (`conductores`, `membresias`, `stakeholders` con FK `usuario_id`), **no** por RUT repetido en `usuarios`.
- Verificado en prod: ningún RUT duplicado en `usuarios` (`GROUP BY rut HAVING count(*)>1` → 0 filas). La regla **"un RUT = una fila en `usuarios`"** que asume el script (y `login-rut`) es correcta respecto al modelo real.
- La telemetría GPS (`posiciones_movil_conductor`) cuelga de `vehiculo_id` + `usuario_id` (conductor), no del creador del viaje — por eso **el piloto Van Oosterwyk nunca estuvo en riesgo** por estas operaciones sobre cuentas.

## 4. Follow-up runbook — correcciones aplicadas

`docs/qa/runbook-bootstrap-platform-admin.md` corregido en el PR [#570](https://github.com/boosterchile/booster-ai/pull/570) (rama `fix/runbook-bootstrap-admin` desde `main` post-#569; **abierto sin merge — gate del PO**):

a. **Puerto**: decía `5434`; el default real de `connect.sh` es **`5433`** (`connect.sh:41`).
b. **Clave**: la env correcta es **`BOOTSTRAP_ADMIN_CLAVE`** (no `BOOSTER_ADMIN_CLAVE`); `--clave` por argv está rechazado por el script. La vía por env queda documentada como **preferida**: el prompt TTY de doble confirmación falló repetidamente por caracteres del terminal en la corrida real.
c. **Túnel**: `connect.sh` tiene `trap cleanup EXIT` → el runbook ahora documenta el patrón de **DOS terminales** (túnel con `gcloud compute start-iap-tunnel` directo en A, script en B), no la sesión psql de connect.sh.
d. **Bug del probe de connect.sh** (`connect.sh:96`, `echo > /dev/tcp/...`): no distingue el túnel real de un okupa en el puerto — causa raíz del incidente inicial de esta sesión (un Postgres local de test en 5433 interceptó ambos modos de auth con "role does not exist"). Documentado + pre-check `lsof -nP -i :5433` como paso 0 del runbook.

## 5. Pendiente opcional (NO bloqueante, NO hoy)

Limpieza de cuentas de test (`fvicencio@gmail.com`, `pensando@fueradelacaja.co`). Requiere resolver primero los viajes/eventos que cuelgan de ellas (la FK los frena) + backup. **No es necesario para el hito.**

## 6. BUG DEL SEED DEMO 🔴 (bloqueante — NO correr el seed hasta resolver)

Auditoría read-only del seed (código + queries a prod vía `agent-query.sh`, 2026-07-07 noche) antes de correrlo para la demo. **El seed NO contamina datos reales** (cero deletes en el POST; el DELETE filtra `empresas.es_demo=true` y hoy solo matchea las 2 empresas demo; Van Oosterwyk `es_demo=false`; el vehículo espejo `DEMO01` es fila propia con `teltonika_imei_espejo` — `VFZH-68` y sus posiciones quedan fuera por construcción; cero colisiones con las cuentas/RUTs reales). **Pero tiene un bug bloqueante:**

- `seed-demo.ts` busca los usuarios dueños por email **`demo-2026-*`** (post-rotación, los activos en `cuentas_demo`), pero en prod existen filas demo **VIEJAS** con emails pre-rotación (`demo-shipper@boosterchile.com`, `demo-carrier@…`, `demo-stakeholder@…`) y los mismos RUTs (`11999001-7`, `11999002-5`, `11999003-3`) — verificado con query en prod.
- `ensureFirebaseUser` busca la fila por **email** (`seed-demo.ts:688-692`) → no encuentra la vieja → hace INSERT de una **segunda fila con el MISMO RUT**.
- `usuarios.rut` **NO tiene UNIQUE** (solo `index('idx_usuarios_rut')`) → el INSERT pasa → rompe el invariante "1 RUT = 1 fila" y deja `login-rut` (`LIMIT 1`) **no-determinista** para esas cuentas demo.
- `deleteDemo` **no lo arregla**: no borra las filas `usuarios` de los dueños demo (solo conductores/stakeholders huérfanos, `seed-demo.ts:546-555, 583-592`).
- El conductor demo NO sufre el bug (su lookup es por RUT, `seed-demo.ts:956-960` → reusa).

**CAUSA RAÍZ**: `usuarios.rut` sin constraint UNIQUE. Recomendación: evaluar agregar UNIQUE a `rut` (migración expand/contract, previa limpieza de cualquier duplicado). Hoy verificado: 0 duplicados en cuentas reales — pero el seed los introduciría.

**RESOLUCIÓN PENDIENTE (decisión de datos + gate PO, para mañana)**: renombrar el email de las 2-3 filas demo viejas a `demo-2026-*` (para que el seed las reuse por email), o borrarlas tras `deleteDemo`. Con eso resuelto, el seed es seguro de correr. **Requiere backup previo.**

## Próximos pasos del corte aprobado

1. ~~Gate PO: merge de #569 (WS1)~~ **HECHO** (mergeado por el PO, `0d1a26f`). Quedan dos gates PO menores: merge de #570 (runbook) y aprobación del deploy de `release.yml` si corresponde.
2. **WS2**: links de descubribilidad en LoginUniversal (`/solicitar-acceso` + método anterior) — rama aparte, 1-2 h.
3. **WS3** (tras deploy aprobado de WS1+WS2): smoke E2E del alta completa con evidencia CORFO (solicitar-acceso → approve → onboarding-admin → login del usuario nuevo).
4. Fechado (próxima semana): integration con Firebase Auth emulator; decisiones de contrato público (RUT requerido en onboarding, Google en tarjeta Booster) — PO.
