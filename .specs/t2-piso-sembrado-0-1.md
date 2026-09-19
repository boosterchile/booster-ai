# T2 · Trabajo 1 — Piso sembrado 0→1 para un viaje de prueba de IDA

**Tipo:** runbook de operación (datos), no feature. No hay código de producto en este trabajo.
**Fecha:** 2026-09-18 · **Verificado contra:** `main` @ `726c6d8`, esquema hasta migración `0055`.

## 1. Qué entrega y qué NO

Deja en la base de datos el **piso mínimo** para que alguien pueda crear, matchear y despachar
un viaje de IDA de prueba:

| # | Ítem pedido | Fila que lo cumple |
|---|---|---|
| 1 | 1 empresa generadora activa | `empresas` · `estado='activa'`, `es_generador_carga=true` |
| 2 | 1 empresa transportista activa | `empresas` · `estado='activa'`, `es_transportista=true` |
| 3 | 1 zona usable para matching | `zonas` · región `13`, `tipo_zona='ambos'`, `es_activa=true` |
| 4 | 1 vehículo con capacidad | `vehiculos` · `capacidad_kg=12000`, `estado_vehiculo='activo'` |
| 5 | 1 conductor asignable | `conductores` + `usuarios` + `membresias` (rol `conductor`) |
| 6 | `carbon_measurement_enabled=true` | en la **generadora** (ver §6.1: la resolución es un OR) |

**Fuera de alcance de este trabajo** (no lo hace el SQL de abajo, a propósito):
no crea el viaje, ni la oferta, ni la asignación; no toca `conductor.tsx`; no agrega CRUD ni
endpoints; no abre PR de producto; no siembra telemetría ni certificados; no habilita
`es_demo` (ver §6.5); no crea la zona de la **vuelta** (para eso se agrega una segunda fila en
`zonas` con `codigo_region='05'`, decisión de quien corra la prueba de retorno).

**Encaje con frentes vivos:** es soporte para Slot 1 (los dos viajes reales que exige su criterio
de término) y Slot 3 (conductor de punta a punta). Es dato operativo, no ocupa slot.

## 2. Prerrequisitos

1. **Esquema al día**: la base tiene aplicadas las migraciones hasta `0055`
   (`apps/api/drizzle/`). El API las corre al arrancar (`apps/api/src/db/migrator.ts:75`).
   Verificar: `SELECT count(*) FROM drizzle.__drizzle_migrations;` debe dar 56 (una por
   entrada de `apps/api/drizzle/meta/_journal.json`; la última es `0055_fuente_dato_ruta_movil_gps`).
2. **Planes sembrados** (migración `0004`, sección 18): el SQL busca `planes.slug='estandar'`
   y aborta con `RAISE EXCEPTION` si no está.
3. **Conexión a la base**, según entorno:
   - **Local**: `psql "$DATABASE_URL"` con la URL de `apps/api/.env`
     (ejemplo en `.env.example`: `postgresql://booster:devpass@localhost:5432/booster_ai`).
   - **Producción, lectura**: `bash scripts/db/agent-query.sh -c "SELECT …"` (túnel IAP + ADC).
   - **Producción, escritura**: `bash scripts/db/connect.sh -f <archivo.sql>`.
     ⚠️ **Sembrar en producción es una escritura visible en el marketplace: requiere OK explícito
     del PO antes de correrlo.** Las filas quedan marcadas con el prefijo `T2` en `razon_social`,
     `patente` y `licencia_numero`, y con UUID prefijo `7e572002-…` para poder revertirlas (§7).
4. **Hash de la clave numérica** de los 3 usuarios (§4). Sin eso nadie puede iniciar sesión.

> No hay RLS en la base (`grep -l "ROW LEVEL SECURITY" apps/api/drizzle/*.sql` → vacío): los
> `INSERT` no necesitan variables de sesión.

## 3. IDs a usar

UUID fijos (idempotencia y limpieza). Prefijo `7e572002` = "test T2".

| Entidad | UUID | Identificador de negocio |
|---|---|---|
| Empresa generadora | `7e572002-0000-4000-8000-000000000001` | RUT `76543210-3` |
| Empresa transportista | `7e572002-0000-4000-8000-000000000002` | RUT `78123456-7` |
| Usuario titular generadora | `7e572002-0000-4000-8000-000000000011` | RUT `72727272-0` |
| Usuario titular transportista | `7e572002-0000-4000-8000-000000000012` | RUT `70707070-6` |
| Usuario conductor | `7e572002-0000-4000-8000-000000000013` | RUT `71717171-3` |
| Membresía titular generadora (`dueno`) | `7e572002-0000-4000-8000-000000000021` | — |
| Membresía titular transportista (`dueno`) | `7e572002-0000-4000-8000-000000000022` | — |
| Membresía conductor (`conductor`) | `7e572002-0000-4000-8000-000000000023` | — |
| Vehículo | `7e572002-0000-4000-8000-000000000031` | patente `T2TEST` |
| Zona (región 13, `ambos`) | `7e572002-0000-4000-8000-000000000041` | — |
| Conductor | `7e572002-0000-4000-8000-000000000051` | licencia `T2-LIC-0001` |

Los RUT tienen dígito verificador válido (módulo 11) y van en el formato normalizado que produce
`rutSchema` (sin puntos, con guion). Los correos usan el dominio reservado `.invalid` y ya vienen
con la forma sintética que `POST /auth/login-rut` escribiría después
(`users+<rut sin guion>@boosterchile.invalid`, `apps/api/src/routes/auth-universal.ts:23`), para
que el primer login no choque con el UNIQUE de `usuarios.email`.

**Para el viaje de IDA que se cree después de este piso:**
- origen región `'13'` (RM) — es la que hace match con la zona sembrada;
- destino región `'05'` (Valparaíso) u otra cualquiera: el matching v1 **no mira el destino**;
- `carga_peso_kg` ≤ **12000** (capacidad del vehículo sembrado); recomendado 8000.

## 4. Paso previo: hash de la clave numérica

Los 3 usuarios entran por RUT + clave de 6 dígitos (ADR-035). La columna guarda un hash scrypt
con formato `salt$N$r$p$keylen$derived`; hay que generarlo fuera de SQL.

**Opción A — con la función del repo** (sin riesgo de divergencia de formato):

```bash
cat > /tmp/hash-clave.ts <<'EOF'
import { hashClaveNumerica } from '/Users/felipevicencio/booster-ai/apps/api/src/services/clave-numerica.ts';
console.log(hashClaveNumerica(process.argv[2]));
EOF
cd /Users/felipevicencio/booster-ai/apps/api && pnpm exec tsx /tmp/hash-clave.ts 482913
```

**Opción B — Node puro** (misma receta scrypt: `N=2^14, r=8, p=1, keyLen=64`):

```bash
node -e 'const {randomBytes,scryptSync}=require("node:crypto");const c=process.argv[1];const N=2**14,r=8,p=1,L=64;const s=randomBytes(16);console.log([s.toString("hex"),N,r,p,L,scryptSync(c,s,L,{N,r,p}).toString("hex")].join("$"))' 482913
```

Ambas salidas fueron verificadas contra `verifyClaveNumerica` (`true` con la clave correcta,
`false` con otra). Usar una clave **aleatoria**, no `123456`; la misma para los 3 usuarios es
aceptable en una cuenta de prueba, y se rota desde `/perfil/seguridad`.

## 5. El seed

Guardar como `scripts/sql/t2-piso-sembrado.sql` (o donde prefiera quien lo corra), **editar la
sección CONFIG**, y ejecutar:

```bash
psql "$DATABASE_URL" -f scripts/sql/t2-piso-sembrado.sql
```

Bloque `DO` (PL/pgSQL) para que funcione igual por `psql -f` que por `agent-query.sh -f`, que
ejecuta con `psql -c` y no procesa meta-comandos. Idempotente (`ON CONFLICT (id) DO UPDATE`) y
atómico.

```sql
-- =============================================================================
-- T2 · Trabajo 1 — piso sembrado para un viaje de prueba de IDA
-- =============================================================================
-- Crea: generadora activa + transportista activa + zona de matching + vehículo
-- con capacidad + conductor asignable + opt-in de huella.
-- NO crea viaje/oferta/asignación. Revertir con el bloque de §7 del runbook.
-- =============================================================================
DO $$
DECLARE
  ---------------------------------------------------------------------------
  -- CONFIG — editar antes de correr
  ---------------------------------------------------------------------------
  -- Hash scrypt de la clave numérica de los 3 usuarios (ver §4 del runbook).
  v_clave_hash text := 'PEGAR_HASH_AQUI';
  -- WhatsApp E.164 del titular del TRANSPORTISTA. Si queda NULL, la oferta se
  -- crea igual pero no se notifica (notify-offer.ts:113 → reason 'no_whatsapp');
  -- el transportista la ve igual entrando a la web.
  v_wsp_transportista text := NULL;   -- p.ej. '+56912345678'

  v_plan uuid;

  -- IDs fijos (ver §3)
  v_emp_gen  uuid := '7e572002-0000-4000-8000-000000000001';
  v_emp_tra  uuid := '7e572002-0000-4000-8000-000000000002';
  v_usr_gen  uuid := '7e572002-0000-4000-8000-000000000011';
  v_usr_tra  uuid := '7e572002-0000-4000-8000-000000000012';
  v_usr_con  uuid := '7e572002-0000-4000-8000-000000000013';
  v_mem_gen  uuid := '7e572002-0000-4000-8000-000000000021';
  v_mem_tra  uuid := '7e572002-0000-4000-8000-000000000022';
  v_mem_con  uuid := '7e572002-0000-4000-8000-000000000023';
  v_veh      uuid := '7e572002-0000-4000-8000-000000000031';
  v_zona     uuid := '7e572002-0000-4000-8000-000000000041';
  v_cond     uuid := '7e572002-0000-4000-8000-000000000051';
BEGIN
  -- Guard de formato (no de valor): así un search&replace del placeholder no
  -- puede desactivar el chequeo. Formato scrypt: salt$N$r$p$keylen$derived.
  IF v_clave_hash !~ '^[0-9a-f]+\$16384\$8\$1\$64\$[0-9a-f]+$' THEN
    RAISE EXCEPTION 'v_clave_hash no tiene formato scrypt válido (ver §4 del runbook)';
  END IF;

  SELECT id INTO v_plan FROM planes WHERE slug = 'estandar';
  IF v_plan IS NULL THEN
    RAISE EXCEPTION 'No existe el plan "estandar": falta el seed de la migración 0004';
  END IF;

  -- 1) EMPRESA GENERADORA (activa, con opt-in de huella)
  INSERT INTO empresas (
    id, razon_social, rut, email_contacto, telefono_contacto,
    direccion_calle, direccion_ciudad, direccion_region,
    es_generador_carga, es_transportista, carbon_measurement_enabled,
    plan_id, estado
  ) VALUES (
    v_emp_gen, 'T2 Generadora de Prueba SpA', '76543210-3',
    't2-generadora@boosterchile.invalid', '+56911111111',
    'Av. Américo Vespucio 1001', 'Pudahuel', '13',
    true, false, true,
    v_plan, 'activa'
  )
  ON CONFLICT (id) DO UPDATE SET
    es_generador_carga = EXCLUDED.es_generador_carga,
    carbon_measurement_enabled = EXCLUDED.carbon_measurement_enabled,
    estado = EXCLUDED.estado,
    actualizado_en = now();

  -- 2) EMPRESA TRANSPORTISTA (activa)
  INSERT INTO empresas (
    id, razon_social, rut, email_contacto, telefono_contacto,
    direccion_calle, direccion_ciudad, direccion_region,
    es_generador_carga, es_transportista, carbon_measurement_enabled,
    plan_id, estado
  ) VALUES (
    v_emp_tra, 'T2 Transportes de Prueba SpA', '78123456-7',
    't2-transportista@boosterchile.invalid', '+56922222222',
    'Camino a Melipilla 5000', 'Maipú', '13',
    false, true, false,
    v_plan, 'activa'
  )
  ON CONFLICT (id) DO UPDATE SET
    es_transportista = EXCLUDED.es_transportista,
    estado = EXCLUDED.estado,
    actualizado_en = now();

  -- 3) USUARIOS. firebase_uid placeholder 'pending-rut:<rut>': el primer
  --    POST /auth/login-rut crea el usuario Firebase y lo promueve solo
  --    (auth-universal.ts:166-190). Por eso el DO UPDATE NO toca firebase_uid
  --    ni email: re-correr el seed después del primer login no debe degradarlos.
  INSERT INTO usuarios (id, firebase_uid, email, nombre_completo, whatsapp_e164, rut, estado, clave_numerica_hash)
  VALUES
    (v_usr_gen, 'pending-rut:72727272-0', 'users+727272720@boosterchile.invalid',
     'Titular T2 Generadora', NULL, '72727272-0', 'activo', v_clave_hash),
    (v_usr_tra, 'pending-rut:70707070-6', 'users+707070706@boosterchile.invalid',
     'Titular T2 Transportista', v_wsp_transportista, '70707070-6', 'activo', v_clave_hash),
    (v_usr_con, 'pending-rut:71717171-3', 'users+717171713@boosterchile.invalid',
     'Conductor de prueba T2', NULL, '71717171-3', 'activo', v_clave_hash)
  ON CONFLICT (id) DO UPDATE SET
    clave_numerica_hash = EXCLUDED.clave_numerica_hash,
    whatsapp_e164 = EXCLUDED.whatsapp_e164,
    estado = EXCLUDED.estado,
    actualizado_en = now();

  -- 4) MEMBRESÍAS activas (user-context.ts:68 exige estado='activa')
  INSERT INTO membresias (id, usuario_id, empresa_id, rol, estado, unido_en)
  VALUES
    (v_mem_gen, v_usr_gen, v_emp_gen, 'dueno', 'activa', now()),
    (v_mem_tra, v_usr_tra, v_emp_tra, 'dueno', 'activa', now()),
    (v_mem_con, v_usr_con, v_emp_tra, 'conductor', 'activa', now())
  ON CONFLICT (id) DO UPDATE SET
    rol = EXCLUDED.rol,
    estado = EXCLUDED.estado,
    actualizado_en = now();

  -- 5) ZONA de recogida usable por el matching (region = origen del viaje)
  INSERT INTO zonas (id, empresa_id, codigo_region, codigos_comuna, tipo_zona, es_activa)
  VALUES (v_zona, v_emp_tra, '13', NULL, 'ambos', true)
  ON CONFLICT (id) DO UPDATE SET
    codigo_region = EXCLUDED.codigo_region,
    tipo_zona = EXCLUDED.tipo_zona,
    es_activa = EXCLUDED.es_activa,
    actualizado_en = now();

  -- 6) VEHÍCULO con capacidad + perfil energético completo
  --    (combustible + consumo base ⇒ huella 'modelado' en vez de 'por_defecto',
  --     calcular-metricas-viaje.ts:57-70).
  INSERT INTO vehiculos (
    id, empresa_id, patente, tipo_vehiculo, capacidad_kg, capacidad_m3,
    anio, marca, modelo, tipo_combustible, peso_vacio_kg,
    consumo_l_por_100km_base, estado_vehiculo,
    categoria_unidad, tipo_unidad, carroceria
  ) VALUES (
    v_veh, v_emp_tra, 'T2TEST', 'camion_mediano', 12000, 45,
    2021, 'Prueba', 'T2', 'diesel', 7500,
    28.50, 'activo',
    'motriz', 'camion_rigido', 'furgon_cerrado'
  )
  ON CONFLICT (id) DO UPDATE SET
    capacidad_kg = EXCLUDED.capacidad_kg,
    estado_vehiculo = EXCLUDED.estado_vehiculo,
    tipo_combustible = EXCLUDED.tipo_combustible,
    consumo_l_por_100km_base = EXCLUDED.consumo_l_por_100km_base,
    actualizado_en = now();

  -- 7) CONDUCTOR asignable (asignar-conductor-a-assignment.ts:135-146 exige
  --    fila en conductores de ESA empresa con eliminado_en IS NULL)
  INSERT INTO conductores (
    id, usuario_id, empresa_id, licencia_clase, licencia_numero,
    licencia_vencimiento, es_extranjero, estado_conductor
  ) VALUES (
    v_cond, v_usr_con, v_emp_tra, 'A5', 'T2-LIC-0001',
    DATE '2028-12-31', false, 'activo'
  )
  ON CONFLICT (id) DO UPDATE SET
    estado_conductor = EXCLUDED.estado_conductor,
    licencia_vencimiento = EXCLUDED.licencia_vencimiento,
    eliminado_en = NULL,
    actualizado_en = now();

  RAISE NOTICE 'Piso T2 sembrado: generadora=% transportista=% zona=% vehiculo=% conductor=%',
    v_emp_gen, v_emp_tra, v_zona, v_veh, v_cond;
END $$;
```

## 6. Verificación

### 6.0 Los 6 ítems, una fila por ítem

```sql
SELECT 'generadora activa'        AS item,
       (SELECT count(*) FROM empresas
         WHERE id='7e572002-0000-4000-8000-000000000001'
           AND estado='activa' AND es_generador_carga) AS ok
UNION ALL SELECT 'transportista activa',
       (SELECT count(*) FROM empresas
         WHERE id='7e572002-0000-4000-8000-000000000002'
           AND estado='activa' AND es_transportista)
UNION ALL SELECT 'zona usable para matching',
       (SELECT count(*) FROM zonas
         WHERE id='7e572002-0000-4000-8000-000000000041'
           AND es_activa AND tipo_zona IN ('recogida','ambos') AND codigo_region='13')
UNION ALL SELECT 'vehiculo con capacidad',
       (SELECT count(*) FROM vehiculos
         WHERE id='7e572002-0000-4000-8000-000000000031'
           AND estado_vehiculo='activo' AND capacidad_kg >= 8000)
UNION ALL SELECT 'conductor asignable',
       (SELECT count(*) FROM conductores c
          JOIN membresias m ON m.usuario_id=c.usuario_id AND m.empresa_id=c.empresa_id
         WHERE c.id='7e572002-0000-4000-8000-000000000051'
           AND c.eliminado_en IS NULL AND c.estado_conductor='activo'
           AND m.rol='conductor' AND m.estado='activa')
UNION ALL SELECT 'carbon_measurement_enabled',
       (SELECT count(*) FROM empresas
         WHERE id IN ('7e572002-0000-4000-8000-000000000001',
                      '7e572002-0000-4000-8000-000000000002')
           AND carbon_measurement_enabled);
```

**Esperado: `ok = 1` en las 6 filas.**

### 6.1 La zona sirve de verdad: dry-run del matching v1

Réplica exacta del filtro de candidatos de `runMatching` (`apps/api/src/services/matching.ts:159-233`)
para un viaje con origen región `13` y 8.000 kg:

```sql
SELECT e.razon_social, e.estado, z.codigo_region, z.tipo_zona,
       v.patente, v.capacidad_kg
FROM zonas z
JOIN empresas e  ON e.id = z.empresa_id
JOIN vehiculos v ON v.empresa_id = e.id
WHERE z.codigo_region = '13'
  AND z.tipo_zona IN ('recogida','ambos')
  AND z.es_activa
  AND e.es_transportista
  AND e.estado = 'activa'
  AND v.estado_vehiculo = 'activo'
  AND v.capacidad_kg >= 8000
ORDER BY v.capacidad_kg, v.id;
```

**Esperado:** al menos la fila `T2 Transportes de Prueba SpA / T2TEST / 12000`. Si sale vacío, el
viaje terminará en `expirado` con motivo `no_carrier_in_origin_region`, `no_active_carriers` o
`no_vehicle_with_capacity` según cuál de las tres condiciones falle.

Notas del matching que conviene tener presente al leer el resultado:
- El **destino no participa** del filtro; la zona `ambos` cubre la ida (`recogida`) y deja
  preparada la vuelta si más adelante se agrega la zona de la otra región.
- `codigos_comuna = NULL` significa *toda la región*; el matching v1 no mira comunas.
- Con `MATCHING_ALGORITHM_V2_ACTIVATED` (default `false`, `apps/api/src/config.ts:425`) cambia
  el **scoring**, no este conjunto de candidatos.
- Se emiten hasta 5 ofertas por viaje y expiran a los 60 min
  (`packages/matching-algorithm/src/index.ts:29,31`).

### 6.2 Opt-in de huella

```sql
SELECT razon_social, carbon_measurement_enabled FROM empresas
WHERE id IN ('7e572002-0000-4000-8000-000000000001','7e572002-0000-4000-8000-000000000002');
```

El opt-in efectivo de un viaje es
`viajes.carbon_measurement_override ?? (generadora.flag OR transportista.flag)`
(`apps/api/src/services/resolver-opt-in-huella.ts`). Con el flag en la **generadora** basta para
que el viaje mida. Si se quiere probar el caso "solo transportista", basta un `UPDATE` sobre la
otra empresa: no hace falta re-sembrar.

### 6.3 Los usuarios pueden entrar

```bash
curl -sS -X POST "$API_BASE/auth/login-rut" \
  -H 'content-type: application/json' \
  -d '{"rut":"71717171-3","clave":"482913"}' | head -c 400
```

**Esperado:** JSON con `custom_token`, `synthetic_email` y `auth_method:"rut_clave"`.
- `401 invalid_credentials` → RUT o clave mal, o `usuarios.estado` suspendido/eliminado.
- `410 needs_activation` → el usuario quedó con `activacion_pin_hash` y sin clave: no es el caso
  de este seed (acá se siembra la clave directo, sin PIN).
- El endpoint está detrás de un rate-limit Redis **fail-closed**: sin Redis arriba no responde
  (`apps/api/src/routes/auth-universal.ts:57-62`).

Tras el primer login, comprobar la promoción del `firebase_uid`:

```sql
SELECT rut, left(firebase_uid, 12) AS uid_prefijo, email, estado, ultimo_login_en
FROM usuarios WHERE id::text LIKE '7e572002%';
```

`uid_prefijo` deja de ser `pending-rut:` cuando el usuario entró al menos una vez.

### 6.4 Gotcha verificado: "asignable" ≠ "visible en el selector"

El backend acepta asignar cualquier conductor de la empresa con `eliminado_en IS NULL`
(`asignar-conductor-a-assignment.ts:135-146`) — **no mira `estado_conductor`**. Pero la tarjeta
del despachador filtra `!c.user.is_pending`
(`apps/web/src/components/scoring/DriverAssignmentCard.tsx:79-80`), y `is_pending` es verdadero
mientras el `firebase_uid` empiece con `pending-rut:`.

**Consecuencia operativa: el conductor sembrado no aparece en el selector hasta que inicie sesión
una vez** (§6.3). Si se necesita despachar antes, se asigna por API
(`POST /assignments/:id/asignar-conductor`, rol `dueno|admin|despachador`).

Comprobación directa:

```sql
SELECT u.nombre_completo,
       (u.firebase_uid LIKE 'pending-rut:%') AS is_pending_en_la_ui,
       c.estado_conductor, c.eliminado_en
FROM conductores c JOIN usuarios u ON u.id = c.usuario_id
WHERE c.id = '7e572002-0000-4000-8000-000000000051';
```

(El mismo filtro de la UI compara además contra `status !== 'baja'`, valor que no existe en el
enum `estado_conductor` —`activo|suspendido|en_viaje|fuera_servicio`—, así que hoy no filtra nada.
Se deja anotado; corregirlo es cambio de producto, fuera de este trabajo.)

### 6.5 Lo que este seed deliberadamente NO enciende

- **`es_demo`**: dejarlo en `false`. Encenderlo expone las empresas a `/demo/login` y al
  lifecycle demo (TTL/retire), justo la superficie que el Slot 2 está desmontando.
- **`es_usuario_prueba`**: en `false`. Encenderlo (un `UPDATE` de una línea) habilita que el
  platform-admin **impersone** estas empresas y escriba desde esa sesión. Es útil si el PO
  prefiere impersonar en vez de manejar 3 logins; queda como decisión suya, no del seed.
- **`compliance_habilitado`**: en `false`, así el módulo de documentos/mantenimientos del
  transportista no aparece ni exige papeles para esta prueba.

### 6.6 Antes de cerrar el viaje de prueba (aguas abajo, verificar en el entorno)

El cierre de entrega exige ≥1 documento subido solo si **además** de
`REQUIRE_DOCUMENT_TO_CLOSE` (default `true`) está definida `REQUIRE_DOCUMENT_TO_CLOSE_SINCE`; sin
esa fecha de corte el guard no se aplica (`apps/api/src/config.ts:193-205`). Confirmar en el
entorno donde se corra la prueba **antes** de llegar a la entrega:

```bash
gcloud run services describe booster-api --region southamerica-west1 \
  --format='value(spec.template.spec.containers[0].env)' | tr ',' '\n' | grep -i REQUIRE_DOCUMENT
```

Sin salida ⇒ la variable no está seteada ⇒ el cierre no pide documento.

## 7. Revertir

Las FK son `ON DELETE RESTRICT`: si el piso ya tiene viajes/ofertas/asignaciones colgando, el
borrado falla en vez de arrastrarlos. Primero mirar qué quedó pegado:

```sql
SELECT 'viajes' AS tabla, count(*) FROM viajes
  WHERE generador_carga_empresa_id = '7e572002-0000-4000-8000-000000000001'
UNION ALL SELECT 'ofertas', count(*) FROM ofertas
  WHERE empresa_id = '7e572002-0000-4000-8000-000000000002'
UNION ALL SELECT 'asignaciones', count(*) FROM asignaciones
  WHERE empresa_id = '7e572002-0000-4000-8000-000000000002';
```

Con las tres en 0, el rollback del piso es:

```sql
BEGIN;
DELETE FROM conductores WHERE id = '7e572002-0000-4000-8000-000000000051';
DELETE FROM membresias  WHERE id::text LIKE '7e572002%';
DELETE FROM vehiculos   WHERE id = '7e572002-0000-4000-8000-000000000031';
DELETE FROM zonas       WHERE id = '7e572002-0000-4000-8000-000000000041';
DELETE FROM usuarios    WHERE id::text LIKE '7e572002%';
DELETE FROM empresas    WHERE id::text LIKE '7e572002%';
COMMIT;
```

Si hay filas dependientes y la prueba ya terminó, la vía limpia es **desactivar** en vez de
borrar: `UPDATE empresas SET estado='suspendida' WHERE id::text LIKE '7e572002%';` y
`UPDATE zonas SET es_activa=false WHERE id='7e572002-0000-4000-8000-000000000041';` — con eso
dejan de aparecer como candidatas del matching sin tocar el histórico.

## 8. Estado de verificación de este runbook

- **Verificado leyendo el código** (`main` @ `726c6d8`): nombres y tipos de columnas contra
  `apps/api/src/db/schema.ts`; filtro de candidatos del matching (`services/matching.ts:159-233`);
  reglas de asignación de conductor (`services/asignar-conductor-a-assignment.ts:135-146`);
  gates de `requireShipperAuth` / `requireCarrierAuth` (`routes/trip-requests-v2.ts:133-162`,
  `routes/assignments.ts:110-136`); resolución de membresía activa (`services/user-context.ts:51-89`);
  promoción del `firebase_uid` en login (`routes/auth-universal.ts:150-200`); filtro del selector
  de conductores (`apps/web/src/components/scoring/DriverAssignmentCard.tsx:79-80`); destinatario
  de la notificación de oferta (`services/notify-offer.ts:90-120`); perfil energético del vehículo
  (`services/calcular-metricas-viaje.ts:51-86`); ausencia de RLS en las migraciones.
- **Verificado ejecutando**: los dos generadores de hash de §4 (opción A y opción B), ambos
  aceptados por `verifyClaveNumerica` del repo; y los dígitos verificadores de los 5 RUT.
- **Verificado corriendo el SQL** contra un PostgreSQL 17.10 efímero (Homebrew, puerto 5499,
  descartado al terminar) con las **56 migraciones aplicadas en orden de `meta/_journal.json`**:
  - el bloque `DO` de §5 corre limpio (`NOTICE: Piso T2 sembrado: …`);
  - **es idempotente**: segunda corrida sin errores y sin duplicar
    (2 empresas, 3 usuarios, 3 membresías, 1 vehículo, 1 zona, 1 conductor);
  - §6.0 devuelve `ok = 1` en las 6 filas;
  - §6.1 (dry-run del matching) devuelve la fila `T2 Transportes de Prueba SpA / T2TEST / 12000`;
  - §6.2 muestra `t` en la generadora y `f` en el transportista;
  - §6.4 confirma `is_pending_en_la_ui = t` antes del primer login;
  - §7 (pre-check en 0 + rollback) borra las 11 filas y deja la base en cero.
- **NO ejecutado**: nada contra la base de **producción** ni contra una base local del proyecto;
  tampoco se levantó el API, así que el `curl` de §6.3 y el matching real (TypeScript) quedan
  probados solo por lectura de código + el equivalente SQL de §6.1.
