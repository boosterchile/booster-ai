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

## Próximos pasos del corte aprobado

1. ~~Gate PO: merge de #569 (WS1)~~ **HECHO** (mergeado por el PO, `0d1a26f`). Quedan dos gates PO menores: merge de #570 (runbook) y aprobación del deploy de `release.yml` si corresponde.
2. **WS2**: links de descubribilidad en LoginUniversal (`/solicitar-acceso` + método anterior) — rama aparte, 1-2 h.
3. **WS3** (tras deploy aprobado de WS1+WS2): smoke E2E del alta completa con evidencia CORFO (solicitar-acceso → approve → onboarding-admin → login del usuario nuevo).
4. Fechado (próxima semana): integration con Firebase Auth emulator; decisiones de contrato público (RUT requerido en onboarding, Google en tarjeta Booster) — PO.
