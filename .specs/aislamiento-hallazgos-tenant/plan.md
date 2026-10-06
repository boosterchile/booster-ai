# Plan: lo que la revisión multi-tenant todavía no cierra

- Date: 2026-10-06
- Status: Plan — no se construye hasta seguir este orden
- Spec de lo ya hecho: `.specs/aislamiento-hallazgos-tenant/spec.md`
- PR: el mismo frente, `cursor/aislamiento-multi-tenant-4567`

## Ya cerrado (no se reabre)

- Invitar un RUT existente no reescribe pin ni clave. `/auth/activar` no toca una cuenta viva.
- La empresa no lista la bandeja Teltonika ni rechaza un pending ajeno. Busca por IMEI y la respuesta no trae IP.
- La zona stakeholder exige consent de `emisiones_carbono`, coincide la región y responde 403 si hay `sector_ambito`. El audit se escribe antes de responder.
- `uq_usuarios_rut` está en la migración 0058. No borra filas.
- Postgres RLS no se implementa. La decisión está en `.specs/censo-multi-tenant-2026-07-14/rls-viabilidad.md`. El control sigue siendo `pnpm lint:rls`.

## Orden

Cada bloque termina antes de abrir el siguiente. Ninguno deduplica datos ni inventa una columna.

### 1. Saber si 0058 puede aplicar

La migración corre al arrancar el servicio. Si hay dos filas con el mismo RUT no nulo, el `CREATE UNIQUE INDEX` falla y el deploy no queda sano.

Consulta de solo lectura, antes de cualquier deploy que incluya 0058:

```sql
SELECT rut, count(*)
FROM usuarios
WHERE rut IS NOT NULL
GROUP BY rut
HAVING count(*) > 1;
```

- Cero filas: no hay nada que fusionar. 0058 aplica sola.
- Una o más filas: se detiene. No se usa `apps/api/src/jobs/merge-duplicate-users.ts` para esto. Ese job fusiona por email, borra una fila y aborta si ambas tienen membresías. Un RUT repetido puede ser la misma persona o dos. Cada par lo decide el PO. El agente no borra ni reasigna.

### 2. Cursor de chat atado a la asignación

`GET /assignments/:id/messages` ya exige `resolveChatAccess` sobre esa asignación. El cursor no: busca `chat_messages.id` sin `assignment_id` (`apps/api/src/routes/chat.ts`). Quien conoce un id de otro chat se entera de que existe y usa su `created_at` como corte de su propia lista.

Cambio: el `WHERE` del cursor incluye `assignment_id` de la ruta. Si no está en esa asignación, 400 `invalid_cursor`, igual que si no existe. No se distingue. Test de ruta: cursor de otra asignación no cambia la página y no devuelve `created_at`.

### 3. Rechazo de pending solo en plataforma

La empresa sigue en 403. Hoy nadie puede marcar un pending como `rechazado`: el router de plataforma lista y asigna, y no tiene rechazo.

Agregar `POST /admin/plataforma/dispositivos/:id/rechazar` con `requirePlatformAdmin`, el mismo `UPDATE` que antes hacía la empresa (`status = rechazado`, notas opcionales, solo si sigue `pendiente`). La UI va en el panel de plataforma, no en el de la empresa. El override de dos pasos del `PATCH /vehiculos/:id/dispositivo` se queda: un rechazo histórico sigue siendo reversible por el dueño del vehículo.

No es un contrato nuevo de la empresa. Es la misma acción, en el router que ya ve todos los equipos.

### 4. La caché del cliente no mezcla empresas

`useSwitchCompany` ya invalida todas las queries. El hueco es otro: la respuesta de la empresa A puede aterrizar después del cambio y guardarse en una clave que no nombra a la empresa. La pantalla de dispositivos ya incluye `empresaId`. Estas claves de datos de la empresa activa no:

- `vehiculos`, `vehiculos-lista`, `flota`, `trayectos-teltonika`, `vehiculo-live`, `vehiculo-historial`
- `conductores`, `sucursales`, `cumplimiento`, `certificados`
- `cargas`, `servicios` (`assignments`), `offers`, `liquidaciones`, `cobra-hoy`

`me`, tracking público, observabilidad y ajustes del sitio no entran: no son la empresa activa, o el id ya viaja en la clave (`assignment-detail`, `cargas/:id` cuando el id es el recurso).

Cada clave de la lista gana el id de la empresa activa al inicio. Las invalidaciones existentes se quedan. Un test del hook de cambio de empresa comprueba que la clave de A y la de B no son la misma.

### 5. Cadena de alta contra Postgres

T6 de `.specs/alta-desde-panel-admin/spec.md` no tiene test. El alta real son dos llamadas, no una transacción: `POST /admin/empresas`, `PATCH` a `activa`, `POST /admin/empresas/:id/miembros`, `POST /auth/activar`, `POST /auth/login-rut`. El test de integración vive junto a `apps/api/test/integration/` y recorre esa cadena. No se reescribe el alta en una sola transacción: eso cambia el contrato que ya está en producción.

Al terminar, la misma cadena cubre el caso de RUT ya activo: membresía `activa`, `codigo_activacion` null, la clave anterior sigue sirviendo.

### 6. Evidencia que falta en el PR

Coverage del paquete API sobre los archivos de este frente (piso 80 % de líneas en el código nuevo). No es un cambio de producto. Corre después de 2–5, cuando el diff deje de moverse.

## No entra en este plan

- Columna de sector o un `scopeType` de zona. Con `sector_ambito` puesto la zona responde 403. Abrir el filtro es una decisión de producto: qué taxonomía y en qué tabla. Hasta eso, el 403 se queda.
- `teltonika_imei_espejo`. Es el espejo demo de la migración 0024: un vehículo lee la telemetría de otro IMEI. Sacarlo es el slot 2 de `docs/frentes-vivos.md` (limpieza demo), no este frente. Antes de ese slot, una consulta de solo lectura: vehículos con espejo cuya empresa no es demo. Si aparece uno, se reporta. No se apaga en silencio.
- Sumar a una persona ya activa a la empresa de quien invita. La spec de equipo lo acepta: la persona entra a los datos de quien invitó, no al revés. Cambiarlo a «la persona acepta desde su sesión» es otro contrato.
- Políticas RLS, `terraform apply`, merge a `main`, borrar filas.
