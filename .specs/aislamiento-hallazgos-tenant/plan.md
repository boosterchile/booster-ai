# Plan v2: Booster multi-tenant — qué falta para poder decirlo y probarlo

- Date: 2026-10-05 (v2; reemplaza al plan del 2026-10-06 tras `review.md`)
- Status: Plan — propuesto al PO. No se construye un bloque hasta que el PO acepte este orden y tome las decisiones de §3.
- Pedido del PO: «necesito urgente que Booster sea multi-tenant». Entra como pedido del PO en el mensaje (`docs/frentes-vivos.md` §Regla de operación), no ocupa slot, y como todo frente tiene criterio de término escrito (§1).
- Spec de lo ya cerrado: `spec.md` (dispositivos, zonas, RUT) y `.specs/aislamiento-vinculo-persona/spec.md` (clave). Revisión del plan anterior: `review.md`.
- Rama / PR: `cursor/aislamiento-multi-tenant-4567`, PR #739.

## 0. Punto de partida (verificado 2026-10-05 contra la rama y `main`)

Lo que el censo del 2026-07-14 dejó abierto para pasar de (B) «multi-tenant estructural» a (A) «ejercido como producto» ya se construyó en buena parte:

| Hueco del censo | Estado hoy | Evidencia |
|---|---|---|
| Onboarding apagado por flags | Flags encendidos en prod | #635 (2026-07-30) |
| Sin invitación de miembros | `POST /me/empresa/miembros`, `POST /admin/empresas/:id/miembros`, `/auth/activar` | #638, #640, `154c1a3` |
| Alta solo por enlace | Alta desde el panel admin | `154c1a3` (2026-09-27); criterio de término en `frentes-vivos.md` §Fuera de slot, línea base 0 filas al 2026-09-23 |
| Linter solo sobre `routes/` | `lint:rls` cubre `routes/`, `services/`, `jobs/` y raw SQL; 0 findings; 103 `// rls-allowlist:` | #609; `pnpm lint:rls` corrido hoy |
| Clave pisada al invitar un RUT existente | Cerrado | esta rama, `0300f16` |
| Bandeja Teltonika global, zonas sin consent, RUT no único | Cerrado en código; 0058 **sin aplicar en prod** | esta rama, `2ef8ba5` `9e9bfb0` `af60699` |
| RLS en Postgres | No se hace | `.specs/censo-multi-tenant-2026-07-14/rls-viabilidad.md` |

Lo que **no** existe todavía, y es lo que impide decir «multi-tenant» con prueba:

- **Ninguna prueba en runtime de aislamiento entre dos empresas.** El control es estático (`lint:rls`) y por anotación. De 99 tests unitarios en `test/unit/` solo 10 afirman un 403 por empresa ajena; de 16 tests de rutas, 2. Playwright: 0 tests de aislamiento. Son los «NO VERIFICADO» 3 y 4 del censo; siguen abiertos.
- **Dos fugas chicas conocidas** sin cerrar: el cursor de chat (§2 B) y la caché del cliente al cambiar de empresa (§2 D).
- **0058 en prod** depende de un diagnóstico que no se ha corrido y de una decisión del PO sobre el flag de migraciones (§3).
- **Especificaciones desactualizadas**: `alta-desde-panel-admin`, `equipo-de-la-empresa` y `aislamiento-vinculo-persona` siguen `Draft` con 0 criterios marcados aunque el código está en `main` o en esta rama. Nadie puede leer el estado real sin leer código.

## 1. Terminado cuando («Booster es multi-tenant»)

Cinco condiciones, observables por un tercero:

1. **Aislamiento probado en runtime.** Un test de integración contra Postgres crea dos empresas A y B con datos en cada tabla tenant-scoped del censo §2 y, con sesión de A, recorre las rutas de negocio: la lista no trae nada de B; detalle y escritura sobre un id de B responden 403 o 404, nunca 200 ni 500. Verde en CI. Las excepciones cross-tenant (matching, chat bilateral, k-anon, tracking público, platform-admin) están listadas en el mismo test, con su razón.
2. **Identidad única.** `uq_usuarios_rut` existe en prod (`pg_indexes`), la consulta de duplicados devuelve 0 filas, y la cadena alta → activar → `login-rut` tiene test de integración verde (T6 de `alta-desde-panel-admin`).
3. **Cliente sin mezcla.** Las claves de React Query de datos de la empresa activa llevan el `empresaId`; hay fábrica de claves con test. Si el PO provee una cuenta con dos empresas, además un E2E Playwright que cambia de empresa y no ve datos de la anterior.
4. **Sin fugas conocidas abiertas.** Cursor de chat atado a la asignación. Los 103 `rls-allowlist` revisados uno a uno, cada uno con una de cuatro razones (platform-admin / cross-tenant por diseño / acotado por id ya validado / pre-tenant); los que no caen en ninguna se corrigen.
5. **Estado legible.** Las tres specs `Draft` marcan sus criterios con evidencia o declaran qué falta; `frentes-vivos.md` registra este frente con este criterio.

Ya cumple: la parte estática de (4) (`lint:rls` 0 findings) y la mitad de (2) (código de 0058 y del 409 listos).

## 2. Bloques, en orden

Se cierra lo que más libera (regla 4 de `frentes-vivos.md`): primero lo que es fuga real o bloquea prod, después lo que es prueba, al final lo que es operación.

Cada bloque termina antes de abrir el siguiente, con su verificación corrida y pegada en el PR. Ninguno deduplica datos, borra filas ni aplica Terraform.

### A. 0058 a producción (identidad única) — bloqueante, S

Precondición cumplida: `review.md` H1 cerrado en `2c02bd9`, job de integración en verde.

1. **Diagnóstico de solo lectura**, antes de que una revisión con 0058 arranque en prod. Archivo listo: `scripts/sql/diag-tenant-rut-0058.sql`. Lo corre el PO, o autoriza al agente:

   ```bash
   scripts/db/agent-query.sh -f scripts/sql/diag-tenant-rut-0058.sql
   ```

   Devuelve duplicados crudos, duplicados tras normalizar (`upper(replace(rut,'.',''))`), RUTs no canónicos, índices actuales sobre `usuarios.rut`, migraciones aplicadas, empresas, altas desde el panel, usuarios con más de una empresa activa y las columnas de `dispositivos_pendientes`. El intento del agente del 2026-10-05 lo bloqueó el clasificador de permisos (lectura de prod); no se insistió por otra vía.
   - 0 duplicados en las dos consultas → sigue el paso 2.
   - ≥1 → se detiene. Cada par lo decide el PO. No se usa `jobs/merge-duplicate-users.ts` (fusiona por email y borra). El agente no borra, no fusiona, no normaliza.
2. **Decisión §3.1** (flag de migraciones) tomada y escrita acá.
3. **Deploy** por `release.yml`. Según `docs/handoff/CURRENT.md` (2026-09-22) los últimos releases abortaron en `canary-verify` por muestra insuficiente y el api se promovió a mano; si se repite, la promoción manual la hace el PO y queda anotada.
4. **Verificación post-deploy**, obligatoria en los dos caminos de §3.1:

   ```sql
   SELECT indexname FROM pg_indexes WHERE tablename = 'usuarios' AND indexname = 'uq_usuarios_rut';
   ```

   más ausencia en Cloud Logging de `runMigrations failed` en la revisión nueva. Sin esto el bloque no está cerrado aunque el canary haya pasado.

### B. Cursor de chat atado a la asignación — fuga real, S

`GET /assignments/:id/messages` ya exige `resolveChatAccess`. El cursor no: `apps/api/src/routes/chat.ts:333-341` busca `chat_messages.id` sin `assignment_id`. Quien conoce un id ajeno sabe que existe y usa su `created_at`.

Cambio: el `WHERE` del cursor incluye `assignment_id` de la ruta; si no coincide o no existe, 400 `invalid_cursor` sin distinguir. Test de ruta: cursor de otra asignación no cambia la página y no devuelve `created_at`.

### C. Prueba madre en runtime: dos empresas — M

Test de integración `apps/api/test/integration/aislamiento-dos-empresas.integration.test.ts`:

- Fixture: empresas A y B con plan, dueño, vehículo, conductor, sucursal, viaje, asignación, oferta y documento. RUTs con `test/helpers/rut-aleatorio.ts`.
- Tabla de rutas × verbo (lista, detalle, escritura) construida desde el censo §2: `vehiculos`, `conductores`, `sucursales`, viajes/cargas, `asignaciones`, `ofertas`, `documentos_*`, `documentos_transporte`, `liquidaciones`, `cobra-hoy`, `me/empresa/miembros`, `admin/dispositivos-pendientes/:id/asociar`.
- Afirmaciones con sesión de A (`X-Empresa-Id = A`): la lista no contiene ids de B; detalle y escritura sobre un id de B responden 403 o 404; nunca 200, nunca 500.
- Excepciones declaradas en el mismo archivo con `// cross-tenant por diseño: <razón>`: matching, chat bilateral (las dos partes del assignment), k-anon de zonas, tracking público, platform-admin.
- Un caso de usuario con membresía en A y B: con header de A no ve B, y viceversa.

Es el criterio 1 de §1. También prueba en runtime el «acotado por id ya validado» de la capa `services/`, que el linter solo acepta por anotación.

### D. Caché del cliente sin mezcla de empresas — S/M

`useSwitchCompany` (`apps/web/src/hooks/use-switch-company.ts`) hace `setActiveEmpresaId` + `invalidateQueries()`. El hueco: la caché de A se muestra como placeholder mientras llega B, y una query inactiva en vuelo puede escribir A bajo una clave sin empresa.

- Fábrica de claves `apps/web/src/lib/query-keys.ts`. El `empresaId` va **después** del segmento de dominio (`['vehiculos', empresaId, ...]`), nunca al inicio: hay 14 invalidaciones por prefijo `['vehiculos']`, 6 de `conductores`, 6 de `sucursales`, 5 de `offers` y 5 de `cargas` que deben seguir matcheando.
- Claves que entran (nombres reales del código): `vehiculos`, `flota`, `trayectos-teltonika`, `conductores`, `conductores-list-for-assignment`, `sucursales`, `cumplimiento`, `certificates`, `cargas`, `['assignments','empresa']`, `offers`, `liquidaciones`, `cobra-hoy`. Quedan fuera por estar acotadas por recurso: `['vehiculos', id, ...]`, `documentos`, `transport-documents`, `assignment-detail`; y las globales: `me`, `observability`, `public-*`, `consent`.
- `cancelQueries()` antes de `invalidateQueries()` en el hook.
- Test de la fábrica: la clave para A y para B difiere; el prefijo de dominio se conserva.

### E. Auditoría de los 103 `rls-allowlist` — M

Tabla en `verify.md` de este directorio: archivo:línea, razón escrita, categoría (platform-admin / cross-tenant por diseño / acotado por id validado / pre-tenant), veredicto (se sostiene / no se sostiene). Distribución actual: `admin-empresa-miembros.ts` 13, `site-settings.ts` 11, `admin-dispositivos-plataforma.ts` 11, `calcular-metricas-viaje.ts` 6, `admin-stakeholder-orgs.ts` 6, `admin-cobra-hoy.ts` 5, resto ≤4. Los «no se sostiene» se corrigen en el mismo bloque o pasan a C como caso de prueba. Sin esto, el 0 del linter es un 0 por declaración.

### F. Cadena de alta contra Postgres (T6) — M

`.specs/alta-desde-panel-admin/spec.md` T6: crear empresa desde admin → `PATCH` a `activa` → `POST /admin/empresas/:id/miembros` → `POST /auth/activar` → `POST /auth/login-rut`. Test en `apps/api/test/integration/`. Dos cosas que el plan anterior no decía:

- **Firebase**: `/auth/activar` crea el usuario Firebase y devuelve un custom token; el job de integración levanta solo Postgres y Redis (el emulador vive en el job E2E conductor). Opciones: (i) seam inyectable del cliente Firebase en el test, (ii) levantar el emulador en el job de integración. Se propone (i); se escribe acá la elección antes de construir.
- **Fixtures con RUT único** (`rut-aleatorio.ts`), porque 0058 ya está aplicada en esa base.

Al terminar, la misma cadena cubre el RUT ya activo: membresía `activa`, `codigo_activacion` null, la clave anterior sigue sirviendo.

### G. Rechazo de pending solo en plataforma — operación, S

La empresa sigue en 403. Hoy nadie puede marcar un pending como `rechazado`. `POST /admin/plataforma/dispositivos/:id/rechazar` con `requirePlatformAdmin`, mismo `UPDATE` que antes hacía la empresa (solo si sigue `pendiente`). UI en el panel de plataforma. El override de dos pasos del `PATCH /vehiculos/:id/dispositivo` se queda. Verificación: test de ruta 403 empresa / 200 plataforma / 409 si ya no está pendiente.

### H. Estado legible — docs, S

- Marcar criterios en `alta-desde-panel-admin`, `equipo-de-la-empresa` y `aislamiento-vinculo-persona` con la evidencia (PR, test) o dejar explícito qué falta. El Status deja de ser `Draft` donde el PO lo acepte.
- `frentes-vivos.md`: entrada «Booster multi-tenant» con el criterio de §1, cómo entró (pedido del PO en el mensaje) y qué queda fuera.
- Coverage del paquete API sobre los archivos del frente contra el gate real de CI (líneas 80 / ramas 75 / funciones 80; `vitest.config.ts` dice funciones 75, manda CI).

## 3. Decisiones que solo el PO puede tomar

1. **Flag de migraciones para el deploy de 0058.** Hoy `STRICT_MIGRATION_ORDERING=false` en prod (`variables.tf:191` default, sin tfvars que lo cambie; confirmado en `CURRENT.md` 2026-09-22). Con `false`, si `CREATE UNIQUE INDEX` falla, Drizzle revierte todo el lote, loguea ERROR y el servidor arranca igual: canary verde, índice ausente, 409 sin sustento. Opciones: (a) `strict_migration_ordering = true` con `terraform apply` previo, fail-closed; (b) seguir en `false` y aceptar la verificación post-deploy de A.4 como gate humano. Recomendación del agente: (a), porque es la única que hace verdad «el deploy no queda sano»; (b) es aceptable si el apply no cabe en la urgencia.
2. **Diagnóstico de prod.** Correr `scripts/sql/diag-tenant-rut-0058.sql` o autorizar al agente a correrlo con `agent-query.sh` (solo `SELECT`).
3. **Cuenta E2E con dos empresas** para el Playwright del criterio 3. Si no la hay, el criterio 3 se cumple con la fábrica de claves y su test; el E2E queda declarado como pendiente, no como hecho.
4. **Firebase en T6**: seam (i) o emulador (ii).

## 4. Esfuerzo y camino crítico

| Bloque | Tamaño | Depende de |
|---|---|---|
| A 0058 a prod | S, más la decisión §3.1 y el diagnóstico §3.2 | PO |
| B cursor chat | S | — |
| C dos empresas | M | — (la base de test ya aplica 0058 vía migrator) |
| D caché cliente | S/M | — |
| E auditoría allowlist | M | después de C si hay una sola persona |
| F T6 | M | decisión §3.4 |
| G rechazo plataforma | S | — |
| H estado legible | S | todo lo anterior |

S ≈ medio día, M ≈ uno a dos días. Camino crítico para poder decir «multi-tenant» con prueba: A → B → C → D. E, F, G y H completan el criterio pero no bloquean la afirmación.

## 5. No entra

- RLS en Postgres, roles de BD, GUC de tenant. Decidido en `rls-viabilidad.md`; el control es `lint:rls` más el bloque C.
- Columna de sector / `scopeType` de zona: con `sector_ambito` la zona responde 403 hasta que producto decida taxonomía.
- `teltonika_imei_espejo`: Slot 2 de `frentes-vivos.md`. Antes de ese slot, una consulta de solo lectura de vehículos con espejo cuya empresa no es demo; si aparece uno, se reporta.
- Ingreso de miembros a organizaciones stakeholder: cuatro bloqueos listados en `equipo-de-la-empresa` §5.
- Sumar a una persona activa a la empresa de quien invita sin que ella acepte: es otro contrato.
- `terraform apply`, merge a `main`, borrar o fusionar filas, normalizar RUTs históricos.
