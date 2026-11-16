# One-shot — invitar personal de Booster (gerencia@ + sandoval.felipe@)

**Fecha**: 2026-11-16 · America/Santiago  
**Pedido PO**: sumar `gerencia@boosterchile.com` y `sandoval.felipe@gmail.com`
como **equipo de Booster** (no como cliente externo).  
**Rol canónico**: personal de Booster = `usuarios.es_admin_plataforma = true`
(ADR-028 «Admin Booster»). **No** membresía `generador`/`transportista`.  
**Camino canónico**: panel `/app/platform-admin/personal` →
`POST /admin/personal-booster` (`.specs/alta-personal-booster`,
`.specs/acceso-panel-plataforma`, runbook
`docs/qa/runbook-bootstrap-platform-admin.md` §0).  
**Auth invitados (producto shipped)**: `AUTH_UNIVERSAL_V1_ACTIVATED=true` →
login **RUT + clave numérica de 6 dígitos**, tarjeta «Booster».  
**From canónico (PO 2026-11-16)**: todas las comunicaciones salen de
`Booster <contacto@boosterchile.com>`.  
**Conflicto a escalar (invitados)**: el PO dijo que ellos entrarían con
«correo + clave»; el alta crea Firebase **sin password** (email sintético
`users+<rut>@boosterchile.invalid`) y la credencial es la clave numérica
(`/auth/activar` + `/auth/login-rut`). **No** inventar bypass.

## From Resend — actual vs canónico

| Capa | Valor |
|---|---|
| Default `apps/api` (`config.ts` `EMAIL_FROM`) | **antes** `Booster <no-reply@boosterchile.com>` → **este PR** `Booster <contacto@boosterchile.com>` |
| Cloud Run prod (revisión actual) | `EMAIL_FROM` **no** está en env → usaba el default `no-reply@` |
| Terraform `module.service_api` | **este PR** fija `EMAIL_FROM = "Booster <contacto@${var.domain}>"` |
| `RESEND_API_KEY` | secret montado (`resend-api-key`) |

**Qué falta para que el From sea `contacto@` en prod**

1. Merge + release (o apply TF que inyecte `EMAIL_FROM`) — sin eso prod sigue
   en `no-reply@` vía default viejo.
2. En Resend: dominio `boosterchile.com` (o el sender `contacto@`) **verified**.
   DNS ya tipado en `infrastructure/email.tf` (`var.resend_dns_records`). Si
   Resend rechaza con 422, el alta igual crea la cuenta y el panel muestra el
   código una vez; hay que entregarlo a mano.
3. `cursor-agent@` **no** tiene `secretmanager.versions.access` ni
   `run.services.update` → no puede flippear el env ni leer la key.

Interim owner/Claude Code (si no se espera al release), con ADC owner:

```bash
# Solo si Resend ya acepta contacto@ como From
gcloud run services update booster-ai-api \
  --region=southamerica-west1 --project=booster-ai-494222 \
  --update-env-vars='EMAIL_FROM=Booster <contacto@boosterchile.com>'
```

Preferible: merge de este cambio + `terraform apply` / release canónico.

## Estado verificado (solo lectura, Cursor Cloud)

| Chequeo | Resultado |
|---|---|
| Firebase Auth `gerencia@boosterchile.com` | **no existe** |
| Firebase Auth `sandoval.felipe@gmail.com` | **no existe** |
| Firebase Auth `dev@boosterchile.com` (PO) | existe (`google.com` + `password`, emailVerified) |
| `BOOSTER_PLATFORM_ADMIN_EMAILS` | solo `dev@boosterchile.com` |
| `RESEND_API_KEY` | montado |
| `EMAIL_FROM` en Cloud Run | **ausente** (cae a default; pre-merge = `no-reply@`) |
| `AUTH_UNIVERSAL_V1_ACTIVATED` | `true` |
| `cursor-agent@` | sin secret access / sin sesión PO → **no** ejecuta el alta |

## Login de Felipe (PO) — RUT **y** correo

El panel **no** exige RUT en el guard: `requirePlatformAdmin` /
`tieneAccesoPlataforma` aceptan `es_admin_plataforma` **o** correo en
`BOOSTER_PLATFORM_ADMIN_EMAILS` (`dev@` está).

| Camino | URL | Credencial |
|---|---|---|
| RUT (universal) | `https://app.boosterchile.com/login` → tarjeta **Booster** | RUT `14289398-3` + clave numérica |
| Correo / Google (legacy) | `https://app.boosterchile.com/login?legacy=1` | Google con `dev@boosterchile.com`, o email+password Firebase |

Notas:

- Con universal ON, el form correo/Google **no** aparece en `/login` sin
  `?legacy=1` (escape hatch; no hay link visible en la UI principal).
- Histórico: `signInWithPassword` con una clave que el PO recordaba falló
  (`INVALID_LOGIN_CREDENTIALS`) — la cuenta **sí** tiene `passwordHash`; si
  Google no alcanza, resetear password en Identity Platform / «Olvidé mi
  contraseña» del form legacy.
- Tras login con `dev@`, `GET /me` auto-provisiona / reconoce platform-admin
  por allowlist.

## Bloqueo para invitar a gerencia@ / sandoval.felipe@

Faltan del PO (Zod `altaPersonalBoosterSchema`):

1. **Nombre completo** de cada persona.
2. **RUT** válido de cada una (DV correcto).

Sin eso no hay alta. Este entorno no tiene token Firebase del PO.

## Camino preferido (UI) — lo hace Felipe

1. Entra (RUT **o** `?legacy=1` con `dev@`) → panel
   `https://app.boosterchile.com/app/platform-admin/personal`.
2. Por cada invitado: correo, nombre, RUT → confirma.
3. Código de 6 dígitos una sola vez + intento de correo Resend (From
   `contacto@` tras el deploy de este cambio).
4. Invitado: `https://app.boosterchile.com/activar` → RUT + código + clave 6
   dígitos.
5. Invitado entra: `/login` → **Booster** → RUT + clave.

## One-shot API (Claude Code / sesión del PO)

Sustituir `NOMBRE`, `RUT` y `ID_TOKEN`. **No** pegar el token en chats.

```bash
API=https://api.boosterchile.com

curl -sS -X POST "$API/admin/personal-booster" \
  -H "Authorization: Bearer $ID_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"email":"gerencia@boosterchile.com","full_name":"NOMBRE","rut":"RUT"}'

curl -sS -X POST "$API/admin/personal-booster" \
  -H "Authorization: Bearer $ID_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"email":"sandoval.felipe@gmail.com","full_name":"NOMBRE","rut":"RUT"}'
```

Re-emisión de código:

```bash
curl -sS -X POST "$API/admin/personal-booster/$USER_ID/codigo" \
  -H "Authorization: Bearer $ID_TOKEN"
```

## Qué NO hacer

- Invitar vía `/me/empresa/miembros` (cliente; `cuenta_personal_booster`).
- Tratarlos como `generador`/`transportista`.
- Crear Firebase email/password a mano para los invitados (bypass).
- Usar `bootstrap-platform-admin.ts` para estos dos (es reparación / primer
  admin).
- Mutar prod desde `cursor-agent@` sin sesión del PO.

## Preguntas al PO

1. **Nombre completo + RUT** de `gerencia@` y de `sandoval.felipe@`?
2. Invitados: ¿aceptan login **RUT + clave** (producto actual) o exigen
   correo+clave (cambio de producto / ADR)?
3. ¿Confirmado en Resend que el dominio acepta From `contacto@boosterchile.com`?
4. ¿Merge+release de `EMAIL_FROM=contacto@` ahora, o interim
   `gcloud run services update` con owner?
