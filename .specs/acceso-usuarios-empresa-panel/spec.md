# Spec: acceso-usuarios-empresa-panel

- Author: Felipe Vicencio (PO) + agente
- Date: 2026-10-30
- Status: Draft — decisiones del PO tomadas en sesión el 2026-10-30 (§9)
- Linked: `.specs/alta-desde-panel-admin/spec.md` (alta de ficha e invitación desde el panel; esta spec cierra su OQ1 y no edita el archivo), `.specs/reemision-codigo-activacion-admin/spec.md` (su SC2 queda reemplazado por SC5 de esta spec), `.specs/equipo-de-la-empresa/` (código de un solo uso y `/activar`), `.specs/alta-personal-booster/spec.md` (spec hermana: personal de Booster en el panel), ADR-035 (RUT + clave numérica)

---

## 1. Objective

Que una persona de una empresa generadora de carga, de una transportista o de una empresa mixta, dada de alta desde el panel de Booster, llegue a usar la web de su empresa sin que nadie le explique URLs a mano. Y que una persona de Booster que además pertenece a una empresa pueda pasar del panel a la web de su empresa y volver.

## 2. Why now

El 2026-10-30 el PO pidió con urgencia resolver la creación de usuarios que entran a la administración de Booster, que pueden ser de una generadora y/o de una transportista. Leyendo el código aparecieron cuatro cortes en la cadena «el admin crea → la persona entra → usa la web»:

1. **El login deja sin salida al invitado que no es conductor.** `POST /auth/login-rut` responde 410 `needs_activation` a toda cuenta provisoria con código (`apps/api/src/routes/auth-universal.ts:115-131`). La web la manda siempre a `/login/conductor` (`apps/web/src/components/login/LoginUniversal.tsx:461-491`), que llama a `POST /auth/driver-activate`. Ese endpoint exige una ficha de conductor y responde 503 `not_a_driver` (`auth-driver.ts:142-153`), y la pantalla dice «Este RUT no está habilitado como conductor» (`login-conductor.tsx:111-113`). Le pasa a todo dueño, admin, despachador o visualizador invitado. La única empresa creada desde el panel tiene a su dueño sin activar desde el 2026-09-27 (`docs/frentes-vivos.md`, re-verificado el 2026-10-29).
2. **Ninguna pantalla enlaza a `/activar`.** El panel muestra el código con el texto «En Activar cuenta…», sin la dirección (`InvitarMiembroEmpresa.tsx:281-282`), y la ayuda de la re-emisión está en voseo y le habla a la persona equivocada (`ActivarEmpresa.tsx:305-306`).
3. **La generadora no tiene «Equipo» en el menú.** El ítem solo existe dentro de la sección Transporte (`apps/web/src/components/nav-items.ts`), aunque el backend deja a dueño y admin de cualquier empresa dar de alta a su gente (`me-empresa-miembros.ts:64-87`). Además `/app/equipo` se muestra sin el menú de la app (`equipo.tsx:92`).
4. **La persona de Booster que también es de una empresa queda encerrada en el panel.** `/app` redirige siempre a `/app/platform-admin` si `is_platform_admin` (`apps/web/src/routes/app.tsx:107-109`), y ni el panel ni el menú ofrecen el camino de vuelta.

Además, la empresa creada desde el panel nace en `pendiente_verificacion` (`admin-empresa-miembros.ts:271`). Sus usuarios entran, pero no pueden crear cargas (403 `empresa_not_active`, `trip-requests-v2.ts:201-210`) ni recibir ofertas (`services/matching.ts:183-191`) hasta un segundo paso manual que la web no anuncia.

## 3. Success criteria

- [ ] SC1 — Una persona con cuenta provisoria y código (`firebase_uid` `pending-rut:`, `activacion_pin_hash` no nulo) que entra por `/login` con un tipo distinto de «Conductor» y recibe 410 `needs_activation` ve «Activar mi cuenta», que la lleva a `/activar?rut=<rut>`. Con el tipo «Conductor» sigue yendo a `/login/conductor?rut=<rut>`, como hoy. En los dos casos la pantalla ofrece también el otro camino («¿Eres conductor?» / «¿Te dio de alta Booster o tu empresa?»).
- [ ] SC2 — En el formulario de `/login`, con un tipo distinto de «Conductor», aparece el aviso «¿Te dieron un código de activación? Activa tu cuenta», con enlace a `/activar`. Con «Conductor» se mantiene el aviso actual del PIN.
- [ ] SC3 — `/activar` precarga el RUT si llega `?rut=` y valida igual que hoy. Sus textos dicen que el código lo entrega Booster o la empresa («Booster o tu empresa te dio de alta…»; «si venció, pide uno nuevo a quien te dio de alta»).
- [ ] SC4 — En el panel, donde se muestra un código de activación (invitar persona y generar código nuevo), aparece la dirección absoluta de `/activar` (el `origin` de la web más `/activar`), copiable, junto al RUT, el código y el vencimiento. Los textos van en tuteo y le hablan al admin.
- [ ] SC5 — `POST /admin/empresas` crea la empresa en estado `activa`. El resto del contrato no cambia: 201, mismos campos, `carrier_memberships` free si es transportista, mismos errores. El evento de log del alta registra el estado inicial. El alta por enlace (`/onboarding-admin`) sigue naciendo en `pendiente_verificacion`.
- [ ] SC6 — Después de crear la empresa, el panel lo dice («quedó activa») y el formulario «Invitar persona» la deja preseleccionada con el rol `dueno` por defecto. Sin empresa preseleccionada, el rol por defecto sigue siendo `admin`.
- [ ] SC7 — Al invitar a una persona, la lista de empresas del panel se refresca y la invitación pendiente aparece con su botón «Generar código nuevo», sin recargar la página. La lista arranca en el filtro «Todas», para que una empresa activa recién creada y sus pendientes se vean sin cambiar el filtro.
- [x] SC8 — Cubierto por #880 (`.specs/equipo-generador/`), que entró a main el 2026-11-09: «Equipo» está en la sección general del menú para toda empresa con membresía, una sola vez; `/app/equipo` se muestra dentro del `Layout`; y el permiso «Puede aceptar ofertas» solo aparece en una transportista. Esta rama ya no cambia el menú ni `/app/equipo`.
- [ ] SC9 — Una persona de Booster (`is_platform_admin`) que tiene una membresía activa:
  - al entrar a `/app` sigue yendo al panel, como hoy, también si su membresía es de conductor;
  - en el panel ve «Ir a mi empresa» con el nombre de su empresa activa, que la lleva a la web de su empresa y la deja ahí al navegar por el menú (incluido «Inicio»);
  - en el menú de la web de la empresa ve «Panel de Booster», que la devuelve al panel.

  Sin membresía activa no aparece «Ir a mi empresa». La elección vive en `sessionStorage` (por pestaña); si el navegador no la permite, la web funciona igual y cae al comportamiento de hoy.
- [ ] SC10 — Tests nombrados para SC1–SC9. El rojo de SC1 (auth, dominio crítico) se exhibe antes de la implementación y va en la Evidencia del PR. Tests, lint, typecheck y build corridos en el momento.

## 4. Contratos

- **API.** Solo cambia el estado inicial de `POST /admin/empresas` (`pendiente_verificacion` → `activa`). No hay endpoints nuevos, ni migración, ni variables de entorno.
- **Web.** Cambian `/login` (vista de cuenta sin activar y aviso del formulario), `/activar` (textos y `?rut=`), `/app/platform-admin/empresas`, el menú de la generadora, `/app/equipo` (con `Layout`) y la navegación del doble rol (§3 SC9).
- `POST /auth/login-rut`, `POST /auth/activar` y `POST /auth/driver-activate` no cambian.

## 5. Out of scope

- El alta del personal de Booster en el panel: spec hermana `.specs/alta-personal-booster/`.
- Que el backend indique en el 410 si la cuenta es de conductor o de empresa. La web decide el camino con el tipo que eligió la persona y ofrece los dos; el contrato de `/auth/login-rut` no cambia.
- Crear empresa y dueño en un solo paso (SC1 de `alta-desde-panel-admin`): siguen siendo dos formularios en la misma página.
- Gestionar miembros activos desde el panel (quitar, cambiar rol) y el aviso de «empresa en verificación» para las empresas que llegan por enlace.
- Cambiar las capacidades por rol de `.specs/capacidades-por-rol/` (#817–#819, ya en main). Esta spec las respeta y solo precisa la entrada al panel con membresía de conductor (SC9).
- El menú y la página de «Equipo»: los resuelve #880 (`.specs/equipo-generador/`).

## 6. Constraints

1. **Principio de identidad** (`alta-cliente-autocontenida` §6.5): el admin nunca conoce la clave; el código sirve una vez para que la persona elija la suya.
2. **SEC-001 intacto**: el autoservicio sigue cerrado. Que la empresa creada por el admin nazca activa no abre superficie pública: el endpoint es solo de platform-admin y el admin es el gate.
3. **Copy**: tuteo chileno, sin voseo (#738).
4. **Stack**: cero `any`, Zod en el boundary, sin `console.*`, coverage ≥80 % en código nuevo, `sessionStorage` envuelto en try/catch.

## 7. Approach

- `LoginUniversal.tsx`: `NeedsActivationView` recibe el `tipo`; el destino principal es `/activar?rut=` salvo para `conductor`, y siempre muestra el enlace alternativo. El aviso del formulario se generaliza a los tipos no conductor.
- `activar.tsx`: lee `rut` de la búsqueda (TanStack Router `validateSearch` o equivalente ya usado en el repo) y ajusta textos.
- Panel: un helper único arma la URL de `/activar` desde `window.location.origin`; lo usan `InvitarMiembroEmpresa` y `ActivarEmpresa`. `InvitarMiembroEmpresa` expone `onInvitado`, y `platform-admin-empresas.tsx` sube el `refreshToken` con él. `ActivarEmpresa` arranca en «Todas».
- `admin-empresa-miembros.ts` (`POST /`): `status: 'activa'`. `CrearEmpresa.tsx`: textos.
- «Equipo» de la generadora: lo resuelve #880; esta rama no toca `nav-items.ts` ni `equipo.tsx`.
- Doble rol: un módulo pequeño (`lib/vista-admin.ts`) lee y escribe la preferencia en `sessionStorage`. `app.tsx` no redirige al panel si la preferencia es «empresa». `PlatformAdminFrame` muestra «Ir a mi empresa» (si hay membresía activa) y el `Sidebar` muestra «Panel de Booster» a quien es platform-admin; cada enlace fija o limpia la preferencia.

## 8. Test list

- T1 (SC1, rojo exhibido) — `LoginUniversal.test.tsx`: 410 `needs_activation` con tipo `generador`/`transportista`/`booster` → el botón principal apunta a `/activar?rut=…`; con `conductor` → `/login/conductor?rut=…`; el enlace alternativo existe en ambos.
- T2 (SC2) — el aviso con enlace a `/activar` aparece para tipos no conductor y no para conductor.
- T3 (SC3) — `activar.test.tsx`: `?rut=` precarga el campo; textos nuevos.
- T4 (SC4) — `InvitarMiembroEmpresa.test.tsx` y `ActivarEmpresa.test.tsx`: la URL absoluta de `/activar` aparece junto al código.
- T5 (SC5, rojo exhibido) — `admin-empresa-miembros.test.ts`: el insert de `POST /` lleva `status: 'activa'` y la respuesta trae `estado: 'activa'`. Integración `alta-admin-cadena`: el caso de alta sigue verde con el estado nuevo.
- T6 (SC6, SC7) — rol por defecto `dueno` con `preferEmpresaId`; `onInvitado` refresca la lista; filtro inicial «Todas».
- T7 (SC8) — Cubierto por los tests de #880 en `nav-items.test.ts` y `equipo.test.tsx`.
- T8 (SC9) — `app.test.tsx`: platform-admin sin preferencia → redirige al panel; con preferencia «empresa» → dashboard. Enlaces del panel y del menú fijan y limpian la preferencia. `sessionStorage` que lanza → comportamiento de hoy. `ProtectedRoute.test.tsx`: con membresía de conductor, la persona de Booster en `/app` no va a `/app/conductor`; en otra ruta de la app, sí.

## 9. Decision log

- 2026-10-30 — El PO aclara que la «UI de administración de Booster» es el panel `/app/platform-admin` y que los usuarios a crear son personal de Booster, que puede además ser usuario de una generadora y/o transportista (spec hermana).
- 2026-10-30 — El PO decide: la empresa creada desde el panel nace `activa` (cierra OQ1 de `alta-desde-panel-admin` en sentido contrario a su propuesta y reemplaza SC2 de `reemision-codigo-activacion-admin`); la generadora ve «Equipo»; la persona de Booster con empresa puede alternar entre el panel y la web de su empresa; se arregla el login del invitado que no es conductor en este mismo trabajo.
- 2026-11-09 — Al integrar main con #819 (agente, pendiente del visto del PO en el PR): la persona de Booster con membresía de conductor sigue entrando al panel por `/app` (SC9), y Equipo de una generadora pura no muestra «Puede aceptar ofertas» (SC8; después lo trajo también #880). Las demás rutas del menú siguen la regla de #819 para el conductor.
- 2026-11-09 — #880 (`equipo-generador`, pedido por el PO el 2026-11-04) entró a main con «Equipo» en la sección general del menú, el `Layout` en `/app/equipo` y el permiso de ofertas solo en transportistas. Al integrarlo, esta rama retira su versión de SC8 (el ítem en la sección Generador) para no duplicarlo, y SC8 queda cubierto por #880.
