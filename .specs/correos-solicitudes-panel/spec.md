# Spec: correos-solicitudes-panel

- Author: Felipe Vicencio (PO) + agente
- Date: 2026-11-09
- Status: Pedida por el PO en sesión el 2026-11-09 (§10)
- Linked: `.specs/bordes-autenticacion/spec.md` (#895; esta spec se apoya en ella), `.specs/acceso-panel-plataforma/spec.md` (#893: regla única de acceso y lista de respaldo), `.specs/alta-membresia/` (alta por exención), ADR-035 (RUT + clave numérica)

---

## 1. Objective

Reglas para las altas de cuentas y para las cuentas del proveedor de identidad que usan:

- la aprobación de una solicitud de registro aplica la regla de la lista de respaldo y de los correos reservados;
- la primera activación del conductor tiene una sola entrada aunque lleguen dos pedidos a la vez;
- un correo es el mismo con o sin mayúsculas cuando se compara con las cuentas existentes;
- una activación reutiliza una cuenta del proveedor solo si ya es de la persona o está libre;
- una cuenta del proveedor creada al aprobar una solicitud entra solo por el onboarding;
- las dos reglas anteriores valen también para las aprobaciones ya hechas.

## 2. Why now

El PO pidió sumarlas a la serie de `acceso-panel-plataforma` (#893) y `bordes-autenticacion` (#895) en un PR propio, apilado sobre #895, porque usan su chequeo de la lista y su escritura con predicado.

## 3. Success criteria

- [ ] SC1 — **La aprobación de una solicitud aplica la regla de la lista de respaldo y de los correos reservados.** `approveSignupRequest` (`POST /admin/signup-requests/:id/approve`), con y sin enlace de onboarding (`ADMIN_PROVISIONED_ONBOARDING_ENABLED`), crea la cuenta del proveedor de identidad solo si el correo de la solicitud está libre. Si está en `BOOSTER_PLATFORM_ADMIN_EMAILS` (sin distinguir mayúsculas ni espacios, con `correoEnListaRespaldo`), es un correo reservado (`esEmailDeRelleno`: el dominio `boosterchile.invalid` de las cuentas que se entran por RUT y el relleno `pending-rut-` del alta vieja) o ya es el correo de una cuenta (`lower(email) = lower($1)`), responde el 409 `firebase_user_already_exists` de la ruta: no crea la cuenta, no entrega `access_link` ni `onboarding_link` y la solicitud sigue pendiente. `POST /admin/signup-requests/exencion` (`emitirAltaExencion`) aplica la misma regla con su 409 `email_already_registered`, sin insertar la solicitud. `POST /api/v1/signup-request` (`submitSignupRequest`) trata un correo de la lista o reservado igual que uno ya usado: la misma 202, sin solicitud nueva.
- [ ] SC2 — **La primera activación simultánea del conductor tiene una sola entrada.** En `POST /auth/driver-activate`, si al crear la cuenta del proveedor de identidad la respuesta es `auth/email-already-exists`, se vuelve a leer esa cuenta y se sigue hasta la escritura con predicado de `bordes-autenticacion` SC3, que decide qué pedido activa. El otro recibe la misma 401 `invalid_credentials` de un código incorrecto, sin sesión. Cualquier otro error del proveedor sigue respondiendo 502 `firebase_error`.
- [ ] SC3 — **Un correo es el mismo con o sin mayúsculas frente a las cuentas existentes.** Estas seis altas comparan el correo con las cuentas existentes con `lower(email) = lower($1)` y responden lo que ya responden ante un correo registrado:
  - `POST /admin/empresas/:id/miembros` → 409 `email_already_registered`;
  - `POST /admin/stakeholder-orgs/:id/invitar` → 409 `email_already_registered`;
  - `POST /me/empresa/miembros` → 409 `email_already_registered`;
  - `onboardEmpresa` (`POST /empresas/onboarding` y `POST /empresas/onboarding-admin`) → `EmailAlreadyInUseError` (409 `email_in_use`);
  - `emitirAltaExencion` → 409 `email_already_registered`;
  - `submitSignupRequest` → 202 sin solicitud nueva.

  En las tres invitaciones, si otra alta guarda el mismo correo entre la búsqueda y el INSERT, el choque con el UNIQUE de `usuarios.email` responde el mismo 409 `email_already_registered`, no un 500. En las seis, un solo helper (`services/correo-de-cuenta.ts`) decide si un correo está ocupado: ya es de una cuenta, está en la lista de respaldo o es reservado. Consulta la base en todos los casos, así que un correo ocupado cuesta lo mismo sea cual sea el motivo. Reemplaza los chequeos de lista que agregó `bordes-autenticacion` SC5, con la misma respuesta. Sin migración y sin tocar el UNIQUE.
- [ ] SC4 — Tests nombrados para SC1–SC3 y SC5–SC7, con el rojo exhibido en un commit propio que precede a cada implementación (auth es dominio crítico), integración contra Postgres real y `pnpm run ci` corrido en el momento.
- [ ] SC5 — **Una activación reutiliza una cuenta del proveedor solo si ya es de la persona o está libre.** `POST /auth/activar`, `POST /auth/driver-activate` (también en la relectura de SC2) y `POST /auth/login-rut` (cuenta con `firebase_uid` provisorio `pending-rut:`) buscan la cuenta del proveedor por el correo sintético del RUT. Reutilizan la cuenta que encuentran solo en dos casos:
  - su uid ya es el `firebase_uid` de la cuenta que se activa;
  - está libre: no tiene un proveedor propio (`providerData` vacío, es decir, sin contraseña, sin enlace por correo y sin otro proveedor), su uid no es el `firebase_uid` de otra fila de `usuarios` y no es el `firebase_uid` de una fila de `solicitudes_registro`.

  Si no, la activación no escribe nada ni entrega sesión, y responde lo que cada ruta ya responde ante una falla del proveedor: `/auth/activar` 503 `firebase_error`, `/auth/driver-activate` 502 `firebase_error` y `/auth/login-rut` 502 `firebase_error`. El motivo queda en el log de error. La cuenta que devuelve el proveedor pasa por Zod: una forma que no se reconoce no se reutiliza. `bootstrapPlatformAdmin` no reutiliza una cuenta cuyo uid es el `firebase_uid` de una solicitud: aborta sin escrituras con `CuentaDeSolicitudError`.
- [ ] SC6 — **Una cuenta del proveedor creada al aprobar una solicitud entra solo por el onboarding.** En `GET /me`, cuando ninguna cuenta tiene el uid de la sesión y ese uid es el `firebase_uid` de una fila de `solicitudes_registro`, `/me` no vincula por correo una cuenta existente ni crea la cuenta de la lista de respaldo. Responde `needs_onboarding: true`, como a cualquier sesión sin cuenta. El onboarding con el token de la aprobación (`onboardEmpresa`) sigue siendo su entrada.
- [ ] SC7 — **SC5 y SC6 valen también para las aprobaciones ya hechas.** Las dos reglas leen el estado al momento de usarlo: los proveedores de la cuenta y las filas de `usuarios` y `solicitudes_registro`. No dependen de una marca puesta al aprobar, así que no necesitan migración ni backfill. En el modo sin enlace de onboarding, la aprobación no guarda el uid en la solicitud: crea con él una fila de `usuarios`, que SC5 cuenta como otra cuenta.

## 4. Contratos

Sin contratos nuevos: cada ruta reutiliza una respuesta que ya tenía.

- `POST /admin/signup-requests/:id/approve` → 409 `firebase_user_already_exists` (SC1).
- `POST /admin/signup-requests/exencion` → 409 `email_already_registered` (SC1, SC3).
- `POST /api/v1/signup-request` → 202 `{ ok: true }` (SC1, SC3).
- `POST /auth/driver-activate` → 401 `invalid_credentials` (SC2).
- `POST /admin/empresas/:id/miembros`, `POST /admin/stakeholder-orgs/:id/invitar`, `POST /me/empresa/miembros` → 409 `email_already_registered` (SC3).
- `POST /empresas/onboarding` y `POST /empresas/onboarding-admin` → 409 `email_in_use` (SC3).
- `POST /auth/activar` → 503 `firebase_error`; `POST /auth/driver-activate` y `POST /auth/login-rut` → 502 `firebase_error` (SC5).
- `GET /me` → 200 `needs_onboarding: true` (SC6).

Firmas internas: `submitSignupRequest`, `approveSignupRequest` y `emitirAltaExencion` reciben la lista de respaldo como parámetro obligatorio, igual que `onboardEmpresa`. Sin ella el chequeo quedaría apagado sin aviso.

## 5. Out of scope

- El 410 de `/auth/driver-activate` y la impersonación quedan en `bordes-autenticacion`.
- Un índice o un UNIQUE sobre `lower(email)`, y normalizar los correos ya guardados con mayúsculas: sin migración. `usuarios` es chica; la búsqueda corre en las seis altas de SC3, una de ellas la solicitud pública, que ya tiene límite de frecuencia.
- Las altas con su propia comparación de correo siguen como están: `routes/conductores.ts` y `routes/admin-personal-booster.ts` ya comparan en minúsculas con su búsqueda, y `/me` vincula por correo verificado y crea la cuenta de la lista con el correo exacto que entrega el proveedor de identidad. Llevarlas al helper es otro cambio.
- Una respuesta uniforme para la primera activación simultánea en `/auth/activar` y `/auth/login-rut`: SC2 cubre solo `/auth/driver-activate`.
- Traducir a 409 el choque con el UNIQUE de `usuarios.email` en el onboarding: esta spec lo hace en las tres invitaciones.
- Borrar, deshabilitar o modificar una cuenta del proveedor que SC5 no reutiliza. La activación se detiene y la cuenta queda como está; resolverla es una tarea de soporte.
- Que `/me` vincule por correo sin distinguir mayúsculas: hoy compara el correo exacto y SC6 no lo cambia.
- Cambiar cómo entrega la aprobación el enlace de acceso.

## 6. Constraints

1. La comparación con la lista es `correoEnListaRespaldo` (`apps/api/src/auth/acceso-plataforma.ts`, #893). Nada repite la normalización.
2. Anti-enumeración: cada rechazo es la respuesta que la ruta ya da ante un correo registrado, y un correo de la lista o reservado no se distingue de uno ya usado, ni por la respuesta ni por las consultas que hace la ruta.
3. Stack: Zod en el boundary, cero `any`, logger estructurado, coverage ≥ 80 % en código nuevo, TDD con rojo exhibido.

## 7. Approach

- `services/correo-de-cuenta.ts`: `existeCuentaConCorreo(db, email)` busca con `lower(email) = lower($1)`; `correoOcupado({ db, email, lista })` busca la cuenta siempre y después combina el resultado con la lista (`correoEnListaRespaldo`) y con los correos reservados (`esEmailDeRelleno`, de `@booster-ai/shared-schemas`).
- `services/signup-request.ts`: `correoOcupado` en `submitSignupRequest`, y en `approveSignupRequest` como primer paso tras leer la solicitud, sin llegar a `createUser` si el correo está ocupado. Las rutas pasan `config.BOOSTER_PLATFORM_ADMIN_EMAILS`.
- `services/emitir-alta-exencion.ts`: `correoOcupado` en su chequeo previo; pasa la lista al approve.
- `routes/auth-driver.ts`: si `createUser` responde `auth/email-already-exists`, `getUserByEmail` y sigue a la escritura. `codigoError` se exporta desde `services/identidad-firebase-conductor.ts`.
- `routes/admin-empresa-miembros.ts`, `routes/admin-stakeholder-orgs.ts`, `routes/me-empresa-miembros.ts` y `services/onboarding.ts`: `correoOcupado` en lugar de la búsqueda exacta y del chequeo de lista. En las tres invitaciones, `esEmailDuplicado` en el `catch` del INSERT.
- `services/cuenta-proveedor-reutilizable.ts`: `cuentaProveedorReutilizable({ db, cuenta, usuario })` valida la cuenta con Zod y decide SC5; `cuentaCreadaPorSolicitud(db, uid)` busca el uid en `solicitudes_registro`. Las usan `routes/auth-activar.ts`, `routes/auth-driver.ts`, `routes/auth-universal.ts` y `services/bootstrap-platform-admin.ts` (SC5), y `routes/me.ts` (SC6).

## 8. Test list

- T1 (SC1, rojo) — `services/signup-request.test.ts`: el approve con un correo de la lista, con uno reservado, con y sin enlace, o con el de una cuenta existente → `firebase_user_already_exists`, sin `createUser`, sin enlace y sin escrituras; la búsqueda usa `lower(...)` y corre también con un correo de la lista. El submit con un correo de la lista, con uno reservado o con el de una cuenta guardada con otras mayúsculas → `shadowed`, con la misma consulta y sin INSERT.
- T2 (SC1, rojo) — `routes/admin-signup-requests.test.ts` y `routes/signup-request.test.ts`: la ruta del approve responde 409 sin `access_link` en los dos modos, también con un correo reservado; la exención con un correo de la lista o reservado → 409 `email_already_registered` sin `createUser`; su búsqueda usa `lower(...)`. La solicitud pública con un correo de la lista o reservado → la misma 202, con la misma consulta y sin guardar.
- T3 (SC2, rojo) — `test/unit/auth-driver.test.ts`: `createUser` con `auth/email-already-exists` → vuelve a leer la cuenta; si la escritura no toma filas → 401 sin sesión; si las toma → 200 con esa cuenta. Otro error del proveedor → 502.
- T4 (SC3, rojo) — `admin-empresa-miembros`, `admin-stakeholder-orgs`, `me-empresa-miembros` y `onboarding-service`: la búsqueda usa `lower(...)`; una cuenta guardada con otras mayúsculas → 409 sin escribir. En las tres invitaciones, además, el choque con el UNIQUE en el INSERT → 409.
- T5 (SC1, SC3) — integración `correo-de-cuenta.integration.test.ts` contra Postgres real: las tres invitaciones con la variante en minúsculas de una cuenta guardada con mayúsculas y con un correo reservado; el choque con el UNIQUE en el INSERT de las tres; `onboardEmpresa`, `submitSignupRequest`, `emitirAltaExencion` y el approve en los dos modos, con un correo de la lista, uno reservado y la variante de una cuenta. Con un correo de la lista sin cuenta, las tres invitaciones quedan como regresión de `bordes-autenticacion` SC5 sobre el helper.
- T6 (SC2) — integración `driver-activate-simultanea.integration.test.ts`: dos primeras activaciones simultáneas sin cuenta previa del proveedor, con un doble cuyo `createUser` rechaza un correo repetido → una 200 y una 401, y queda la clave de quien entró.
- T7 — `services/correo-de-cuenta.test.ts`: el helper. Va con la implementación porque el módulo es nuevo. Los correos reservados y la consulta en todos los casos tienen su rojo propio.
- T8 (SC5, rojo) — `services/cuenta-proveedor-reutilizable.test.ts`: la cuenta de la persona se reutiliza aunque tenga proveedores; una cuenta libre se reutiliza; con un proveedor propio, con el uid de otra fila de `usuarios`, con el uid de una solicitud o con una forma que no se reconoce, no.
- T9 (SC5, rojo) — `test/unit/auth-driver.test.ts`, `test/unit/auth-universal.test.ts` y `routes/auth-activar.test.ts`: una cuenta encontrada con un proveedor propio, o con el uid de otra fila o de una solicitud, responde la falla del proveedor de cada ruta, sin escribir la cuenta y sin sesión. También en la relectura de SC2. Una cuenta libre sigue activando.
- T10 (SC5, rojo) — `services/bootstrap-platform-admin.test.ts`: una cuenta existente cuyo uid es el de una solicitud → `CuentaDeSolicitudError`, sin escrituras.
- T11 (SC6, rojo) — `test/unit/me-platform-admin.test.ts` y `test/unit/me-onboarding-google-path.test.ts`: una sesión cuyo uid es el de una solicitud no vincula por correo ni crea la cuenta de la lista y responde `needs_onboarding: true`.
- T12 (SC5–SC7) — integración `cuentas-proveedor-aprobacion.integration.test.ts` contra Postgres real: una solicitud aprobada con el uid de la cuenta, insertada como queda hoy en la base, frena la activación por los tres caminos, el bootstrap, el vínculo por correo y la cuenta de la lista. Una cuenta libre sigue activando, y en el modo sin enlace la fila de `usuarios` de la aprobación frena la activación.

## 9. Rollout

Merge después de #895 y release (lo dispara el PO). Sin migración. Una solicitud pendiente cuyo correo esté en la lista, sea reservado o ya sea de una cuenta responde 409 al aprobarla y se resuelve rechazándola desde el panel. Una activación que SC5 detiene queda en el log de error con su motivo y se resuelve desde soporte.

## 10. Decision log

- 2026-11-09 — El PO pide llevar a la serie de #893 y #895 tres reglas de altas de cuentas, con commits y spec propios. Se apila sobre #895.
- 2026-11-09 — `submitSignupRequest` trata un correo de la lista igual que uno ya usado. La respuesta es la misma 202 en todos los casos, así que nada cambia para quien envía el formulario. Una solicitud con ese correo no se podría aprobar (SC1) ni completar en el onboarding (`bordes-autenticacion` SC5): así no llega a la cola del panel. El approve y la exención mantienen su propio chequeo para las solicitudes que ya están en la cola y para los cambios de la lista.
- 2026-11-09 — Un helper, `correoOcupado`, reemplaza los chequeos de lista de #895 en las altas. La lista se revisa primero, sin consulta, y los dos casos dan la misma respuesta.
- 2026-11-09 — SC2 usa la cuenta del proveedor que creó el otro pedido: su correo sintético sale del mismo RUT, así que es la misma identidad, y la escritura con predicado de #895 decide quién entra.
- 2026-11-09 — Sin índice sobre `lower(email)` ni migración: fuera de alcance.
- 2026-11-09 — Un correo reservado (`esEmailDeRelleno`) está ocupado. El dominio `boosterchile.invalid` es el de las cuentas del proveedor de identidad que se entran por RUT, y el relleno `pending-rut-` no es un canal real: ninguna alta crea una cuenta con ellos. Misma respuesta que un correo registrado.
- 2026-11-09 — `correoOcupado` busca la cuenta en todos los casos y combina después con la lista y con los correos reservados. Así, en cada alta y en la solicitud pública, los tres motivos hacen la misma consulta (§6.2). Reemplaza lo anotado arriba: la lista ya no se revisa primero ni sin consulta.
- 2026-11-10 — El PO pide sumar a este PR tres reglas sobre las cuentas del proveedor de identidad: SC5, SC6 y SC7.
- 2026-11-10 — SC5 usa `providerData` para saber si una cuenta tiene credenciales propias. El proveedor informa `password` solo cuando la cuenta tiene contraseña o entra por enlace de correo, así que una cuenta creada sin contraseña llega con la lista vacía. Las cuentas que crean las activaciones no tienen contraseña ni otro proveedor.
- 2026-11-10 — Cuando SC5 no reutiliza la cuenta, la activación se detiene con la respuesta de una falla del proveedor. No borra ni modifica la cuenta: queda para soporte.
- 2026-11-10 — SC6 mira solo el uid guardado en la solicitud. En el modo sin enlace, la aprobación crea la fila de `usuarios` con ese uid, así que `/me` la encuentra por uid y no llega al vínculo por correo.
