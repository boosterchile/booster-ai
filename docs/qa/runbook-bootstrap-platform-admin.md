# Runbook — Provisionar un platform admin (`bootstrap-platform-admin`)

**Para**: operador Booster (humano; hoy el owner `dev@boosterchile.com`). **Nunca CI.**
**Qué hace**: crea/reconcilia de forma idempotente y no destructiva la cuenta Firebase y la fila `usuarios` de un platform admin, dejándolo operable por LoginUniversal (RUT + clave de 6 dígitos) y aceptado por la allowlist del backend. Es el mecanismo reproducible del Gap A (diagnóstico `docs/corfo/hito-2/diagnostico-alta-usuarios.md` §7; spec `.specs/bootstrap-platform-admin/spec.md`).
**Cuándo usarlo**: primer admin desde cero · reparar la fila del admin actual (RUT/clave/flag faltantes) · alta de un segundo admin (después de agregarlo a la allowlist en Terraform) · rotación de clave (`--rotate-clave`).

**Lo que este script NO hace** (a propósito): no edita la allowlist (`BOOSTER_PLATFORM_ADMIN_EMAILS` vive en Terraform y la cambia solo el PO) · no toca passwords de Firebase · no modifica un RUT ya declarado · no borra nada.

---

## 1. Prerrequisitos (una vez por sesión de operación)

```bash
# 1. ADC para el Firebase Admin SDK (interactivo, cuenta con permisos del proyecto):
gcloud auth application-default login

# 2. Conexión a la BD de prod vía bastión (ADR-013; deja un túnel local):
bash scripts/db/connect.sh          # sigue las instrucciones que imprime
export DATABASE_URL="postgresql://<user>@127.0.0.1:5434/booster_ai?sslmode=disable"

# 3. Allowlist VIGENTE del servicio api (fuente: Terraform / variables del servicio).
#    El script solo VALIDA contra ella — si el email no está, aborta.
export BOOSTER_PLATFORM_ADMIN_EMAILS="dev@boosterchile.com"
```

> El email debe estar en la allowlist **antes** de correr el script. Si estás dando de alta un segundo admin, primero va el cambio en Terraform (PO) y después este runbook.

## 2. Dry-run PRIMERO (obligatorio)

```bash
pnpm --filter @booster-ai/api exec tsx scripts/bootstrap-platform-admin.ts \
  --email dev@boosterchile.com \
  --rut "12.345.678-5" \
  --full-name "Felipe Vicencio" \
  --dry-run
```

(El dry-run no pide clave si `BOOTSTRAP_ADMIN_CLAVE` no está; si la pide, puedes ingresar la definitiva — no se escribe nada.)

## 3. Qué verificar en la salida del dry-run ANTES de la corrida real

El reporte tiene esta forma:

```
— Reporte bootstrap-platform-admin (DRY-RUN, sin escrituras)
  Firebase : existing (uid=AbC123...)          ← o "created (uid=dry-run-pending)"
  usuarios : reconciled (id=9f8e...)           ← o "created" / "unchanged"
   · dry-run: cuenta Firebase existente reutilizada (uid=AbC123...)
   · dry-run: rut seteado a 12345678-5 (estaba NULL)
   · dry-run: clave numérica seteada (estaba NULL)
```

Checklist (si algo no calza, **NO** corras la real; revisa Troubleshooting):

1. **`Firebase:`** dice `existing` con el uid esperado (admin que ya tiene cuenta) o `created` (admin nuevo desde cero). Si esperabas `existing` y dice `created`, el email no coincide con la cuenta real (typo, alias) — detente.
2. **`usuarios:`** dice `created` (no había fila) o `reconciled` (fila existente que se repara). `unchanged` significa que no hay nada que hacer (ya operativo).
3. **Las acciones tocan SOLO la fila del email que pasaste** — cada línea `·` describe una columna de ESA fila (`rut`, `clave`, `is_platform_admin`, `status`, `firebase_uid`, `nombre`). El script no puede tocar otras filas: si el RUT pertenece a otro usuario aborta con `RutConflictError`, y si la fila ya declara otro RUT aborta con `RutImmutableError` — ambos ANTES de escribir.
4. El RUT reportado quedó **canónico** (sin puntos, con guión: `12345678-5`) — es la forma exacta que el login busca.

## 4. Corrida real

Mismo comando **sin `--dry-run`**. Pide la clave de 6 dígitos por prompt oculto con doble confirmación (o tómala de `BOOTSTRAP_ADMIN_CLAVE` si la exportaste; no queda en el historial en ningún caso — el script rechaza `--clave` por argv).

```bash
pnpm --filter @booster-ai/api exec tsx scripts/bootstrap-platform-admin.ts \
  --email dev@boosterchile.com \
  --rut "12.345.678-5" \
  --full-name "Felipe Vicencio"
```

Salida esperada: mismo reporte del dry-run pero sin el prefijo `dry-run:`, con `usuarios: created|reconciled (id=...)`. Es **idempotente**: si lo corres de nuevo con la misma entrada, reporta `unchanged` y no escribe nada.

## 5. Verificación post-run por la UI real (criterio de éxito)

1. Abre `https://app.boosterchile.com/login` (ventana privada, sin sesión previa).
2. Elige la tarjeta **"Booster"** → ingresa el **RUT** y la **clave** recién provisionados → **Ingresar**.
   - ✅ Esperado: sesión iniciada, aterrizas en `/app` con acceso al panel de plataforma.
3. Ve a `/app/platform-admin/signup-requests` y **aprueba una solicitud de prueba** (si no hay pendientes, crea una en `/solicitar-acceso` con un email de prueba tuyo).
   - ✅ Esperado: `200` con `outcome=approved` y un `onboarding_link` copiable en la respuesta del panel.

**El criterio binario del hito**: pasos 2 y 3 verdes = el bootstrap funcionó (el admin nace, entra por la UI real y puede aprobar). Si el paso 2 falla con "RUT o clave incorrectos", verifica que la corrida real reportó `rut seteado`/`clave seteada` y que no estás usando un RUT con formato distinto (el login normaliza puntos/guión igual que el script).

## 6. Rotación de clave / segundo admin

- **Rotar clave**: mismo comando + `--rotate-clave` (sin él, una clave existente jamás se toca).
- **Segundo admin**: (1) PO agrega el email a `BOOSTER_PLATFORM_ADMIN_EMAILS` en Terraform y aplica; (2) exporta la allowlist actualizada; (3) corre este runbook con los datos del nuevo admin.

## 7. Troubleshooting (aborts por diseño — ninguno deja escrituras parciales)

| Error | Significado | Acción |
|---|---|---|
| `NotInAllowlistError` | El email no está en la allowlist que exportaste | Verifica el valor vigente en Terraform; si es un admin nuevo, primero el cambio de allowlist (PO) |
| `RutConflictError` | El RUT pertenece a OTRO usuario | Ese RUT no es del admin — verifica el dato; jamás se reasigna un RUT ajeno |
| `RutImmutableError` | La fila del admin ya declara otro RUT | Cambiar un RUT declarado no es alcance del bootstrap; escala al PO |
| `FirebaseUidConflictError` | El uid Firebase vive en la fila de otro email | Estado inconsistente (cuenta compartida) — diagnóstico manual antes de re-correr |
| `InvalidBootstrapInputError` | RUT o clave con formato inválido | Corrige el input (RUT con DV correcto; clave = exactamente 6 dígitos) |
