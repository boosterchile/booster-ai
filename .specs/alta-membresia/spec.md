# Spec: alta-membresia

- Author: Felipe Vicencio (PO) + agente
- Date: 2026-09-27
- Status: Accepted — fase 1 (exención desde el panel). El PO ordenó «comienza el trabajo» sobre el modelo acordado en la misma fecha.
- Linked: ADR-052 (alta pública gateada), ADR-035 (RUT + clave de 6 dígitos), ADR-057 (Google no autoriza), ADR-079 (suscripción en UF por empresa o por camión), `.specs/alta-cliente-autocontenida/spec.md`

## 1. Objective

Que una empresa pueda empezar a existir en Booster por dos admisores que emiten **el mismo** enlace de un solo uso, y que la persona termine el alta eligiendo su RUT y su clave. Nadie más conoce esa clave. Gmail es un segundo ingreso, posterior, sobre una persona que ya existe.

## 2. Why now

El panel aprueba solicitudes que llegan por `/solicitar-acceso`, pero no puede abrir un alta si el cliente no pasó por ese formulario. La membresía de pago (ADR-079) va a ser el admisor automático; hasta que exista el cobro, la vía operable es la exención que el platform-admin dispara a mano (piloto, camión exento, factura por transferencia).

## 3. Success criteria

### Fase 1 — este corte

- [ ] SC1 — Un platform-admin envía `POST /admin/signup-requests/exencion` con correo, nombre y `admision: "exencion_admin"`, y recibe `onboarding_link` de un solo uso. La respuesta no incluye contraseña, clave ni `access_link`.
- [ ] SC2 — Quien no está en `BOOSTER_PLATFORM_ADMIN_EMAILS` recibe 403. Sin sesión, 401.
- [ ] SC3 — Con `SIGNUP_REQUEST_FLOW_ACTIVATED` apagado, o con el alta por token apagada o sin secreto, el endpoint responde 503 y no crea fila ni usuario Firebase.
- [ ] SC4 — Correo ya presente en `usuarios` → 409 `email_already_registered`. Solicitud ya `aprobado` → 409 `alta_ya_emitida`. Solicitud `pendiente_aprobacion` → 409 `solicitud_pendiente` (se aprueba desde la lista, no se duplica). Solo rechazadas, o ninguna → se crea y se aprueba.
- [ ] SC5 — `EMPRESA_SELF_ONBOARDING_ENABLED` permanece apagado. Este endpoint no crea `usuarios` ni `empresas`: eso lo hace el formulario `/onboarding-admin` que ya existe, y la empresa nace en `pendiente_verificacion`.
- [ ] SC6 — La pantalla `/app/platform-admin/signup-requests` muestra el formulario, emite el enlace y lo deja copiable en el mismo panel que el approve.

### Fase 2 — invitación desde el panel

- [ ] SC7 — `POST /admin/empresas/:id/miembros` exige RUT. Crea la persona con `firebase_uid` `pending-rut:<rut>` (o reusa el RUT existente), membresía `pendiente_invitacion`, y responde `codigo_activacion` de 6 dígitos. No llama a Firebase `createUser` ni devuelve `access_link`.
- [ ] SC8 — La persona activa con el flujo que ya existe: `POST /auth/activar` (RUT + código + clave propia) y después entra con RUT + clave.
- [ ] SC9 — La pantalla «Agregar persona a una empresa» muestra el código copiable, no un enlace de reset de contraseña.

### Fase 4 — la ficha legal desde el panel

SC5 sigue vigente para la exención: ese endpoint no inserta `empresas`. Esta fase es el alta de la ficha, sin persona y sin clave.

- [ ] SC10 — Un platform-admin envía `POST /admin/empresas` con razón social, RUT, contacto, dirección y al menos uno de `is_generador_carga` / `is_transportista`. La empresa nace en `pendiente_verificacion`. La respuesta no incluye usuario, contraseña ni código. `es_demo` queda en falso.
- [ ] SC11 — RUT de empresa ya usado → 409 `rut_already_registered`. Ningún rol marcado → 400. Sin sesión, 401. Fuera del allowlist, 403. Plan inexistente o inactivo → 400 `invalid_plan`.
- [ ] SC12 — Si `is_transportista` es verdadero, se crea `carrier_memberships` tier `free` en `activa` (mismo efecto que el onboarding). El plan por defecto es el slug `gratis`.
- [ ] SC13 — En `/app/platform-admin` el formulario «Crear empresa» deja elegir generador de carga, transportista o ambos. Las organizaciones stakeholder se siguen creando con el botón que ya existe («Crear organización»); no hay un segundo sistema.
- [ ] SC14 — `POST /admin/stakeholder-orgs/:id/invitar` deja a la persona en `pendiente_invitacion` y responde `codigo_activacion`. No crea usuario Firebase ni devuelve contraseña. La persona entra por `/activar` y después con RUT + clave. La pantalla muestra el código. Un botón crea la organización Corfo (tipo regulador, ámbito nacional) si todavía no existe.
- [ ] SC15 — La cuenta stakeholder ve las zonas agregadas y un mapa de las funcionalidades de Booster (cargas, flota, Teltonika, matching, huella, certificados). No abre las mesas de una empresa: esos datos siguen en el tenant.

Siguen fuera de este corte: el pago confirmado como admisor (`admision: "pago_confirmado"`) y la suspensión por impago. No hay medio de pago real que enganchar.

### Fase 3 — no entra en este corte

- Vincular Gmail a la persona ya dada de alta. Entrar con Google abre esa persona. Una cuenta Google sin fila sigue sin datos (ADR-057). Hace falta un ADR nuevo: ADR-035 fija el ingreso en RUT + clave.

## 4. User-visible behaviour

En Solicitudes de registro, arriba de la lista, el admin carga nombre y correo y pulsa «Emitir enlace de alta». Copia el enlace y se lo entrega. La persona completa empresa, RUT y clave de 6 dígitos, y entra. La empresa queda pendiente hasta que el admin la active con el control que ya existe.

En Operaciones de plataforma, «Crear empresa» da de alta la ficha legal sin esperar ese formulario. Un generador de carga es esa ficha con el rol de generador; un transportista, con el suyo. La persona se suma después, con el código de activación. Un stakeholder (regulador, gremio, ONG, observatorio, ESG) se crea en «Organizaciones stakeholder», que no es una empresa del marketplace.

## 5. Out of scope

- Checkout, webhook de pago, factura de suscripción nueva.
- Encender `EMPRESA_SELF_ONBOARDING_ENABLED`.
- Botón de Gmail en el login.
- Envío del código o del enlace por correo.

## 6. Constraints

1. SEC-001 intacto: el predicado de autorización del alta sigue siendo el token de un solo uso.
2. La credencial la elige la persona (RUT + clave). El admin no la escribe ni la recibe.
3. Zod en el body. Cero `any` nuevo. Log estructurado sin el token ni el correo en claro. Span `alta.exencion` y contador `alta_exencion_emitidas_total`.
4. Reuso de `approveSignupRequest` en modo admin-provisioned. Sin mecanismo nuevo de auth.
5. El alta de la ficha no enciende `EMPRESA_SELF_ONBOARDING_ENABLED` ni crea la credencial de la persona. Span `alta.crear_empresa` y contador `alta_empresa_admin_total`.
