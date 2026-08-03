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

### 3.4 El notificador de clientes deja de ser mudo

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
