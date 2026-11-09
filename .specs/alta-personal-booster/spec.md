# Spec: alta-personal-booster

- Author: Felipe Vicencio (PO) + agente
- Date: 2026-10-30
- Status: Draft — enfoque elegido por el PO en sesión el 2026-10-30 (§10)
- Linked: `.specs/bootstrap-platform-admin/spec.md` (script de bootstrap; esta spec no lo retira), `docs/qa/runbook-bootstrap-platform-admin.md`, `.specs/equipo-de-la-empresa/` (código de un solo uso y `/activar`), `.specs/acceso-usuarios-empresa-panel/spec.md` (spec hermana: login, doble rol), ADR-035 (RUT + clave numérica)

---

## 1. Objective

Que un platform-admin dé de alta desde `/app/platform-admin` a otra persona de Booster con acceso al panel, sin túnel a la base de datos ni script local, y que esa persona elija su propia clave en `/activar`. La lista de correos de Terraform (`BOOSTER_PLATFORM_ADMIN_EMAILS`) sigue siendo la que decide quién tiene acceso.

## 2. Why now

El 2026-10-30 el PO pidió con urgencia resolver la creación de usuarios que entran al panel de administración de Booster. Hoy sumar a una persona son tres pasos manuales del PO (`docs/qa/runbook-bootstrap-platform-admin.md`):

1. Agregar el correo a `booster_platform_admin_emails` y correr `terraform apply`.
2. Levantar un túnel IAP a la base de producción, exportar credenciales y correr `scripts/bootstrap-platform-admin.ts`.
3. Fijar él la clave de la persona por variable de entorno.

El paso 3 contradice el principio de identidad (`alta-cliente-autocontenida` §6.5: nadie más que la persona conoce su clave). `/activar` no sirve hoy para el personal: exige una invitación pendiente a una empresa (`apps/api/src/routes/auth-activar.ts:87-106`).

## 3. Success criteria

- [ ] SC1 — En `/app/platform-admin/personal`, el admin ve la lista del personal de Booster. Por cada persona: correo, nombre, RUT, si está en la lista de Terraform, y estado (`sin_cuenta`, `pendiente_activacion`, `activa`), con vencimiento del código si está pendiente y último ingreso si está activa. La lista es la unión de los correos de `BOOSTER_PLATFORM_ADMIN_EMAILS` y de las cuentas con `es_admin_plataforma = true`.
- [ ] SC2 — El admin da de alta con correo, nombre completo y RUT (dígito verificador validado). Antes de crear ve una confirmación. Si el correo y el RUT no existen en `usuarios`, se crea la cuenta provisoria (`firebase_uid` `pending-rut:<rut>`, sin clave, `es_admin_plataforma = true`, estado `pendiente_verificacion`) con un código de activación de 7 días, guardado solo como hash. La respuesta trae el código una sola vez, su vencimiento y si el correo está en la lista.
- [ ] SC3 — Persona que ya existe (mismo correo y mismo RUT):
  - cuenta activa con el correo en la lista → no se emite código; se marca `es_admin_plataforma = true` y se responde `vinculo: cuenta_activa`;
  - cuenta activa con el correo fuera de la lista → no se emite código ni se marca; se responde `vinculo: cuenta_activa` con `en_lista: false`. Queda marcada al repetir el alta después de que el PO agregue el correo a la lista y aplique;
  - provisoria con un código del panel vigente (`activacion_vence_en` existe y no pasó) → no se emite código nuevo; se marca y se responde `vinculo: codigo_vigente` con ese vencimiento (el admin puede generar uno nuevo con SC5);
  - provisoria sin código, con un código que no emitió el panel (`activacion_vence_en` NULL) o con el del panel vencido → se emite uno nuevo con su vencimiento de 7 días, se marca y se responde `vinculo: provisoria_sin_codigo` (SC2).

  Nunca se cambian su clave, su nombre ni su correo.
- [ ] SC4 — Rechazos, sin escribir nada: correo de una cuenta con otro RUT → 409 `rut_mismatch`; RUT de otra persona → 409 `rut_already_registered`; body inválido → 400.
- [ ] SC5 — «Generar código nuevo» para una persona del personal que no activó (provisoria, sin clave): código nuevo, el anterior deja de servir y el plazo de 7 días corre desde la re-emisión. Cuenta ya activa → 409 `already_activated`. Persona que no es del personal → 404 `personal_not_found`.
- [ ] SC6 — `POST /auth/activar` activa a una persona del personal sin invitación a empresa cuando se cumplen las tres condiciones: la cuenta tiene `es_admin_plataforma = true`, su correo está en `BOOSTER_PLATFORM_ADMIN_EMAILS` y el código es del panel y está vigente según `activacion_vence_en`. Queda con su clave, `activo`, cuenta Firebase creada, sesión devuelta, y `activacion_vence_en` y el hash del código en NULL. Una cuenta con `es_admin_plataforma = true` se activa solo con un código del panel vigente, también cuando tiene invitaciones vigentes a empresas; si las tiene y el código es del panel, se activan igual que hoy. `POST /auth/driver-activate` aplica la misma regla a esas cuentas, con la misma 401 de un PIN incorrecto. Si falta una condición, la respuesta es la misma 401 genérica de hoy. Las cuentas sin esa marca siguen el camino de las invitaciones a empresa sin cambios. El endpoint tiene un límite de intentos por RUT, además del de la IP, con cubos propios.
- [ ] SC7 — Cadena completa (integración): alta en el panel → `/auth/activar` con RUT, código y clave → `POST /auth/login-rut` entra con esa clave → `GET /me` devuelve `is_platform_admin: true` → una ruta `/admin/*` responde 200. El código ya no sirve después de activar.
- [ ] SC8 — Solo platform-admin: sin sesión 401, otro usuario 403, sesión de impersonación bloqueada en escritura. Las rutas nuevas quedan clasificadas en el harness default-deny (ADR-057).
- [ ] SC9 — Cuando el correo está en la lista, el código sale también por correo a esa dirección, con la URL de `/activar`. El log, el span y la auditoría nunca llevan el código. Cada alta y re-emisión deja un evento de auditoría (qué admin, a quién por `user_id`, qué vínculo) y suma una métrica de negocio.
- [ ] SC10 — El panel explica el orden: primero se crea la cuenta en el panel, después se agrega el correo a la lista de Terraform (lo aplica el PO), y recién ahí la persona activa. Si la persona no está en la lista, el panel lo marca y no envía el correo.
- [ ] SC11 — El runbook `docs/qa/runbook-bootstrap-platform-admin.md` describe este camino como el normal para sumar personal, en ese orden, y deja el script para reparar cuentas.
- [ ] SC12 — Tests nombrados para SC1–SC10; rojo exhibido de SC6 y de la migración antes de implementar; tests, lint, typecheck y build corridos en el momento.

## 4. Contratos (los aprueba el PO en el PR)

- **Migración expand-only** `0072`: `usuarios.activacion_vence_en timestamptz NULL`. Sin backfill ni default; ninguna fila existente cambia.
- `GET /admin/personal-booster` → `200 { personal: PersonalBooster[] }`, con `PersonalBooster = { email, en_lista, user_id | null, nombre | null, rut | null, estado: 'sin_cuenta' | 'pendiente_activacion' | 'activa', expira_en | null, ultimo_login_en | null }`. Ordenado por correo.
- `POST /admin/personal-booster` body `{ email, full_name, rut }` → `201` si crea la cuenta, `200` si la persona ya existía: `{ ok, user_id, vinculo, codigo_activacion | null, expira_en | null, en_lista }`.
- `POST /admin/personal-booster/:userId/codigo` sin body → `200 { ok, user_id, codigo_activacion, expira_en, en_lista }`.
- `POST /auth/activar`: mismo request y respuestas; amplía quién puede activar (SC6).
- `POST /auth/driver-activate`: mismo request y respuestas; una cuenta marcada sin código del panel vigente recibe la 401 `invalid_credentials` de hoy (SC6).
- Los schemas Zod viven en `packages/shared-schemas`.

## 5. Out of scope

- Cambiar la lista de Terraform desde el panel o guardar la autorización en la base. La lista de Terraform sigue mandando; el PO la cambia y aplica.
- Quitar acceso desde el panel. Para quitar a alguien se saca su correo de la lista de Terraform.
- Retirar el script de bootstrap: queda para reparar cuentas (RUT faltante, rotación de clave).
- Roles de staff acotados (solo lectura, solo soporte): el platform-admin sigue siendo todo o nada.
- Enviar el código por WhatsApp.

## 6. Constraints

1. **La lista de Terraform decide el acceso.** Esta spec no cambia `require-platform-admin.ts` ni el cálculo de `is_platform_admin` en `/me`.
2. **Orden de alta:** la cuenta se crea en el panel antes de agregar el correo a la lista de Terraform. Así el correo queda reservado para esa persona desde el primer paso. Por eso `POST /admin/personal-booster` no exige que el correo esté en la lista, y la activación sí (SC6).
3. **Principio de identidad:** el admin carga datos, nunca la clave. El código prueba identidad una vez y no queda como contraseña.
4. **Nunca se re-emite el código de una cuenta activa**, ni se cambia el RUT, el nombre o el correo de una cuenta existente.
5. **ADR-035:** RUT + clave numérica de 6 dígitos; el login es el de siempre (`/login`, tipo «Booster»).
6. **Código del panel:** `activacion_vence_en` no nulo significa que el `activacion_pin_hash` actual lo emitió el panel (alta o «Generar código nuevo»). Todo otro lugar que reescribe el código de una cuenta existente deja `activacion_vence_en` en NULL en el mismo UPDATE; la activación del conductor también lo limpia al consumir el código. Los dos endpoints que consumen el código (`/auth/activar` y `/auth/driver-activate`) aplican la misma regla a una cuenta marcada.
7. **Reuso:** `generateActivationPin`, `hashActivationPin`, `verifyActivationPin`, `clasificarVinculoPersona`, `cuentaYaActivada`, `CODIGO_ACTIVACION_TTL_MS`, `rutSchema`, `requirePlatformAdmin`, `withBusinessSpan`, `getBusinessCounter`, el `EmailSender` y la pantalla `/activar`.
8. **Stack:** Zod en el boundary, cero `any`, logger estructurado sin código, span OTel y métrica de negocio en cada endpoint nuevo, coverage ≥80 % en código nuevo, TDD con rojo exhibido (auth y migración son dominio crítico). Migración escrita a mano con su entrada en `meta/_journal.json`.

## 7. Approach

- **Migración** `0072_usuarios_activacion_vence_en.sql` + `down/` si el repo lo usa + columna `activacionVenceEn` en `db/schema.ts`.
- **`routes/admin-personal-booster.ts`** con `createAdminPersonalBoosterRoutes({ db, logger, platformAdminEmails, emailSender, webAppUrl })`, montado en `server.ts` bajo `/admin/personal-booster` con la misma cadena de middleware que `/admin/empresas` (firebaseAuth → userContext → impersonationWriteGuard), y `requirePlatformAdmin` en cada handler. Transacción en el alta y en la re-emisión.
- **`auth-activar.ts`** recibe `platformAdminEmails` y `rateLimitPerRut` por opciones. Una cuenta marcada exige el código del panel vigente; sin invitaciones vigentes, además el correo en la lista, y se activa sin membresías. **`auth-driver.ts`** aplica a una cuenta marcada la misma exigencia del código del panel.
- **Correo:** función nueva junto a `enviarCorreoActivacionCuenta` para el personal de Booster (mismo remitente, texto propio).
- **Web:** ruta `/app/platform-admin/personal` (registrada en el router y con tarjeta en el índice del panel) con lista, formulario con confirmación, panel del código de una sola vez con la URL absoluta de `/activar`, y «Generar código nuevo» por fila pendiente.

## 8. Test list

- T1 (migración, rojo exhibido) — test unitario de columnas (`getTableColumns`) y de integración (`information_schema`) para `activacion_vence_en`; el conteo de migraciones sigue igual a las entradas del journal.
- T2 (SC6, rojo exhibido) — `auth-activar.test.ts`: personal sin invitación con las tres condiciones → 200 con token, clave hasheada, `activacion_vence_en` y hash en NULL; sin marca, fuera de la lista, código vencido o `activacion_vence_en` NULL → 401 genérico sin escrituras; cuenta marcada con invitación vigente y sin código del panel vigente → 401; con el código del panel vigente → activa cuenta y membresías; sin marca e invitaciones a empresa → sin cambio. `auth-driver.test.ts`: cuenta marcada con un código sin vencimiento del panel o con el del panel vencido → 401, también sin fila de conductor; con el del panel vigente → activa. En los tests de cada emisor, el UPDATE del código lleva `activacion_vence_en` NULL.
- T3 (SC2–SC5) — `admin-personal-booster.test.ts`: alta nueva, los vínculos (incluido el código que no emitió el panel y el del panel vencido), rechazos 409/400 sin escrituras, re-emisión y sus 409/404, el código solo en la respuesta.
- T4 (SC8) — 401/403, impersonación, y el harness default-deny clasifica las rutas.
- T5 (SC9) — correo enviado solo con `en_lista`; logs sin el código.
- T6 (SC7) — integración `alta-personal-booster-cadena.integration.test.ts` contra Postgres real, incluido un código que otro flujo deja en la misma cuenta después del alta: no activa por `/auth/activar` ni por `/auth/driver-activate`, y el que re-emite el panel sí.
- T7 (SC1, SC10) — web: lista con estados, confirmación, código visible una vez con URL, aviso de la lista de Terraform, re-emisión.

## 9. Rollout

1. Merge y release (lo dispara el orquestador; el gate `production` es del PO). La migración corre en el release.
2. Para cada persona nueva: alta en el panel → el PO agrega el correo a `booster_platform_admin_emails` en su `terraform.tfvars` (no en el repo: es público) y corre `terraform plan` y `terraform apply` → «Generar código nuevo» si el primero venció → la persona activa en `/activar` y entra por `/login` con el tipo «Booster».
3. Rollback: sacar el correo de la lista corta el acceso. La columna nueva es nullable y no la lee nada fuera de esta spec. Si se vuelve a una revisión anterior a esta, antes de re-desplegar se deja `activacion_vence_en` en NULL en las cuentas provisorias y el panel genera códigos nuevos para el personal pendiente.

## 10. Decision log

- 2026-10-30 — El PO aclara que los usuarios a crear son personal de Booster con acceso al panel `/app/platform-admin`, que pueden ser además usuarios de una generadora y/o transportista.
- 2026-10-30 — El PO elige «Terraform + alta en panel»: la lista de Terraform sigue siendo la autoridad; el panel crea la cuenta y la persona elige su clave en `/activar`. Descarta guardar la autorización en la base (exigía ADR) y quedarse solo con el camino actual.
- 2026-11-01 — Revisión adversarial: quedan estas reglas. Una cuenta activa se marca como personal solo si su correo ya está en la lista; si no, se marca al repetir el alta después del apply. `activacion_vence_en` no nulo identifica un código emitido por el panel: los demás emisores lo dejan en NULL al reescribir el código, y una cuenta marcada se activa solo con un código del panel vigente, también si tiene invitaciones a empresas, en `/auth/activar` y en `/auth/driver-activate`. El alta conserva el código de una provisoria solo si es del panel y está vigente; si no, emite uno nuevo. El alta bloquea la fila de la cuenta existente hasta el commit; la re-emisión y `/auth/activar` escriben solo si la cuenta sigue en el estado que leyeron; el choque con el `firebase_uid` provisorio de un RUT responde `rut_already_registered`; `/auth/activar` suma un límite de intentos por RUT. Los contratos de §4 no cambian.
- 2026-11-09 — Al integrar main: la migración pasa a `0072` (main ya ocupaba 0065–0071). `/auth/activar` sigue la regla de main de activar solo la invitación original; una cuenta marcada sigue exigiendo el código del panel vigente y, sin esa invitación, el correo en la lista. Los emisores que main dejó (re-emisión del panel de empresas y conductores) ponen `activacion_vence_en` en NULL. Los contratos de §4 no cambian.
