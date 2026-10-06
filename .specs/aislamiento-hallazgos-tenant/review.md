# Review: plan «lo que la revisión multi-tenant todavía no cierra»

- Reviewer: agente (Claude), por pedido del PO
- Date: 2026-10-05
- Objeto: `.specs/aislamiento-hallazgos-tenant/plan.md` @ `8c46308`, rama `cursor/aislamiento-multi-tenant-4567`, PR #739 (draft)
- Status: revisión del **plan**, no del build. Los hallazgos H1 y H2 van antes del bloque 1.
- Método: cada afirmación del plan se contrastó con el código de la rama y con el estado de CI del PR. Las referencias `archivo:línea` son de esa rama. Lo que no pude verificar está marcado como tal.

## 1. Veredicto

El plan está bien acotado y la mayoría de sus afirmaciones se sostienen. Los bloques 2 y 3 describen el código tal como está y proponen el cambio correcto. Los ítems de «No entra» apuntan a los documentos correctos.

Tiene tres problemas que cambian el orden o la ejecución:

1. Omite un bloqueante que ya existe: el job de integración del PR está en rojo por la propia migración 0058 (H1).
2. El bloque 1 parte de una premisa falsa. En producción una migración que falla **no** deja el deploy insano: el servidor arranca igual porque el flag `STRICT_MIGRATION_ORDERING` está en `false` (H2).
3. El bloque 4 se contradice al ubicar el `empresaId` en la clave y lista claves que no existen con ese nombre (H4).

## 2. Hallazgos que piden corrección

### H1 — Bloqueante ausente: CI del PR en rojo por 0058

**Evidencia.** El job «Integration tests (DB + Redis)» del PR falla en `test/integration/conductores-fecha-licencia.integration.test.ts`. El fixture inserta un usuario con RUT fijo `'5864136-7'` (línea 76) en los dos tests del archivo, sin limpiar entre uno y otro. Con `uq_usuarios_rut` el segundo insert termina en `duplicate key value violates unique constraint "uq_usuarios_rut"`. En `main` (`dca3982`, run 36498149723) el mismo job pasa. El test `migrations.integration.test.ts` pasa, así que 0058 aplica bien sobre una base limpia; el problema es el fixture.

**Qué omite el plan.** El bloque 6 lista coverage como la evidencia que falta. No menciona el job rojo. Trivy y npm audit también fallan en el PR, pero fallan igual en `main` (security.yml, run 37293367416 del 2026-10-05): preexistente, no de este diff.

**Acción.** Antes del bloque 1: RUT aleatorio por test o limpieza en `afterEach` en ese fixture. Revisar también `bootstrap-platform-admin.integration.test.ts`, que usa `'12345678-5'` en tres lugares (hoy pasa, pero conviene confirmar que limpia).

**Cerrado el 2026-10-05**, en esta misma rama: el fixture usa `rutAleatorio()` (`apps/api/test/helpers/rut-aleatorio.ts`, dígito verificador real). Verificado contra Postgres local con 0058 aplicada: 2 tests pasan. `bootstrap-platform-admin` sí limpia: su `beforeEach` borra los usuarios por patrón de email, por eso no choca.

### H2 — Bloque 1: «el deploy no queda sano» es falso en producción

**Evidencia.**

- `apps/api/src/main.ts:32` llama `runMigrationsGated(pool, logger, { strict: config.STRICT_MIGRATION_ORDERING })`.
- `apps/api/src/db/migrator.ts:130-152`: con `strict=false`, si `runMigrations` lanza, se loguea ERROR y **no** se relanza. El servidor arranca y atiende tráfico.
- `apps/api/src/config.ts`: `STRICT_MIGRATION_ORDERING: booleanFlag(false)`.
- `infrastructure/variables.tf:191-195`: `strict_migration_ordering` con `default = false`. `infrastructure/compute.tf:265` lo cablea al servicio. No hay `.tfvars` que lo cambie.
- Drizzle 0.45.2 (`pg-core/dialect.js`, `migrate()`): todas las migraciones pendientes corren dentro de **una sola** `session.transaction`. Si 0058 falla, se revierte el lote completo, incluidas otras migraciones pendientes del mismo deploy.

**Consecuencia real si hay RUTs duplicados.** El canary pasa. El índice no existe. El `409 rut_already_registered` del código nuevo (que depende del `23505` sobre `uq_usuarios_rut`) no tiene en qué apoyarse. Cada revisión nueva reintenta y falla igual, en silencio salvo por el log. Ninguna migración posterior a 0058 llega a aplicarse mientras tanto.

**Acción.** La consulta previa del plan sigue siendo correcta y necesaria. Falta una de estas dos cosas, y es decisión del PO porque toca infra:

- (a) Este deploy va con `strict_migration_ordering = true` (apply de Terraform previo). Entonces sí: si 0058 falla, la revisión no arranca y el canary no promueve.
- (b) Se mantiene `false` y el plan agrega una verificación post-deploy explícita, bloqueante para dar el bloque por cerrado:

  ```sql
  SELECT indexname FROM pg_indexes
  WHERE tablename = 'usuarios' AND indexname = 'uq_usuarios_rut';
  ```

  más la ausencia en Cloud Logging del mensaje `runMigrations failed; STRICT_MIGRATION_ORDERING gating decides whether to abort startup` en la revisión nueva.

El plan hoy excluye `terraform apply` sin decir que eso deja la opción (a) fuera. Debe decirlo.

### H3 — Bloque 1: la consulta de diagnóstico compara strings crudos

**Evidencia.** `packages/shared-schemas/src/primitives/chile.ts` normaliza a canónico (sin puntos, guión, K mayúscula) y las escrituras actuales pasan por `rutSchema` (`conductores.ts:283`, `auth-driver.ts`, schemas de `auth.ts`, `empresa.ts`, `transportista.ts`, `user.ts`). Pero `usuarios.rut` **no tiene CHECK de formato** (no aparece en `apps/api/drizzle/*.sql` ni en `schema.ts`), y `domain/driver.ts:61` sigue declarando `rut: z.string().min(1)`. Filas históricas pueden no ser canónicas.

**Consecuencia.** `'12.345.678-9'` y `'12345678-9'` son strings distintos: no los detecta el índice ni la consulta del plan. Y una fila no canónica es inalcanzable por `login-rut`, que sí normaliza.

**Acción.** Segunda consulta de solo lectura, en el mismo paso:

```sql
-- duplicados tras normalizar
SELECT upper(replace(rut, '.', '')) AS rut_norm, count(*)
FROM usuarios
WHERE rut IS NOT NULL
GROUP BY 1 HAVING count(*) > 1;

-- filas no canónicas
SELECT id, rut FROM usuarios
WHERE rut IS NOT NULL AND rut <> upper(replace(rut, '.', ''));
```

Si aparece algo, mismo camino que el plan ya fija: decide el PO; el agente no normaliza, no fusiona ni borra.

**Residuo aceptado.** Dos altas simultáneas del mismo RUT entre la consulta y la creación del índice pueden producir un duplicado. Ventana pequeña; vale dejarlo escrito.

### H4 — Bloque 4: contradicción interna y lista de claves imprecisa

**Contradicción.** El plan dice que cada clave «gana el id de la empresa activa **al inicio**» y que «las invalidaciones existentes se quedan». Si el id va primero (`[empresaId, 'vehiculos']`), las invalidaciones por prefijo del tipo `invalidateQueries({ queryKey: ['vehiculos'] })` dejan de matchear. Hay 14 usos de `['vehiculos'...]`, 6 de `conductores`, 6 de `sucursales`, 5 de `offers`, 5 de `cargas`. El id tiene que ir **después** del segmento de dominio (`['vehiculos', empresaId, ...]`), o salir de una fábrica de claves (`apps/web/src/lib/query-keys.ts`) que garantice la posición.

**Lista vs. código.** Inventario real de primeros segmentos de `queryKey` en `apps/web/src`:

| En el plan | En el código | Nota |
|---|---|---|
| `vehiculos`, `flota` | `vehiculos`, `flota` | OK |
| `vehiculos-lista`, `vehiculo-live`, `vehiculo-historial` | no son claves | usan `['vehiculos', id, ...]`, acotadas por vehículo. No hace falta tocarlas |
| `trayectos-teltonika` | `trayectos-teltonika` | OK |
| `conductores`, `sucursales`, `cumplimiento` | iguales | OK |
| `certificados` | `certificates` | nombre distinto |
| `cargas`, `servicios` (`assignments`), `offers`, `liquidaciones`, `cobra-hoy` | `cargas`, `['assignments','empresa']`, `offers`, `liquidaciones`, `cobra-hoy` | OK |
| falta | `conductores-list-for-assignment` (`DriverAssignmentCard.tsx:69`) | es de la empresa activa, debe entrar |

`documentos` y `transport-documents` van acotadas por `entityId`/`tripId`: quedan fuera con razón. `admin-pending-device` y `my-vehicles` ya llevan `empresaId` (`admin-dispositivos.tsx:69,80`).

**Mecanismo mal descrito.** `useSwitchCompany` (`apps/web/src/hooks/use-switch-company.ts:38-39`) hace `setActiveEmpresaId` y `queryClient.invalidateQueries()`. `invalidateQueries` cancela los refetch en vuelo de las queries **activas** (`cancelRefetch` por defecto), así que «la respuesta de A aterriza después del cambio» ocurre sobre todo en queries inactivas. El hueco visible es otro: la caché de A se muestra como placeholder mientras llega B. Poner el id en la clave cubre ambos; el test debe afirmar eso. Un `cancelQueries()` antes del `invalidateQueries()` en el hook es barato y suma.

**Test.** El plan pide «un test del hook» que compruebe que la clave de A y la de B no son la misma. El hook no construye claves. Ese test pertenece a la fábrica de claves; sin fábrica, el test queda en cada componente y no prueba nada general.

### H5 — Bloque 5: no dice cómo resuelve Firebase ni los RUTs de los fixtures

**Evidencia.** `/auth/activar` crea el usuario Firebase y devuelve un custom token (`.specs/equipo-de-la-empresa/spec.md:71`). El job de integración (`.github/workflows/ci.yml:165-219`) levanta **solo** Postgres y Redis. El emulador de Auth corre en otro job («E2E conductor (Auth emulator + API local)»).

**Acción.** El plan debe decir si T6 usa el emulador dentro del job de integración, un seam inyectable para Firebase, o parte la cadena en dos. Y por H1: los fixtures de T6 necesitan RUTs únicos o limpieza por test, porque 0058 ya estará aplicada en esa base.

### H6 — Menores

- **Bloque 6, umbrales.** `apps/api/vitest.config.ts:38-41` fija `functions: 75`; `ci.yml:21-23` exige `COVERAGE_MIN_FUNCTIONS: 80`. El gate que bloquea es el de CI. El plan debería nombrar el 80 % de funciones, no solo líneas.
- **Rama.** `cursor/...` no sigue `fix/<slug>`. Con squash merge lo que importa es el título del PR; conviene que sea Conventional Commit con scope.
- **Verificación por bloque.** Solo los bloques 2 y 4 dicen qué test los cierra. 1, 3 y 5 necesitan su criterio de verificación escrito.
- **Fecha.** El plan dice 2026-10-06; la spec, 2026-10-05. Cosmético.

## 3. Lo que sí se sostiene

- **Bloque 2.** `apps/api/src/routes/chat.ts:333-341` resuelve el cursor con `.where(eq(chatMessages.id, cursor))`, sin `assignment_id`. El `WHERE` de la lista (344-349) sí filtra por asignación. El cambio y el test propuestos son los correctos. El id es UUID aleatorio, así que la fuga exige conocer un id ajeno; igual hay que cerrarla.
- **Bloque 3.** `admin-dispositivos.ts:200-209` responde 403 `platform_admin_required` siempre. `admin-dispositivos-plataforma.ts:27-30` expone listar, vehículos, asignar y habilitar; no hay rechazo. `vehiculos.ts:1043` mantiene el override de dos pasos (`imei_rechazado` + `confirmar_reasociacion`, líneas 1138-1139). Añadir el rechazo al router de plataforma es coherente con D2b.
- **No entra.** `teltonika_imei_espejo` está en `apps/api/drizzle/0024_demo_seed_espejo.sql:32`; el Slot 2 de `docs/frentes-vivos.md:63` es limpieza demo. `.specs/censo-multi-tenant-2026-07-14/rls-viabilidad.md:13` dice lo que el plan cita: rol único `booster_app` dueño de las tablas, RLS sin `FORCE` es no-op.
- **T6.** Existe en `.specs/alta-desde-panel-admin/spec.md:149` y no tiene test de integración (solo `bootstrap-platform-admin` toca esa zona).
- **Ya cerrado.** Coincide con los commits de la rama; no se re-verificó el detalle de cada fix porque es objeto del review del build, no de este.

## 4. Orden recomendado

0. Arreglar el fixture rojo de `conductores-fecha-licencia` (H1). CI verde antes de seguir.
1. Bloque 1 con las dos consultas (H3) y la decisión (a)/(b) de H2 escrita en el plan, con su verificación post-deploy.
2. Bloque 2 tal como está.
3. Bloque 3 tal como está, más su criterio de verificación.
4. Bloque 4 con el id después del dominio, la lista corregida, fábrica de claves y su test.
5. Bloque 5 con Firebase resuelto y fixtures con RUT único.
6. Bloque 6 contra el umbral de CI (80/75/80).

## 5. Evidencia consultada

- Rama `github/cursor/aislamiento-multi-tenant-4567` @ `8c46308`, base `dca3982` (= `github/main` al momento de la revisión).
- PR #739: cuerpo, `gh pr checks`, log del job 112042742762.
- Run de `main` 36498149723 (ci.yml, success) y 37293367416 (security.yml, failure).
- Archivos citados en cada hallazgo, leídos con `git show`/`git grep` sobre la rama.
- `node_modules/.pnpm/drizzle-orm@0.45.2*/node_modules/drizzle-orm/pg-core/dialect.js`, función `migrate`.
