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
**Auth en prod**: `AUTH_UNIVERSAL_V1_ACTIVATED=true` → login **RUT + clave
numérica de 6 dígitos**, tarjeta «Booster» en
`https://app.boosterchile.com/login`.  
**Conflicto a escalar**: el PO dijo «correo + clave»; el producto shipped
activa con Firebase **sin password** (email sintético
`users+<rut>@boosterchile.invalid`) y la credencial es la clave numérica en
BD (`/auth/activar` + `/auth/login-rut`). **No** inventar bypass email/password.

## Estado verificado (solo lectura, Cursor Cloud)

| Chequeo | Resultado |
|---|---|
| Firebase Auth `gerencia@boosterchile.com` | **no existe** |
| Firebase Auth `sandoval.felipe@gmail.com` | **no existe** |
| Firebase Auth `dev@boosterchile.com` (PO) | existe (`google.com` + `password`) |
| `BOOSTER_PLATFORM_ADMIN_EMAILS` en Cloud Run | solo `dev@boosterchile.com` (respaldo OK; el panel otorga la marca) |
| `RESEND_API_KEY` montado en API | sí (`secret: resend-api-key`) → el alta en **prod** puede enviar el correo |
| `cursor-agent@` | **sin** `secretmanager.versions.access`, **sin** sesión del PO → **no** puede llamar `/admin/personal-booster` ni leer DB |

## Bloqueo para ejecutar desde Cloud

Faltan del PO (obligatorios por Zod `altaPersonalBoosterSchema`):

1. **Nombre completo** de cada persona.
2. **RUT** válido de cada persona (DV correcto; forma canónica `12345678-K`).

Sin eso no se puede dar el alta. Tampoco hay token Firebase del PO en este
entorno.

## Camino preferido (UI, 2 minutos por persona) — lo hace Felipe

1. Entra a `https://app.boosterchile.com/login` → tarjeta **Booster** → RUT
   `14289398-3` + su clave numérica.
2. Abre `https://app.boosterchile.com/app/platform-admin/personal`.
3. Por cada invitado: correo, nombre completo, RUT → confirma.
4. El panel muestra el **código de 6 dígitos una sola vez** y Resend intenta
   enviarlo a ese correo con el enlace a `/activar`. Si no llega el mail,
   cópialo y entrégalo a mano (el UI ya lo advierte).
5. La persona abre `https://app.boosterchile.com/activar`, ingresa **su RUT**,
   el código y elige su **clave de 6 dígitos**.
6. Entra en `https://app.boosterchile.com/login` → **Booster** → RUT + clave.

«Quitar acceso» en la misma pantalla desmarca `es_admin_plataforma`. No hace
falta `terraform apply` por persona (la lista de Terraform es solo respaldo
del primer admin).

## One-shot API (Claude Code / sesión del PO)

Sustituir `NOMBRE`, `RUT` y el `ID_TOKEN` (Firebase ID token de una sesión
platform-admin activa). **No** pegar el token en chats ni commits.

```bash
API=https://api.boosterchile.com
# ID_TOKEN = Authorization Bearer de la sesión de Felipe en el panel
# (DevTools → Network → cualquier /admin/* → header Authorization)

curl -sS -X POST "$API/admin/personal-booster" \
  -H "Authorization: Bearer $ID_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"email":"gerencia@boosterchile.com","full_name":"NOMBRE","rut":"RUT"}'

curl -sS -X POST "$API/admin/personal-booster" \
  -H "Authorization: Bearer $ID_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"email":"sandoval.felipe@gmail.com","full_name":"NOMBRE","rut":"RUT"}'
```

Respuesta esperada (cuenta nueva): `201` con
`{ ok, user_id, vinculo: "nueva", codigo_activacion, expira_en, en_lista }`.
El código **no** debe loguearse. Si `codigo_activacion` viene y el mail no
llega, reenviar con:

```bash
curl -sS -X POST "$API/admin/personal-booster/$USER_ID/codigo" \
  -H "Authorization: Bearer $ID_TOKEN"
```

## Cómo sigue entrando Felipe

Sin cambio: `https://app.boosterchile.com/login` → Booster → RUT
`14289398-3` + su clave. Su correo `dev@boosterchile.com` sigue en la lista
de respaldo Terraform.

## Qué NO hacer

- Invitarlos vía `/me/empresa/miembros` (flujo de empresa cliente; rechaza
  personal Booster con `cuenta_personal_booster`).
- Tratarlos como `generador`/`transportista`.
- Crear usuarios Firebase a mano con email/password «porque el PO dijo correo»
  — contradice ADR-035 + alta-personal-booster SC7.
- Correr `bootstrap-platform-admin.ts` para estos dos (es reparación / primer
  admin; exige allowlist Terraform y fija clave el operador).
- Mutar prod desde `cursor-agent@` sin sesión del PO.

## Si el PO insiste en correo + clave

Escala: habría que **cambiar producto** (ADR/spec: login email+clave para
personal sin RUT, o coexistencia). Hoy `AUTH_UNIVERSAL_V1_ACTIVATED=true` y
`/activar` no setea password Firebase. No se implementa en este oneshot.
