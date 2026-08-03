# El conductor puede entrar — fin del callejón sin salida, y correo real

**Estado**: aceptada · **Fecha**: 2026-08-03 · **Reportado por**: PO en producción

## 1. El incidente

El PO inscribió al conductor **Javier Poblete** (`5864136-7`, `fvp@live.cl`) en
Transportes Van Oosterwyk. El alta funcionó: la fila quedó correcta, con
`activacion_pin_hash` presente y `firebase_uid = 'pending-rut:5864136-7'`.

Javier entró a `app.boosterchile.com` y quedó atrapado en esta pantalla:

> **Configura tu clave numérica.** Tu cuenta todavía no tiene una clave
> numérica. Inicia sesión una vez con tu método anterior (Google o email +
> contraseña) para crearla.

**No tiene método anterior.** Nunca tuvo Google ni contraseña: tiene un PIN de
activación. La pantalla le pide algo que no existe y no ofrece salida.

Y nunca recibió correo alguno.

## 2. Causa raíz — dos defectos independientes

### 2.1 `login-rut` colapsa dos casos que no son el mismo

`POST /auth/login-rut` devuelve `410 needs_rotation` cuando
`clave_numerica_hash IS NULL`, **sin mirar por qué es null**. Son dos
poblaciones distintas:

| Caso | Marca en la fila | Qué necesita |
|---|---|---|
| Usuario **legacy** | `firebase_uid` real, sin `activacion_pin_hash` | Migrar: entrar con Google/contraseña y crear su clave |
| Conductor **sin activar** | `firebase_uid = 'pending-rut:<rut>'` + `activacion_pin_hash` presente | Activar en `/login/conductor` con su PIN |

Al segundo se le entrega el mensaje del primero. Reproducido contra producción:

```
$ curl -X POST https://api.boosterchile.com/auth/login-rut \
    -d '{"rut":"5864136-7","clave":"000000"}'
{"error":"needs_rotation","code":"needs_rotation",
 "message":"Tu cuenta todavía no tiene una clave numérica. Inicia sesión una
            vez con tu método anterior para crearla."}
HTTP 410
```

Lo irónico: el handler **sí sabe distinguirlos** —comprueba
`firebaseUid.startsWith('pending-rut:')`— pero recién en el paso 4, después de
verificar la clave. Un conductor sin activar jamás llega ahí.

### 2.2 La plataforma no envía correos. Ninguno.

`POST /conductores` no llama a ningún notificador. Y más allá de eso: **no
existe infraestructura de correo en todo el repo**. El
`LoggingSignupRequestNotifier` que atiende el alta de clientes escribe
structured logs y nada más — su propio docstring lo declara:

> «NO existe email infra integrada (no SendGrid / SES / nodemailer / etc en
> `apps/api`) … escribe structured logs en lugar de enviar email real.»

O sea que los correos de aprobación de clientes tampoco se enviaron nunca.

Esto contradice el principio que el PO fijó al diseñar el alta de conductores:

> «si bien se crea un pin al conductor, este debe tener asociado un mail que
> permita la comunicación con la plataforma»

Hoy el mail está asociado y mudo.

## 3. Salidas

### 3.1 `login-rut` distingue, y la UI acompaña

Nuevo código **`needs_activation`** (410) cuando el usuario tiene
`activacion_pin_hash` y un `firebase_uid` `pending-rut:`. Mensaje propio, que
habla del PIN y no de Google. La pantalla `/login` lo enruta a
`/login/conductor` en vez de ofrecer un método inexistente.

`needs_rotation` se conserva intacto para los legacy reales — no se toca su
flujo.

### 3.2 Primera infraestructura de correo: Resend

`ResendEmailSender` — cliente HTTP contra la API de Resend, detrás de una
interfaz `EmailSender` para que los call-sites no dependan del proveedor.

**Degradación explícita**: si `RESEND_API_KEY` está ausente, se usa
`LoggingEmailSender`, que registra el envío que *habría* ocurrido y sigue. Un
correo que no sale **nunca** puede voltear un alta de conductor: el PIN ya
quedó creado y la operación debe continuar. El fallo se registra, no se traga.

### 3.3 El alta de conductor manda el correo

`POST /conductores` envía a la dirección del conductor: quién lo dio de alta,
el enlace directo a `/login/conductor`, su RUT y **su PIN**.

Sobre incluir el PIN: ya se entrega en claro a la empresa en la respuesta de la
API, y el punto entero de este correo es que el conductor no dependa de que su
jefe se lo dicte por WhatsApp. Mandarlo a su propia casilla no aumenta la
exposición de forma significativa. Queda anotado como decisión consciente.

### 3.4 La activación tiene que ser ENCONTRABLE

Observación del PO al revisar el arreglo, y es la que ordena todo lo demás:

> «esta interfaz debe quedar en producción y debe ser visible de alguna forma
> … no puede estar aislada y que solo la obtenga a través del código»

`/login/conductor` ya existía en producción pero era inalcanzable desde el
flujo principal: el único enlace vivía en la pantalla **legacy**, y la otra vía
era **fallar un login primero**. Una pantalla a la que solo se llega sabiendo
la URL, o equivocándose, no existe.

Dos entradas nuevas, en los dos momentos donde alguien la necesita:

1. **En `/login`**, al elegir "Conductor": «¿Es tu primera vez? Tu empresa te
   dio un PIN de 6 dígitos. Activa tu cuenta acá». Sin tener que fallar nada.
2. **En la pantalla de alta**, un enlace **absoluto y copiable** con el RUT
   embebido, más un botón «Copiar enlace + PIN». Antes ahí decía
   `/login/conductor` como texto plano, sin dominio y sin ser clickeable:
   imposible de pegar en un WhatsApp. Mientras Resend no esté provisionado,
   esto es lo único que tiene la empresa para que su conductor llegue.

### 3.5 WhatsApp — el canal PRINCIPAL

Corrección del PO, y es la que más cambia el diseño:

> «los conductores muchas veces no usan correos electrónicos pero sí whatsapp»

Es cierto en la operación de carga chilena. Y a diferencia del correo, acá la
infraestructura **ya existe**: Twilio operativo y cuatro plantillas aprobadas y
montadas en producción (`content_sid_ready` en Terraform, las cuatro en `true`).

También corrijo un encuadre mío: dije «~7 días de Meta» a partir de un solo
caso, `safety_alert_v2` — una alerta de seguridad, contenido que va a revisión
humana. Una plantilla de código de activación cae en categoría *Authentication*
y suele aprobarse mucho más rápido. Presenté el peor caso como el esperado.

**Plantilla `activacion_conductor_v1`**, con 4 variables que son contrato con
el Content Editor:

```
{{1}} nombre · {{2}} empresa · {{3}} PIN
{{4}} RUT → sufijo del botón: /login/conductor?rut={{4}}
```

Entra **no montada** siguiendo el patrón de la casa: el secreto se crea como
placeholder y `content_sid_ready` no lo lista, así que el api no lo ve hasta
que el PO cargue el `HX...` aprobado. Montar un placeholder tumbaba el arranque
(INC-2026-06-19).

**El teléfono pasa a ser obligatorio en el alta** (decisión del PO): si WhatsApp
es el canal principal, un conductor sin número es inalcanzable. Medido en prod:
2 de 7 estaban así. Se valida con `chileanPhoneSchema` (E.164) y el modo
"agregarme a mí mismo" lo prellena desde el `me`, igual que el email.

Orden de envío: **WhatsApp primero**, correo después como respaldo para quien
sí lo usa. Ninguno de los dos puede voltear el alta.

### 3.6 El notificador de clientes deja de ser mudo

`SignupRequestNotifier` pasa a usar el mismo `EmailSender`. Dejar un stub que
el PO cree que envía es exactamente el tipo de hueco silencioso que este frente
viene a cerrar.

## 4. Dependencia externa — el PO debe provisionar

Sin esto, el código queda correcto pero **inerte** (cae al logger):

1. Cuenta en Resend y **verificación del dominio** `boosterchile.com` (registros
   DNS).
2. `RESEND_API_KEY` en Secret Manager.
3. Terraform que monte el secreto en Cloud Run — `infrastructure/` es
   territorio del PO.

## 5. Criterios de éxito

1. Un conductor sin activar que entra por `/login` recibe `needs_activation` y
   la UI lo lleva a `/login/conductor` con un mensaje que menciona su PIN.
2. Un usuario legacy sigue recibiendo `needs_rotation` — sin cambios.
3. El alta de conductor dispara un correo con el enlace de activación.
4. **Sin `RESEND_API_KEY`, el alta sigue devolviendo 201** y el correo se
   registra en el log, no revienta.
5. Un fallo de Resend no voltea el alta.
6. El PIN no aparece nunca en los logs.
7. Evidencia fresca: rojo exhibido, tests, typecheck, lint, e2e real.

## 6. Fuera de alcance

- **Reenviar el correo de activación** desde la UI de la empresa. Frente aparte.
- **Plantillas HTML ricas.** Texto plano + HTML mínimo; el conductor lo abre en
  el celular.
- **Migrar el resto de las notificaciones** (WhatsApp/SMS por Twilio) a este
  sender. Solo correo.
