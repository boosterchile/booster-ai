# Verificación — El conductor puede entrar, y recibe correo

Corrido el 2026-08-03 sobre el código final de la rama. Node 24.17.0, Postgres
17 local, emulador Firebase Auth, API en `localhost:8080`.

## 1. El defecto, reproducido en PRODUCCIÓN antes de tocar nada

```
$ curl -X POST https://api.boosterchile.com/auth/login-rut \
    -d '{"rut":"5864136-7","clave":"000000"}'

{"error":"needs_rotation","code":"needs_rotation",
 "message":"Tu cuenta todavía no tiene una clave numérica. Inicia sesión una
            vez con tu método anterior para crearla."}
HTTP 410
```

Y el estado del conductor en la base de producción, que confirma que el alta
estuvo bien y el problema era el login:

```
rut       | email       | nombre         | tiene_clave | pin_pendiente | estado
5864136-7 | fvp@live.cl | Javier Poblete | f           | t             | pendiente_verificacion
                          Transportes Van Oosterwyk
```

## 2. TDD — rojo exhibido

```
$ vitest run test/unit/auth-universal.test.ts -t "needs_activation"
  × conductor sin activar → 410 needs_activation, NO needs_rotation
AssertionError: expected 'needs_rotation' to be 'needs_activation'

$ vitest run src/components/login/LoginUniversal.test.tsx -t "needs_activation"
  × 410 needs_activation → manda a activar con el PIN, NO al método anterior
TestingLibraryElementError: Unable to find [data-testid="needs-activation-go-activar"]

$ vitest run src/routes/login-conductor.test.tsx -t "llegada desde"
  × precarga el RUT que viene en la URL

$ vitest run src/services/notifications/email-sender.test.ts
Error: Cannot find module './email-sender.js'
```

## 3. Verde

```
$ vitest run  (apps/api)   Test Files 161 passed · Tests 1954 passed
$ vitest run  (apps/web)   Test Files 130 passed · Tests 1267 passed
$ pnpm --filter @booster-ai/api typecheck   → exit 0
$ pnpm --filter @booster-ai/web typecheck   → exit 0
$ biome check apps/web/src apps/api/src     → 482 files, 0 errores, 12 warnings
```

Los 12 warnings son preexistentes (verificado stasheando los cambios).

## 4. E2E contra el API real

```
  ✓ alta del conductor → 201
  ✓ el alta devolvió el PIN aunque no haya proveedor de correo
  ✓ login de conductor sin activar → 410
  ✓ code = needs_activation (fue "needs_activation")
  ✓ el mensaje habla del PIN
  ✓ el mensaje NO ofrece un método que nunca tuvo
    ("Tu cuenta todavía no está activada. Usa el PIN de 6 dígitos …")
  ✓ el legacy real sigue en needs_rotation
  ✓ activación con el PIN → 200
  ✓ ya activado, entra por /login → 200

9 ok · 0 falla
```

El penúltimo y el antepenúltimo son los que cuidan de no romper nada: **un
usuario legacy real conserva `needs_rotation`**, y la activación con PIN sigue
funcionando igual que antes.

## 5. El correo, verificado en el API corriendo

Aviso al arrancar sin credencial:

```
WARN  message: "RESEND_API_KEY ausente — los correos se registrarán en el log
                pero NO se enviarán"
```

Y el intento real durante un alta (`POST /conductores` → 201):

```
WARN
    rut: "[REDACTED:rut]"
    empresa: "Transportes Van Oosterwyk"
    motivo: "sin_proveedor"
    message: "correo de activación del conductor no salió — la empresa deberá
              entregar el PIN a mano"
INFO  method: "POST"  path: "/conductores"  status: 201
```

Tres cosas que esto demuestra a la vez:

1. **El alta NO se cae** por falta de proveedor: 201 con su PIN.
2. **La degradación no es silenciosa**: queda un `WARN` accionable que nombra a
   la empresa que debe entregar el PIN a mano.
3. **El PIN no se filtra.** Búsqueda sobre el log completo: 0 coincidencias del
   PIN emitido (`089847`) y **cero cadenas de 6 dígitos**. El RUT además sale
   redactado por el logger (`[REDACTED:rut]`).

## 6. Lo que NO se pudo verificar

- **Un correo saliendo de verdad.** Requiere `RESEND_API_KEY` y el dominio
  `boosterchile.com` verificado en Resend (registros DNS) — ambos son del PO.
  Hasta entonces el código queda correcto pero inerte, cayendo al logger. El
  camino HTTP contra Resend está cubierto por 9 tests unitarios que stubean
  `fetch` y verifican URL, bearer, payload, y los tres modos de fallo.
- La pantalla en un navegador con sesión real: `apps/web` no tiene
  `connectAuthEmulator` (limitación ya declarada en #642, #643 y #644).
- Nada tocó producción salvo dos lecturas: la consulta read-only a la base y el
  `curl` de reproducción del defecto.
