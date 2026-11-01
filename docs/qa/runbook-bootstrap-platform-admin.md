# Runbook — Provisionar un platform admin (`bootstrap-platform-admin`)

## 0. Camino normal: sumar personal de Booster desde el panel

Desde `.specs/alta-personal-booster/spec.md`, una persona nueva de Booster con acceso al panel se suma **desde `/app/platform-admin/personal`**, sin túnel a la base ni script. El admin carga los datos; la persona elige su propia clave. La lista de Terraform (`booster_platform_admin_emails`) sigue decidiendo quién entra.

El orden importa — primero la cuenta, después la lista:

1. **Alta en el panel.** Un platform-admin abre `/app/platform-admin/personal`, ingresa correo, nombre completo y RUT, y confirma. La cuenta queda provisoria con un código de activación de 7 días, que el panel muestra **una sola vez**. Desde ese momento el correo queda reservado para esa persona. El panel marca si el correo todavía no está en la lista.
2. **El PO agrega el correo a la lista y aplica.** En su `infrastructure/terraform.tfvars` **local** (está en `.gitignore`; nunca en el repo, que es público) suma el correo a la CSV `booster_platform_admin_emails` (por ejemplo `"dev@boosterchile.com,nueva.persona@boosterchile.com"`), corre `terraform plan`, revisa que el único cambio sea esa variable del servicio `api`, y corre `terraform apply`.
3. **Código por correo.** El código sale por correo solo si el correo ya está en la lista cuando se emite. Como el alta va antes que la lista, después del `apply` el admin usa **«Generar código nuevo»** en la fila de la persona: el código anterior deja de servir, el plazo de 7 días corre desde ahí y el código le llega a su correo con el enlace a `/activar`. También sirve si el primer código venció. (Si prefieres, el admin le entrega por un canal directo el código que vio en el paso 1, mientras siga vigente.)
4. **La persona activa en `/activar`** con su RUT, el código y la clave de 6 dígitos que elige. `/auth/activar` exige las tres condiciones: cuenta del personal, correo en la lista y un código emitido desde el panel que siga vigente. Un código que le haya dejado otro flujo (por ejemplo, la invitación de una empresa) no sirve: genera uno nuevo desde el panel. Si falta una, la pantalla responde que no pudo activar la cuenta, sin decir cuál condición faltó: revisa la fila de la persona en el panel (`en_lista`, vencimiento del código) antes de pedirle que reintente. Si la fila dice «Sin código vigente del panel», genera uno nuevo.
5. **Entra por `/login`** eligiendo la tarjeta **«Booster»**, con su RUT y su clave.

> **Aviso:** `/auth/activar` tiene un límite de intentos. Si la persona prueba varias veces con un código equivocado, espera unos minutos antes de reintentar. Si el código que tiene no sirve, genera uno nuevo; igual hay que esperar esos minutos.

Para **quitar** a alguien se saca su correo de la lista de Terraform y se aplica; el panel no quita acceso.

**El script de este runbook queda para reparar cuentas** (RUT faltante, flag de admin faltante, fila inconsistente) y **rotar la clave** (`--rotate-clave`). No es el camino para sumar personal nuevo.

---

**Para**: operador Booster (humano; hoy el owner `dev@boosterchile.com`). **Nunca CI.**
**Qué hace**: crea/reconcilia de forma idempotente y no destructiva la cuenta Firebase y la fila `usuarios` de un platform admin, dejándolo operable por LoginUniversal (RUT + clave de 6 dígitos) y aceptado por la allowlist del backend. Es el mecanismo reproducible del Gap A (diagnóstico `docs/corfo/hito-2/diagnostico-alta-usuarios.md` §7; spec `.specs/bootstrap-platform-admin/spec.md`).
**Cuándo usarlo**: primer admin desde cero (no hay nadie que pueda usar el panel) · reparar la fila de un admin (RUT/clave/flag faltantes) · rotación de clave (`--rotate-clave`). Para sumar personal nuevo, usa el panel (§0).

**Lo que este script NO hace** (a propósito): no edita la allowlist (`BOOSTER_PLATFORM_ADMIN_EMAILS` vive en Terraform y la cambia solo el PO) · no toca passwords de Firebase · no modifica un RUT ya declarado · no borra nada.

---

## 1. Prerrequisitos (una vez por sesión de operación)

El flujo usa **DOS terminales**: el túnel en A (queda corriendo), el script en B. No uses la sesión psql de `connect.sh` como túnel para el script — `connect.sh` tiene `trap cleanup EXIT` y mata su túnel al salir.

```bash
# 0. Verificá que el puerto local del túnel esté LIBRE (esperado: salida vacía).
#    Incidente 2026-07-07: un Postgres local de test en 5433 interceptó la
#    conexión y dio "role does not exist" con credenciales válidas — ver §7.
lsof -nP -i :5433

# 1. ADC para el Firebase Admin SDK (interactivo, cuenta con permisos del proyecto):
gcloud auth application-default login

# 2. TERMINAL A — túnel IAP directo al bastión (dejar corriendo):
gcloud compute start-iap-tunnel db-bastion 5432 \
  --local-host-port=127.0.0.1:5433 \
  --zone=southamerica-west1-a --project=booster-ai-494222

# 3. TERMINAL B — DATABASE_URL con credenciales reales (modo booster_app, el de
#    certeza). El secret `database-url` ya trae user:password — reemplazá el
#    host:puerto por el túnel local (127.0.0.1:5433) y agregá sslmode=disable:
gcloud secrets versions access latest --secret=database-url --project=booster-ai-494222
export DATABASE_URL="postgresql://booster_app:<password-del-secret>@127.0.0.1:5433/booster_ai?sslmode=disable"
#    (Alternativa IAM — user=email + `gcloud auth print-access-token` como
#    password — NO verificada operativamente; booster_app es la vía probada.)

# 4. Allowlist VIGENTE del servicio api (fuente: Terraform / variables del servicio).
#    El script solo VALIDA contra ella — si el email no está, aborta.
export BOOSTER_PLATFORM_ADMIN_EMAILS="dev@boosterchile.com"

# 5. Clave por env — VÍA PREFERIDA (verificado 2026-07-07: el prompt TTY de
#    doble confirmación puede fallar según los caracteres/config del terminal).
#    Nota de higiene: el espacio inicial evita el historial en shells con
#    HIST_IGNORE_SPACE; en zsh activalo con `setopt HIST_IGNORE_SPACE`.
#    Des-exportala al terminar (`unset BOOTSTRAP_ADMIN_CLAVE`).
 export BOOTSTRAP_ADMIN_CLAVE="<6 dígitos>"
```

> El email debe estar en la allowlist **antes** de correr el script. Para sumar a una persona nueva no uses el script: sigue el camino del panel (§0).

## 2. Dry-run PRIMERO (obligatorio)

```bash
pnpm --filter @booster-ai/api exec tsx scripts/bootstrap-platform-admin.ts \
  --email dev@boosterchile.com \
  --rut "12.345.678-5" \
  --full-name "Felipe Vicencio" \
  --dry-run
```

(La clave sale de `BOOTSTRAP_ADMIN_CLAVE` — env exacta, con prefijo `BOOTSTRAP_`. Si no está, cae al prompt TTY oculto; `--clave` por argv está rechazado por el script. En dry-run no se escribe nada en ningún caso.)

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

Mismo comando **sin `--dry-run`**. La clave sale de `BOOTSTRAP_ADMIN_CLAVE` (vía preferida, §1 paso 5); el prompt TTY con doble confirmación queda solo de fallback — falló repetidamente en la corrida real del 2026-07-07 por caracteres del terminal. El script rechaza `--clave` por argv.

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
- **Segundo admin (y siguientes)**: ya no pasa por este script. Sigue §0, en este orden: (1) alta en `/app/platform-admin/personal`; (2) el PO agrega el correo a `booster_platform_admin_emails` en su `terraform.tfvars` local y aplica; (3) «Generar código nuevo» para que el código salga por correo; (4) la persona activa en `/activar` y entra por `/login` con la tarjeta «Booster». El script solo entra si después hay que reparar esa cuenta.

## 7. Troubleshooting (aborts por diseño — ninguno deja escrituras parciales)

| Error | Significado | Acción |
|---|---|---|
| `NotInAllowlistError` | El email no está en la allowlist que exportaste | Verifica el valor vigente en Terraform; si es un admin nuevo, primero el cambio de allowlist (PO) |
| `RutConflictError` | El RUT pertenece a OTRO usuario | Ese RUT no es del admin — verifica el dato; jamás se reasigna un RUT ajeno |
| `RutImmutableError` | La fila del admin ya declara otro RUT | Cambiar un RUT declarado no es alcance del bootstrap; escala al PO |
| `FirebaseUidConflictError` | El uid Firebase vive en la fila de otro email | Estado inconsistente (cuenta compartida) — diagnóstico manual antes de re-correr |
| `InvalidBootstrapInputError` | RUT o clave con formato inválido | Corrige el input (RUT con DV correcto; clave = exactamente 6 dígitos) |
| `role "..." does not exist` (psql/script) con credenciales válidas | **Okupa en el puerto del túnel**: hay OTRO Postgres local escuchando en 5433 y estás hablando con él, no con prod | `lsof -nP -i :5433` e identificá el proceso; detenelo por su data-dir (`pg_ctl -D <dir> stop -m fast`) o usá otro puerto (`LOCAL_PORT`/`--local-host-port`). Causa raíz del incidente 2026-07-07 |

**Bug conocido de `connect.sh`** (pendiente de fix): su check de "túnel listo" es un probe TCP (`connect.sh:96`, `echo > /dev/tcp/127.0.0.1/$LOCAL_PORT`) que **no distingue el túnel IAP de cualquier otro proceso escuchando en el puerto** — si el puerto está ocupado, el `start-iap-tunnel` muere en silencio pero el script imprime "túnel listo" y conecta al okupa. De ahí el paso 0 (`lsof`) de §1.
