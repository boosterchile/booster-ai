# Spec: confirmar-acceso-booster

- Author: Felipe Vicencio (PO) + agente
- Date: 2026-11-09
- Status: Propuesta. La decisión de §10 va con el visto del PO en el PR.
- Linked: `.specs/acceso-panel-plataforma/spec.md` (#893, base de esta rama: el panel otorga y quita el acceso), `.specs/alta-personal-booster/spec.md` (panel del personal), ADR-028 (el «Admin Booster» es la cuenta con `usuarios.es_admin_plataforma = true`), ADR-035 (RUT + clave numérica)

---

## 1. Objective

Cuando el panel del personal da de alta a una persona cuya cuenta ya tiene clave y ya está vinculada a una empresa, el acceso al panel lo confirma la propia persona desde su sesión, con un código que el admin de Booster le entrega en persona. El resto de las altas sigue igual que en #893.

## 2. Why now

Con #893 el alta marca de inmediato toda cuenta que registra, también una cuenta activa. Una cuenta activa con vínculos a empresas ya tiene historia fuera del panel de Booster, así que el PO pidió que en ese caso el acceso lo confirme la propia persona, desde su sesión y con un código que recibe en persona.

## 3. Success criteria

- [ ] SC1 — **Alta de una cuenta activa con vínculos.** `POST /admin/personal-booster` sobre una cuenta existente que ya tiene clave (`clasificarVinculoPersona` = `cuenta_activa`), que no está marcada y que tiene al menos una fila en `membresias` con `empresa_id` (en cualquier estado) o una fila en `conductores` (en cualquier estado, también retirada): no la marca. Emite un **código de confirmación** de 6 dígitos, vigente 24 horas, guardado solo como hash en `confirmaciones_acceso_booster`, y lo devuelve una sola vez: `200` con `vinculo: 'cuenta_activa_por_confirmar'`, `codigo_activacion` = el código y `expira_en` = su vencimiento. El código no sale por correo ni por WhatsApp: el admin lo entrega en persona. La lista de respaldo no recibe aviso, porque todavía no hay acceso.
- [ ] SC2 — **Cuenta activa sin vínculos.** Sigue como en #893: el alta la marca y queda con acceso desde ese momento. Una cuenta ya marcada responde `cuenta_activa` sin cambios. Una provisoria sigue con el código de activación de siempre.
- [ ] SC3 — **Una confirmación pendiente por persona.** Emitir un código de confirmación (alta o «Generar código nuevo») borra la confirmación pendiente anterior en la misma transacción, con la fila de la cuenta bloqueada. Un índice único parcial (`usuario_id` con `consumido_en IS NULL`) lo garantiza en la base. Una confirmación consumida queda como registro.
- [ ] SC4 — **Confirmar.** `POST /me/confirmar-acceso-booster` con `{ codigo }`, desde la sesión de la persona. Si el código coincide con su confirmación pendiente, está vigente y le quedan intentos: marca `es_admin_plataforma = true`, deja `consumido_en` y responde `200 { ok: true, user_id }`. Desde la request siguiente la regla única de acceso (`tieneAccesoPlataforma`) le da el panel si la cuenta está `activo`. En una sesión de impersonación es una escritura bloqueada: `403 forbidden_impersonation_write`, sin leer la base.
- [ ] SC5 — **Respuesta única.** Sin confirmación pendiente, con un código incorrecto, vencido o sin intentos, la respuesta es la misma: `400 { error: 'codigo_invalido', code: 'codigo_invalido' }`. Sin confirmación pendiente el código se verifica igual contra un hash de relleno, para que esa respuesta tarde lo mismo que la de un código incorrecto.
- [ ] SC6 — **Cinco intentos por código.** Cada código incorrecto sobre una confirmación vigente suma un intento fallido. Al quinto la confirmación deja de servir, también con el código correcto, hasta que el admin emita otro. La lectura bloquea la fila de la cuenta y la de la confirmación hasta el commit, para que intentos en paralelo cuenten todos.
- [ ] SC7 — **Auditoría y aviso.** La confirmación deja el evento `personal_booster.acceso_otorgado` (quién emitió el código, a quién por `user_id`, `via: 'confirmacion'`, cuántos avisos) y manda el aviso de acceso otorgado a cada correo de la lista de respaldo, con quién entregó el código y a quién. Cada rechazo deja `personal_booster.confirmacion_rechazada` con la persona y el motivo interno. El alta deja `personal_booster.alta` con el vínculo. El código nunca va a logs, spans, métricas, auditoría ni avisos.
- [ ] SC8 — **Generar código nuevo.** `POST /admin/personal-booster/:userId/codigo` sobre una persona sin marca con una confirmación pendiente (vigente, vencida o sin intentos) emite un código de confirmación nuevo y responde como el alta: `vinculo: 'cuenta_activa_por_confirmar'`, `codigo_activacion`, `expira_en` a 24 horas, sin correo. La respuesta de la re-emisión suma el campo `vinculo`: `provisoria_sin_codigo` para el código de activación de siempre. Sin marca y sin confirmación pendiente → `404 personal_not_found`, como hoy.
- [ ] SC9 — **Lista del personal.** `GET /admin/personal-booster` incluye a la persona sin marca con una confirmación pendiente, con `estado: 'pendiente_confirmacion'`, `expira_en` = el vencimiento del código (`null` si ya no le quedan intentos) y `ultimo_login_en: null`.
- [ ] SC10 — **Quitar acceso de una persona por confirmar.** `POST /admin/personal-booster/:userId/quitar-acceso` sobre una persona sin marca con una confirmación pendiente borra la confirmación → `200 { ok: true, user_id }` y deja el evento `personal_booster.confirmacion_invalidada`, sin aviso (nunca tuvo acceso). Si su correo está en la lista de respaldo → `409 en_lista_respaldo`, sin escrituras, igual que una cuenta marcada.
- [ ] SC11 — **Contratos** en `packages/shared-schemas/src/domain/personal-booster.ts` (Zod + `z.infer`): vínculo, estado, request y respuesta del endpoint nuevo, código de error, vigencia e intentos.
- [ ] SC12 — **Wiring.** La ruta se monta bajo `/me` con firebaseAuth → impersonation-write-guard → userContext. Queda clasificada `ENFORCED` en `check-route-default-deny.ts`, y el test de impersonation wire comprueba que su path tiene el guard antes del userContext.
- [ ] SC13 — **Observabilidad.** Span `personal_booster.confirmar_acceso` y counter `personal_booster_confirmacion_total{resultado}` en el endpoint nuevo. El alta suma el vínculo `cuenta_activa_por_confirmar` a su counter y su span, y la re-emisión y la baja suman su resultado.
- [ ] SC14 — **Persistencia.** Migración aditiva `0076_confirmaciones_acceso_booster` (tabla nueva, índice único parcial, sin backfill). No se reutilizan `activacion_pin_hash` ni `activacion_vence_en`, que siguen siendo el código de activación del panel.
- [ ] SC15 — Tests de §8 con el rojo exhibido antes de implementar (auth es dominio crítico). Integración contra Postgres real de la cadena: cuenta activa en una empresa → alta → `403` en `/admin/*` → confirma con el código desde su sesión → `/me` con `is_platform_admin: true` y una ruta `/admin/*` en `200`; cinco códigos malos dejan la confirmación sin uso; un código vencido no sirve; la migración aplica sobre todas las de main. `pnpm run ci` corrido en el momento.

## 4. Contratos

- **Nuevo** `POST /me/confirmar-acceso-booster`, body `confirmarAccesoBoosterSchema` = `{ codigo: string }` de 6 dígitos.
  - `200 { ok: true, user_id }` (`confirmarAccesoBoosterResponseSchema`).
  - `400 { error: 'codigo_invalido', code: 'codigo_invalido' }` (`confirmarAccesoBoosterErrorCodeSchema`) para todo rechazo de SC5.
  - `400` con el body común de validación si `codigo` no tiene 6 dígitos.
  - `401 unauthorized` sin sesión · `404 user_not_registered` sin cuenta (userContext) · `403 forbidden_impersonation_write` en impersonación.
- **Vínculo nuevo** `cuenta_activa_por_confirmar` en `vinculoPersonalBoosterSchema`. En `altaPersonalBoosterResponseSchema` trae siempre `codigo_activacion` y `expira_en`.
- **Estado nuevo** `pendiente_confirmacion` en `personalBoosterEstadoSchema`.
- `reemitirCodigoPersonalBoosterResponseSchema` suma `vinculo: 'provisoria_sin_codigo' | 'cuenta_activa_por_confirmar'`. Si falta al parsear, vale `provisoria_sin_codigo`: una web nueva lee bien la respuesta de un API anterior.
- Constantes `CONFIRMACION_ACCESO_BOOSTER_VIGENCIA_HORAS = 24` y `CONFIRMACION_ACCESO_BOOSTER_MAX_INTENTOS = 5`.
- `POST /admin/personal-booster`, `POST /:userId/codigo`, `POST /:userId/quitar-acceso` y `GET /admin/personal-booster`: mismo request; las respuestas suman lo de SC1, SC8, SC9 y SC10.
- **Tabla nueva** `confirmaciones_acceso_booster`: `id uuid PK`, `usuario_id uuid NOT NULL → usuarios(id)`, `codigo_hash text NOT NULL`, `vence_en timestamptz NOT NULL`, `intentos_fallidos integer NOT NULL DEFAULT 0 (≥ 0)`, `emitido_por_usuario_id uuid NOT NULL → usuarios(id)`, `creado_en timestamptz NOT NULL DEFAULT now()`, `consumido_en timestamptz NULL`. Índice único parcial `uq_confirmaciones_acceso_booster_pendiente (usuario_id) WHERE consumido_en IS NULL`.

## 5. Out of scope

- La web: el formulario donde la persona ingresa el código y los textos del panel para el código de confirmación. Esta rama solo ajusta lo que el typecheck exige por el estado nuevo.
- Que `GET /me` diga si la cuenta tiene una confirmación pendiente.
- Avisar a la persona o a la empresa por correo o WhatsApp.
- Revocar sesiones Firebase.

## 6. Constraints

1. **ADR-028**: el «Admin Booster» sigue siendo la cuenta con `es_admin_plataforma = true`. La confirmación solo decide cuándo se pone la marca.
2. **Principio de identidad** (#893): el admin carga datos, nunca la clave. El alta no cambia RUT, nombre, correo ni clave de una cuenta existente.
3. **Código de activación del panel**: `activacion_pin_hash` y `activacion_vence_en` conservan su significado. El código de confirmación vive en su propia tabla.
4. **Stack**: Zod en el boundary, cero `any`, logger estructurado sin el código, span OTel y métrica de negocio, coverage ≥ 80 % en código nuevo, TDD con rojo exhibido, migración solo aditiva.

## 7. Approach

- `apps/api/src/services/confirmacion-acceso-booster.ts`: `tieneVinculoConEmpresa`, `emitirConfirmacionAccesoBooster`, `invalidarConfirmacionPendiente`, `confirmarAccesoBooster` y `codigoConfirmacionUsable` (pura).
- `apps/api/src/routes/me-confirmar-acceso-booster.ts`: el endpoint nuevo.
- `admin-personal-booster.ts`: el alta decide la confirmación (SC1/SC2), la re-emisión y la baja atienden a la persona por confirmar (SC8/SC10) y el listado la muestra (SC9).
- `aviso-acceso-panel-email.ts`: la acción `confirmado` para el aviso de SC7.
- `server.ts`: `app.use('/me/confirmar-acceso-booster', userContextMiddlewareForMe)` y `meRouter.route('/confirmar-acceso-booster', …)`.
- Orden de bloqueo: primero la fila de `usuarios`, después la de la confirmación, en el alta, la re-emisión y la confirmación.

## 8. Test list

- T1 (SC11) — `personal-booster.test.ts`: vínculo y estado nuevos; el alta `cuenta_activa_por_confirmar` exige código y vencimiento; la re-emisión con `vinculo` y su valor por defecto; request, respuesta y error del endpoint nuevo; constantes.
- T2 (SC1, SC2, SC3, SC7, SC13, rojo) — `admin-personal-booster.test.ts`: cuenta activa con vínculos → sin marca, confirmación emitida con su hash y 24 horas, la pendiente anterior borrada, sin correo ni aviso, auditoría y métrica sin el código; cuenta activa sin vínculos → marcada; la consulta de vínculos mira `membresias` con `empresa_id` y `conductores`.
- T3 (SC8, SC9, SC10, rojo) — re-emisión de una persona por confirmar (código de confirmación, sin correo, `vinculo`), 404 sin confirmación; la lista con `pendiente_confirmacion`, vencimiento y `null` sin intentos; quitar acceso de una persona por confirmar, 409 por la lista y 404.
- T4 (SC4–SC7, SC13, rojo) — `me-confirmar-acceso-booster.test.ts`: confirma y marca; rechazos con la misma 400; relleno sin confirmación; intento sumado; quinto intento; vencido; impersonación 403 sin leer la base; sin sesión 401; aviso a la lista y auditoría sin el código; métrica y span.
- T5 (SC12) — harness default-deny (montada y `ENFORCED`) e impersonation wire (guard antes del userContext en el path nuevo).
- T6 (SC7) — `aviso-acceso-panel-email.test.ts`: la acción `confirmado` nombra a quien entregó el código y no lleva código.
- T7 (SC15) — integración `confirmar-acceso-booster-cadena.integration.test.ts`: la cadena de SC15 contra Postgres, más la re-emisión que invalida el código anterior y la baja de una persona por confirmar. `alta-personal-booster-cadena` sigue verde.

## 9. Rollout

1. La migración 0076 es aditiva y se aplica al arrancar. Una revisión anterior ignora la tabla.
2. Merge y release (lo dispara el PO).
3. Rollback: volver a la revisión anterior deja las confirmaciones pendientes sin uso y las cuentas sin marca. El admin las vuelve a dar de alta tras re-desplegar.

## 10. Decision log

- 2026-11-09 — El PO pidió soluciones para el alta de una cuenta activa con vínculos a empresas. Se propone: el alta no la marca y emite un código de confirmación que el admin entrega en persona; la persona lo confirma desde su sesión. Va con el visto del PO en el PR.
- 2026-11-09 — Cuentan como vínculo las membresías en una empresa en cualquier estado y también las filas de `conductores`: el alta de un conductor crea la cuenta sin membresía, y la membresía de conductor se crea al activar. Las membresías en organizaciones stakeholder no cuentan: solo las crea el platform-admin.
- 2026-11-09 — Invalidar una confirmación pendiente es borrar su fila: la tabla guarda el código vivo y las confirmaciones consumidas, y la auditoría sigue en el log estructurado `personal_booster.*`.
- 2026-11-09 — El rechazo del endpoint nuevo es `400 codigo_invalido` y no `401`: la sesión es válida y lo que no sirve es el dato. Mismo criterio que `POST /me/clave-numerica`, que no responde `401` ante una clave anterior incorrecta.
