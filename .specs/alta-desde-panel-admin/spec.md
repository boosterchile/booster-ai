# Spec: alta-desde-panel-admin

- Author: Felipe Vicencio (PO) + agente
- Date: 2026-09-23
- Status: Draft — pendiente de aceptación del PO
- Linked: `.specs/onboarding-flow-redesign/` (programa madre — esta spec **enmienda su §8**: la alternativa C «admin tipea» deja de estar rechazada), `.specs/alta-cliente-autocontenida/` (principio de identidad §6.5, que esta spec aplica), `.specs/equipo-de-la-empresa/` (código de activación y `POST /auth/activar`, que esta spec reusa), ADR-035 (RUT + clave numérica), ADR-052 (alta gateada por admin), SEC-001, ADR-034 (stakeholders, fuera de alcance: ver §5)

---

## 1. Objective

Que el admin de Booster cree desde `/app/platform-admin` una empresa generadora de carga, una empresa de transportes o una que sea ambas, junto con su dueño, **sin que el cliente llene el formulario de alta**, y que el dueño entre con una clave que elige él mismo.

## 2. Why now

- El 2026-09-23 el PO pidió habilitar en el panel admin la creación de generadores de carga, empresas de transporte y stakeholders, y eligió que el admin cree la empresa sin formulario del cliente.
- Hoy una empresa solo nace si el cliente pide acceso en `/solicitar-acceso`, el admin aprueba, copia dos enlaces que vencen en 72 h y se los entrega por fuera del producto, y el cliente completa un formulario de 4 pasos en `/onboarding-admin`. Aunque el admin tenga todos los datos del cliente, no puede crear la empresa.
- El riesgo que hacía inviable esta alternativa en junio ya no existe. El riesgo de fondo era que quien tipea los datos terminara fijando también la credencial del dueño. Desde el 2026-07-31 (#640) hay en producción un mecanismo para dar de alta a una persona sin conocer su clave: un código de un solo uso y la pantalla `/activar`, donde la persona elige su clave.

## 3. Success criteria

- [ ] SC1 — Desde `/app/platform-admin`, el admin crea una empresa con razón social, RUT, email y teléfono de contacto, dirección, tipo (generador de carga, transportista o ambos) y plan, más los datos de su dueño: nombre, RUT, email real, teléfono y WhatsApp. Antes de crear ve una confirmación con todo lo ingresado.
- [ ] SC2 — Al crear quedan, en **una** transacción:
  - `empresas`, con los mismos campos y el mismo estado inicial que el alta por enlace (`pendiente_verificacion`).
  - `usuarios` del dueño, con email real, RUT, `firebase_uid` provisorio `pending-rut:<rut>` y `activacion_pin_hash`, **sin** `clave_numerica_hash`.
  - `membresias` rol `dueno` en `pendiente_invitacion`, con `invitado_por_id` igual al admin.
  - `carrier_memberships` tier `free`, si la empresa es transportista.

  Si algo falla, no queda ninguna fila.
- [ ] SC3 — La respuesta entrega al admin el **código de activación** del dueño y su vencimiento (7 días). El panel lo muestra una sola vez para copiar. El código se guarda solo hasheado, no se loguea y **no es una contraseña**.
- [ ] SC4 — El dueño entra a `/activar` con su RUT y el código, elige su clave de 6 dígitos y queda dentro de su empresa. Después entra por `POST /auth/login-rut` con RUT y su clave. Nadie más conoce esa clave: ni el admin ni Booster.
- [ ] SC5 — **Nunca se emite un código a una persona que ya existe en `usuarios`.** Si el RUT o el email del dueño ya están registrados, el alta se rechaza con un mensaje explícito para el admin y no se crea nada. El endpoint es solo de platform-admin, así que el mensaje explícito no expone datos a terceros.
- [ ] SC6 — El admin puede **generar un código nuevo** para un dueño que todavía no activó (código vencido o perdido). El anterior deja de servir y el plazo de 7 días corre desde la re-emisión. Si el dueño ya activó, la re-emisión se rechaza.
- [ ] SC7 — RUT de empresa ya registrado → rechazo explícito. Plan inexistente o inactivo → rechazo. Empresa que no es generadora ni transportista → rechazo (misma regla del alta por enlace).
- [ ] SC8 — Solo platform-admin (`BOOSTER_PLATFORM_ADMIN_EMAILS`). Cualquier otro usuario recibe 403, y una sesión de impersonación no puede crear (guard de escritura). Las rutas nuevas quedan clasificadas en el harness default-deny (ADR-057).
- [ ] SC9 — El alta por enlace (`/solicitar-acceso` → aprobación → `/onboarding-admin`) sigue igual: sus tests existentes pasan sin cambios.
- [ ] SC10 — El endpoint nuevo tiene span OTel y métrica de negocio, y deja un evento estructurado de auditoría (qué admin creó qué empresa y cuándo, nunca el código).

## 4. User-visible behaviour

**Admin, en `/app/platform-admin`.** Una sección nueva, «Crear empresa», junto a «Solicitudes de registro»:

1. El admin completa un formulario en una sola pantalla.
2. Ve una confirmación con todos los datos.
3. Al crear aparece un panel con el código de activación del dueño, su vencimiento y el texto para entregarle: «Entra a `app.boosterchile.com/activar` con tu RUT y este código; ahí eliges tu clave». El panel avisa que el código no se vuelve a mostrar.

La empresa aparece en «Activar empresa» como «Pendiente de verificación», igual que las que llegan por enlace. Mientras el dueño no active, esa fila ofrece «Generar código nuevo».

**Dueño.** Recibe el código por el canal que use el admin. Entra a `/activar`, ingresa su RUT y el código, y escribe su clave dos veces. Queda en `/app`, dentro de su empresa. Si la empresa es transportista, acepta los T&C v2 en el banner de la app (ADR-031), igual que quien llega por enlace. El admin no los acepta por él.

**Cliente que prefiere cargar sus datos.** Sigue con el alta por enlace. Las dos vías conviven y el admin elige cuál usar.

## 5. Out of scope

- Reabrir el autoservicio: `EMPRESA_SELF_ONBOARDING_ENABLED` sigue OFF para siempre (SEC-001).
- Enviar el código por correo o WhatsApp (Fase 2 del programa madre). El admin lo entrega por su canal, como hoy entrega el enlace.
- Corregir datos legales de una empresa ya creada (razón social, RUT, dirección). Hoy no existe endpoint para eso en ninguna vía de alta, y sigue igual. La mitigación de esta spec es la confirmación antes de crear.
- Que una persona con cuenta existente sea dueña de una segunda empresa (multi-empresa). SC5 lo rechaza; ver OQ2.
- Empresas de prueba (`es_usuario_prueba`) y su exclusión de reportes y cobros: siguen en Congelados.
- **Stakeholders.** Crear la organización ya funciona desde el panel (ADR-034). Que sus miembros entren tiene cuatro bloqueos que exceden esta spec, verificados en el código el 2026-09-23:
  1. `POST /admin/stakeholder-orgs/:id/invitar` crea el usuario provisorio sin código de activación. El invitado no tiene cómo entrar: `login-rut` le pide un «método anterior» que no tiene.
  2. `/app/stakeholder/zonas` muestra cifras inventadas (`ZONAS_DEMO`, con banner «Datos demo»). Un stakeholder real vería números falsos (followup `.specs/_followups/stakeholder-cards-datos-reales-d11-v2.md`).
  3. ADR-034 fija que el backend filtre por `region_ambito` y `sector_ambito` de la organización. El endpoint de agregaciones no los usa: cualquier stakeholder vería cualquier zona.
  4. El modelo de consentimiento para zonas es una decisión de producto y legal abierta (followup `.specs/_followups/stakeholder-zonas-consent-scope-y-audit.md`).

  Medido en producción el 2026-09-23: 0 organizaciones stakeholder y 0 miembros, así que hoy no hay nadie afectado. Se propone como frente propio (OQ4).

## 6. Constraints

1. **SEC-001 intacto.** La admisión sigue gateada por admin; con esta spec, además, la ejecuta el admin. El autoservicio sigue cerrado y el endpoint no abre superficie pública.
2. **Principio de identidad** (`alta-cliente-autocontenida` §6.5, decisión del PO del 2026-07-30): el email real es el canal con la persona y la credencial es propia. El admin tipea datos, nunca la clave, y no la conoce. El código prueba identidad una vez y jamás queda como contraseña.
3. **Nunca se emite código a una persona que ya existe** (SC5 y SC6). Un código solo sirve para que una persona sin cuenta defina su primera clave.
4. **Prerrequisito.** Un ajuste pendiente del flujo de activación de cuentas, que se lleva aparte desde el 2026-09-23, debe llegar a `main` antes que esta spec.
5. **ADR-035**: la credencial es RUT + clave numérica de 6 dígitos.
6. **Reuso, no invención.** Se reusan tal cual:
   - `generateActivationPin` y `hashActivationPin`.
   - `POST /auth/activar` y la pantalla `/activar`.
   - `rutSchema`, que valida el dígito verificador.
   - La creación de empresa de `onboardEmpresa`.

   La empresa creada por el admin queda igual a la creada por enlace. Solo cambian el estado inicial de la membresía del dueño (`pendiente_invitacion`), su `invitado_por_id` y que el usuario nace sin clave. La lógica común se extrae a un solo lugar, no se duplica.
7. **Kill-switch.** El endpoint queda detrás de `ADMIN_PROVISIONED_ONBOARDING_ENABLED`, hoy ON en producción (revisión `booster-ai-api-00624-xid`, verificado el 2026-09-23). Apagarlo corta las dos vías de alta a la vez. No se agrega un flag nuevo porque el endpoint no abre superficie pública.
8. **Sin migración.** Todas las columnas y estados existen: `activacion_pin_hash`, `invitado_en`, `invitado_por_id`, `pendiente_invitacion` y `pendiente_verificacion`.
9. **Contratos públicos** (los aprueba el PO al aceptar esta spec):
   - Nuevo: `POST /admin/empresas`.
   - Nuevo: `POST /admin/empresas/:id/dueno/codigo`.
   - Cambio aditivo: `GET /admin/empresas` agrega `dueno_pendiente`.
   - Cambio de texto en `/activar`: la ayuda del código deja de decir solo «que te dio tu empresa».
10. **Stack Booster.** Zod en el boundary (schema en `packages/shared-schemas`), cero `any` y logger estructurado sin el código. Coverage ≥80 % en código nuevo y naming bilingüe. TDD con el rojo exhibido, porque auth es dominio crítico.

## 7. Approach

**`POST /admin/empresas`.** Va en `admin-empresa-miembros.ts`, que ya monta `/admin/empresas` con auth, userContext y guard de impersonación.

El body se valida con `crearEmpresaDesdeAdminSchema`. Tiene los mismos bloques `empresa` y `plan_slug` de `empresaOnboardingInputSchema`, y un bloque `dueno` con `full_name`, `rut`, `email`, `phone` y `whatsapp_e164`, sin `clave_numerica`. Aplica la misma regla de generador o transportista.

En una transacción:

1. Gate de platform-admin y del flag. Con el flag OFF responde 403 `onboarding_disabled`, como `/empresas/onboarding-admin`.
2. Verifica que el RUT de la empresa esté libre y que el RUT y el email del dueño no existan en `usuarios`. Si alguno está tomado, responde 409 con un código distinto para cada caso: `empresa_rut_registrado`, `persona_rut_registrado` o `persona_email_registrado`.
3. Resuelve el plan. Si no existe o no está activo, responde 400 `invalid_plan`.
4. Inserta:
   - `usuarios`: provisorio, con email real, `activacion_pin_hash` y `estado='pendiente_verificacion'`.
   - `empresas`: igual que el alta por enlace.
   - `membresias`: `dueno`, `pendiente_invitacion`, `invitado_por_id` y `invitado_en=now()`.
   - `carrier_memberships` free, si es transportista.
5. Responde 201 con los ids, el código en claro (única vez) y `expira_en`.

Al crear no se crea cuenta Firebase. La crea `/auth/activar` cuando el dueño activa, así que un código que vence no deja cuentas huérfanas que el reaper deba perseguir.

**`POST /admin/empresas/:id/dueno/codigo`.** Procede si el dueño de esa empresa tiene la membresía en `pendiente_invitacion` y nunca activó (sin clave, uid provisorio). En ese caso genera un código nuevo, reemplaza el hash y reinicia `invitado_en`, que es desde donde `/auth/activar` cuenta los 7 días. Si el dueño ya activó, responde 409. La invitación original queda en el evento de auditoría.

**`POST /auth/activar`.** Esta spec no cambia su contrato. Con el prerrequisito aplicado (§6.4), activa la única membresía pendiente del dueño, crea su cuenta Firebase y le devuelve la sesión.

**Web, en `/app/platform-admin`.**

- Sección «Crear empresa»: formulario, confirmación y panel de código de una sola vez. El panel sigue el mismo patrón que el de enlaces en «Solicitudes de registro».
- En «Activar empresa», las filas con `dueno_pendiente` muestran «Generar código nuevo».
- En `/activar`, la ayuda del código cubre también el código que entrega Booster.

**Observabilidad.** El endpoint usa `withBusinessSpan` (`apps/api/src/observability/business-span.ts`) y una métrica de negocio con el conteo de empresas creadas desde el panel, por tipo. El evento de auditoría registra admin, empresa y tipo, nunca el código.

## 8. Enmienda al programa madre (§8, alternativa C)

El 2026-06-08, `onboarding-flow-redesign` §8 rechazó la captura de datos «C (admin tipea)» por *data-entry frágil*. Esta spec la reabre por decisión del PO del 2026-09-23. Estos son los cambios desde entonces:

1. **La credencial ya no depende de quién tipea.** En junio no había forma de que un tercero diera de alta a una persona sin fijarle él la contraseña; el flujo de conductores lo hacía así (`auth-driver.ts:151`). Desde #640 existe el código de un solo uso con `/activar`: el admin carga los datos y la persona define su clave.
2. **El riesgo de tipeo se acota.** `rutSchema` valida el dígito verificador y el formulario exige confirmar todos los datos antes de crear. Además, la empresa nace `pendiente_verificacion` y no opera hasta que el admin la activa. Corregir un dato legal ya creado sigue sin endpoint, igual que hoy en el alta por enlace (§5).
3. **No reemplaza al alta por enlace.** Las dos vías conviven: el admin elige entre crear él la empresa o enviar el enlace para que el cliente llene.

La alternativa B (extender el `signup-request` público) sigue rechazada por la misma razón (anti-enumeración). SEC-001 no se reabre: el autoservicio sigue cerrado y el endpoint nuevo es solo de platform-admin.

## 9. Riesgos

| Riesgo | Mitigación |
|---|---|
| Un código interceptado permite activar la cuenta del dueño antes que él | Un solo uso, 7 días y rate limit fail-closed en `/auth/activar`. Es el mismo riesgo aceptado en `equipo-de-la-empresa`. Si el dueño no puede entrar, el admin re-emite y el código anterior deja de servir |
| Error de tipeo en datos legales | Dígito verificador, confirmación previa y estado `pendiente_verificacion` |
| El dueño nunca activa y la empresa queda creada | Queda `pendiente_verificacion` y sin operar. El admin ve la fila pendiente y re-emite |
| Un tercero ingresa los datos personales del dueño (Ley 19.628) | Los entrega el cliente para contratar y el panel registra quién los cargó. Ver OQ3 |

## 10. Test list

- T1 — `POST /admin/empresas` crea las filas de SC2 en una transacción (unit + integración contra PG real).
- T2 — La respuesta trae el código y `expira_en`. La BD guarda solo el hash y el log no contiene el código.
- T3 — Sin sesión → 401. Usuario no platform-admin → 403. Sesión de impersonación → bloqueada. Flag OFF → 403 `onboarding_disabled`.
- T4 — RUT de empresa registrado, RUT de persona existente (activada o provisoria) o email existente → 409 con su código. Plan inexistente → 400. Ni generador ni transportista → 400. En todos los casos, cero filas nuevas.
- T5 — Transportista → `carrier_memberships` free. Solo generador → sin `carrier_memberships`.
- T6 — **Cadena completa** (integración): el admin crea, luego `/auth/activar` con RUT + código + clave. Resultado: membresía `activa`, usuario `activo` y clave hasheada; `login-rut` entra con esa clave y el código ya no sirve.
- T7 — Re-emisión: el código nuevo funciona y el anterior no; el plazo corre desde la re-emisión; un dueño ya activado → 409.
- T8 — Web: validación de RUT y tipo, confirmación, código visible una sola vez y errores 409 legibles.
- T9 — El harness default-deny clasifica las rutas nuevas (CI).
- T10 — Alta por enlace sin regresión: las suites existentes siguen verdes.

## 11. Rollout

- Sin migración ni variable nueva.
- Orden:
  1. El ajuste pendiente del flujo de activación (§6.4).
  2. API y sus tests.
  3. Web.
  4. Deploy, que dispara el PO.
  5. Verificación en producción, que es el criterio de término del frente.
- Rollback: `ADMIN_PROVISIONED_ONBOARDING_ENABLED=false` corta la creación, y también el alta por enlace. Una empresa creada por error se suspende desde «Activar empresa». Borrar filas es una operación manual del PO; no se automatiza.

## 12. Open questions

- OQ1 — ¿La empresa creada por el admin nace `activa`? Propuesta: no. Nace `pendiente_verificacion` como la del enlace, y el admin la activa en el mismo panel. Así hay una sola regla de estado para las dos vías.
- OQ2 — ¿Puede una persona con cuenta existente ser dueña de otra empresa? Propuesta: fuera de esta spec, que la rechaza (SC5). Si aparece el caso, se resuelve con una spec propia en la que la persona acepta la nueva membresía desde su sesión, sin código.
- OQ3 — ¿Hace falta respaldo legal de que el cliente entregó sus datos? Propuesta: basta con la traza (`invitado_por_id` y el evento de auditoría). Hoy ninguna vía de alta pide aceptar términos a un generador de carga; solo los transportistas aceptan los T&C v2 en la app. Esta spec no cambia eso. Validar con asesoría legal si el PO lo estima necesario.
- OQ4 — ¿Se abre Stakeholders como frente propio después de este, con los cuatro bloqueos de §5 como alcance?

## 13. Decision log

- 2026-09-23 — En sesión, el PO elige que el admin cree la empresa sin formulario del cliente. Se reabre la alternativa C del programa madre (§8 de esta spec).
- 2026-09-23 — Durante el diseño aparece un ajuste pendiente en el flujo de activación de cuentas. Se lleva aparte y queda como prerrequisito (§6.4).
- 2026-09-23 — Stakeholders queda fuera de esta spec por los cuatro bloqueos verificados (§5). Crear la organización ya funciona.
