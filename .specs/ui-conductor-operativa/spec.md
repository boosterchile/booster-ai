# UI del conductor — auditoría y puesta en operación

**Estado**: aceptada · **Fecha**: 2026-08-02 · **Pedido por**: PO (Felipe Vicencio)

> «Analizar lo desarrollado hasta el momento sobre la UI del conductor, auditar
> lo encontrado, mejorar y dejarla operativa.»

## 1. Contexto

El conductor es el único usuario de Booster que trabaja **en la ruta, desde un
celular y con una mano**. Su superficie son tres pantallas:

| Ruta | Archivo | Qué hace |
|---|---|---|
| `/login/conductor` | `apps/web/src/routes/login-conductor.tsx` | Canjea el PIN que le dio su empresa y crea su credencial |
| `/app/conductor` | `apps/web/src/routes/conductor.tsx` | Lista sus servicios, reporta GPS, cierra la entrega |
| `/app/conductor/configuracion` | `apps/web/src/routes/conductor-configuracion.tsx` | Permisos, voz, autoplay |

Estas pantallas se escribieron **antes** que la Fase B de
[`equipo-de-la-empresa`](../equipo-de-la-empresa/spec.md) (#641), que cambió el
contrato de identidad del conductor. La auditoría arranca de ahí.

## 2. Entradas

- Código vivo de las tres rutas y sus tests.
- Contrato de identidad vigente: ADR-035 (RUT + clave numérica de 6 dígitos) y
  la Fase B de `equipo-de-la-empresa`.
- API real corriendo local (Postgres + emulador Firebase) para medir, no
  suponer, el comportamiento de cada endpoint que la UI llama.

## 3. Criterios de salida

Una pantalla está **operativa** cuando:

1. **Ningún camino ejecuta un contrato muerto.** Cada request que la UI emite
   corresponde a un endpoint que existe y acepta ese body.
2. **Ningún botón es inalcanzable para quien lo ve.** Si el rol del conductor
   no puede completar la acción, o no está el botón, o el mensaje dice qué
   falta y quién lo resuelve.
3. **Ningún texto afirma algo falso** sobre lo que la app hace — en especial
   sobre el micrófono y la ubicación.
4. **Los errores hablan en el idioma del conductor** y distinguen "se cayó la
   señal" de "el backend te dijo que no".
5. Evidencia fresca: tests + typecheck + lint + e2e contra el API real.

## 4. Hallazgos

Ordenados por impacto. `A` = auditado y correcto, no requiere cambio.

### P0 — la pantalla de activación no podía funcionar

`login-conductor.tsx` implementaba el contrato **anterior** a la Fase B:

- Autenticaba con `signInWithEmail(synthetic_email, pin)`, es decir, usaba el
  **PIN como contraseña de Firebase**. La Fase B eliminó esa contraseña —el PIN
  lo conoce la empresa que lo emitió, así que no puede ser credencial— de modo
  que esa rama fallaba siempre.
- Peor: la Fase B dejó de pisar el email, así que ese `synthetic_email` pasó a
  ser el **correo real de la persona**. La UI terminaba mandando el correo real
  del conductor junto al PIN de su jefe.
- La activación no le pedía al conductor **ninguna credencial propia**. Salía
  de la pantalla sin `clave_numerica_hash`, que es lo que verifica
  `login-rut`; si cerraba la app, quedaba bloqueado.

Esto último es exactamente lo que el PO fijó como principio:

> «si bien se crea un pin al conductor, este debe tener asociado un mail que
> permita la comunicación con la plataforma y él debe configurar su propio pin»

**Decisión**: la activación pide RUT + PIN + **clave elegida por el conductor**
(con confirmación que se valida en el cliente y no viaja). Un conductor ya
activado (410) **no se autentica en esta pantalla**: se lo manda al login
principal, que es donde vive su credencial. `POST /auth/driver-activate` pasa a
exigir `clave_numerica` y la persiste.

### P1 — el botón de cierre no decía la verdad

`PATCH /assignments/:id/confirmar-entrega` responde **409 `documento_requerido`**
mientras el viaje no tenga guía o factura subida (`REQUIRE_DOCUMENT_TO_CLOSE`
default `true` en `config.ts`, ADR-070). El conductor **no puede subirla**:
`requireWriteRole` exige `dueno|admin|despachador`.

La UI mostraba «Revisa tu señal e intenta de nuevo» — culpando a la conexión de
un bloqueo de negocio que el conductor no puede resolver ni entender.

**Decisión**: mantener el botón (con documento subido el cierre da 200 — el
flujo normal funciona) y traducir cada código a una frase accionable. Culpar a
la señal queda reservado para cuando el request efectivamente no llegó.

### P1 — la app afirmaba estar escuchando

El wake-word "Oye Booster" es un **stub declarado** (`services/wake-word.ts`,
Wave 5 PR 1): no abre el micrófono. Aun así:

- el banner del dashboard decía «Escuchando "Oye Booster"» con un ícono
  `animate-pulse`;
- la card de configuración afirmaba en presente «Solo escuchamos la frase…» y
  «El micrófono se pausa cuando el vehículo se mueve» — y estos dos textos se
  renderizan **con el flag apagado**, que es lo que está en prod hoy.

Una interfaz que le miente a alguien sobre si su micrófono está abierto es un
problema de privacidad, no de copy.

**Decisión**: todo el bloque pasa a futuro y declara explícitamente que hoy el
micrófono solo se abre cuando el conductor toca el botón.

### P1 — sin forma de actualizar, y errores en idioma de máquina

El dashboard cargaba los servicios una sola vez, sin refresh: un conductor que
recibe un servicio con la pantalla abierta tenía que saber recargar la app. Y
los errores se mostraban como `Error 500: …`.

**Decisión**: botón «Actualizar» en los tres estados (con datos, vacío, error) y
mensajes en lenguaje del conductor.

### P1 — el conductor caía en la pantalla de su jefe

La tarjeta enlazaba a `/app/asignaciones/:id`, superficie del **transportista**.
Medido contra el API: el conductor **sí pasa** el gate de esa pantalla (su
empresa es transportista, y `requireCarrierAuth` no mira el rol) — o sea que no
recibía un 403 limpio, sino que veía herramientas de su jefe cuyas acciones
después sí le respondían `forbidden_role`.

**Decisión**: reemplazar por las dos acciones que sí son suyas — navegar al
destino y confirmar la entrega.

### P2 — accesibilidad y legibilidad

- El aviso permanente de WhatsApp era `role="alert"`: se anunciaba en cada
  montaje y entrenaba al conductor a ignorar las alertas reales. → `role="note"`.
- Los errores no eran anunciados (`role="alert"` + `aria-live` faltantes).
- `login-conductor` no tenía landmark `<main>`.
- Datos operacionales en `text-xs` / `text-[11px]` (11-12 px) para leerse a
  contraluz en una cabina. → `text-sm` en 10 lugares.
- El `catch` de permisos de geolocalización se tragaba el fallo y dejaba el
  botón de GPS deshabilitado sin explicación.

### P2 — voseo rioplatense en copy chileno

`login-conductor`, `activar` y `equipo` decían «Revisalas y volvé», «Ya podés»,
«No tenés permiso» — contra la convención documentada en el propio
`conductor.tsx` («tu/tienes/aquí, no vos/tenés/acá»).

### A — verificado y correcto, sin cambios

- `GET /me/assignments` no exige `activeMembership`: un conductor multiempresa
  ve todos sus servicios. Correcto.
- `POST /:id/driver-position` autoriza por `assignment.driverUserId`, no por
  rol. Es el patrón correcto para una acción de conductor, y el body que arma
  `geoPositionToBody` coincide con el schema.
- `driver-activate` usa `clave_numerica` y `login-rut` usa `clave`: no es
  inconsistencia. La convención del repo es `clave_numerica` para **fijar** una
  clave (`activarCuentaSchema`, onboarding) y `clave` para **verificarla**.

## 5. Fuera de alcance (declarado, no silenciado)

- **`apps/web` no tiene `connectAuthEmulator`.** El paso final de la activación
  (`signInDriverWithCustomToken`) pega al Firebase real, así que el flujo
  completo no se puede caminar en un navegador local. Se verificó todo el
  camino hasta ese punto (el API responde 200) y el resto por tests. Cablear el
  emulador es un cambio de configuración compartida: va en su propio frente.
- **El estado `recogido` de una asignación no lo escribe ningún endpoint.** La
  máquina `asignado → recogido → entregado` tiene el paso del medio muerto en
  todo el repo, no solo en la UI del conductor. Se reporta; no se arregla acá.
- **Ninguna asignación en prod tiene `conductor_id`.** El dashboard mostrará
  vacío hasta que un despachador use "asignar conductor". Es dato para el PO,
  no un defecto de esta UI.

## 6. Criterios de aceptación

- [x] La activación exige y persiste una clave elegida por el conductor.
- [x] El email real sobrevive la activación (no lo pisa el sintético).
- [x] El PIN no sirve como password de Firebase ni como clave en `login-rut`.
- [x] Un conductor ya activado llega al login principal desde la pantalla de
      activación.
- [x] `documento_requerido` produce un mensaje que nombra el bloqueo y a quién
      pedírselo; solo un fallo de red culpa a la señal.
- [x] Ningún texto afirma que el micrófono esté en uso mientras sea stub.
- [x] Refresh disponible en los tres estados del dashboard.
- [x] Cero `role="alert"` en avisos permanentes; errores anunciados.
- [x] Evidencia fresca en `verify.md`.
