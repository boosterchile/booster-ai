# Spec: email real del conductor

- Author: Felipe Vicencio (PO) + agente
- Date: 2026-10-19
- Status: Draft — pendiente de aceptación del PO
- Linked: `.specs/equipo-de-la-empresa/` (email de contacto y PIN de un solo uso), `.specs/e2e-conductor-activacion/` (`POST /auth/driver-activate`), ADR-035 (RUT + clave numérica)

## 1. Objective

Todo conductor se registra con un email real, único y validado. Si ya existe con el correo de relleno `pending-rut-<RUT>@boosterchile.invalid`, el dueño, admin o despachador de su empresa puede reemplazarlo desde el detalle y reenviar la invitación. Con ese correo el conductor recibe el PIN y crea su clave de 6 dígitos en el flujo que ya existe (`/login/conductor` → `POST /auth/driver-activate` → luego `POST /auth/login-rut`). No se inventa otro login.

## 2. Why now

En producción hay conductores pendientes de login cuyo único email es el de relleno. La ficha no tiene un campo para corregirlo, así que la plataforma no puede escribirles ni pueden activar la cuenta. El primer caso es Jaime Andres Cordero Castillo (RUT 19257949-K). El dato lo ingresa el PO desde la pantalla cuando esté publicada. Este cambio no lo escribe en producción.

## 3. Success criteria

- [x] SC1 — `POST /conductores` rechaza un alta sin email, con email inválido o con un correo `@boosterchile.invalid` / `pending-rut-…`. El email se guarda en minúsculas.
- [x] SC2 — `POST /conductores` responde 409 `email_already_registered` si ese email ya pertenece a otra persona. No crea fila.
- [x] SC3 — `POST /conductores/:id/email` lo pueden llamar solo `dueno`, `admin` o `despachador` de la empresa del conductor. Otro rol: 403. Otra empresa o id inexistente: 404. Conductor retirado: 410.
- [x] SC4 — Si el conductor sigue pendiente (`firebase_uid` `pending-rut:` y sin clave numérica), el endpoint guarda el email real, rota el PIN, responde el PIN una sola vez, manda el correo de activación que ya existe y deja una fila de auditoría.
- [x] SC5 — Si el conductor ya activó, el endpoint solo actualiza el email de contacto. No rota la clave, no cambia `firebase_uid` y no llama a Firebase Admin. El login RUT + clave sigue igual.
- [x] SC6 — Si Firebase Auth tiene un usuario creado con el email de relleno, se reutiliza ese uid y su email de Auth pasa al sintético `drivers+<rut>@boosterchile.invalid` que ya busca `driver-activate`. No se crea un segundo usuario. Si hay dos cuentas que ya iniciaron sesión, responde 409 `identidad_firebase_en_conflicto` y no escribe en la base.
- [x] SC7 — `POST /auth/login-rut`, al promover un `pending-rut:`, no pisa `usuarios.email`.
- [x] SC8 — La ficha `/app/conductores/:id` permite escribir el email real y, si está pendiente, reenviar la invitación. El alta `/app/conductores/nuevo` sigue exigiendo el email y muestra el error de duplicado.

## 4. Contrato

`usuarios.email` es el canal de contacto. La credencial sigue siendo RUT + clave de 6 dígitos. El email de Firebase del conductor pendiente queda en el sintético `drivers+…@boosterchile.invalid`; el correo real no se usa como password.

La auditoría es append-only en `auditoria_email_conductor` (migración aditiva). Guarda actor, emails anterior y nuevo, si se reenvió invitación y la acción de Firebase. No guarda el PIN.

El PIN en claro sale solo en la respuesta 200 y en el correo de activación ya existente. El log no lleva PIN ni email.

## 5. Fuera de alcance

No se carga el email de Jaime ni de ningún otro conductor en producción. No hay infra nueva, ni cambios de IAM, CI, Cloud Build ni `infrastructure/`. No se abre un flujo de login por email/password. No se modifica `POST /auth/driver-activate` ni `POST /auth/activar`.
