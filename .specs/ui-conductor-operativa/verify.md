# Verificación — UI del conductor operativa

Corrido el 2026-08-02 sobre el código final de la rama. Node 24.17.0 (pin del
repo), Postgres 17 local, emulador Firebase Auth, API en `localhost:8080`, web
en `localhost:5173`.

## 1. TDD — rojo exhibido

### Cierre de entrega: el mensaje culpaba a la señal

```
$ vitest run src/routes/conductor.test.tsx -t "acciones del servicio"

 FAIL  > 409 documento_requerido → dice qué falta y quién lo resuelve
AssertionError: expected 'No pudimos confirmar la entrega. Revi…' to match /documento|guía|guia|factura/i
 FAIL  > 409 ted_no_decodificado → pide esperar, no reintentar a ciegas
AssertionError: expected 'No pudimos confirmar la entrega. Revi…' to match /procesando|minutos/i
 FAIL  > ya entregada (409 invalid_status) no queda como error del conductor
AssertionError: expected 'No pudimos confirmar la entrega. Revi…' to match /ya .*(entregad|cerrad)/i

+ Received (los 3):
"No pudimos confirmar la entrega. Revisa tu señal e intenta de nuevo."

 Tests  3 failed | 5 passed | 17 skipped (25)
```

### Wake-word: la app afirmaba estar escuchando

```
$ vitest run src/routes/conductor-configuracion.test.tsx -t "wake-word"

 × con el wake-word apagado no afirma que el micrófono esté escuchando
AssertionError: expected 'Activación por vozPróximamenteCuando …' not to match /Solo escuchamos/i
 × con el wake-word encendido explica la privacidad en futuro, no en presente
AssertionError: expected 'Activación por vozCuando está activo,…' not to match /esperando .Oye Booster./i

 Tests  2 failed | 15 skipped (17)
```

## 2. Verde tras los arreglos

```
$ vitest run   (apps/web)
 Test Files  129 passed (129)
      Tests  1245 passed (1245)

$ vitest run test/unit/auth-driver.test.ts   (apps/api)
 Test Files  1 passed (1)   ·   Tests  18 passed (18)

$ vitest run test/unit/conductores.test.ts test/unit/assignments-route.test.ts \
            test/unit/asignar-conductor-a-assignment.test.ts
 Test Files  3 passed (3)   ·   Tests  49 passed (49)
```

Las tres pantallas del conductor juntas: **50 tests**, incluyendo vitest-axe en
cada una.

## 3. Typecheck y lint

```
$ pnpm --filter @booster-ai/web typecheck   → tsc --noEmit, exit 0
$ pnpm --filter @booster-ai/api typecheck   → tsc --noEmit, exit 0
$ biome check apps/web/src apps/api/src     → Checked 472 files. 0 errores, 10 warnings (preexistentes)
```

## 4. E2E contra el API real

`POST /conductores` → `POST /auth/driver-activate` → `GET /me/assignments` →
`POST /:id/driver-position` → `PATCH /:id/confirmar-entrega` → `POST /auth/login-rut`,
con Postgres y emulador reales:

```
  ✓ alta conductor 201 (fue 201)
  ✓ PIN de 6 dígitos devuelto (414740)
  ✓ email real guardado en el alta (conductor.real@uicond.cl)
  ✓ activación 200 (fue 200)
  ✓ email real sobrevive la activación (conductor.real@uicond.cl)
  ✓ el email NO fue pisado por el sintético
  ✓ clave_numerica_hash escrito al activar
  ✓ el PIN NO autentica como password (MISSING_EMAIL)
  ✓ custom_token canjeable por sesión
  ✓ GET /me/assignments 200 (fue 200)
  ✓ el conductor ve su asignación (1)
  ✓ la tarjeta trae origen y destino para navegar
  ✓ driver-position con token de conductor → 200
  ✓ sin documento el cierre da 409 documento_requerido (la UI debe decirlo)
  ✓ confirmar-entrega CON documento → 200 {"ok":true,"already_delivered":false,…}
  ✓ login RUT + clave elegida → 200
  ✓ el PIN NO sirve como clave en el login (401)
  ✓ alta del conductor pendiente (201)

18 ok · 0 falla
```

Dos datos que el e2e midió y corrigieron supuestos:

- `GET /assignments/:id` con token de **conductor** responde **200**, no 403 —
  `requireCarrierAuth` no mira el rol. El conductor no rebotaba en esa pantalla:
  entraba y veía herramientas de su jefe. Lo que sí le responde `forbidden_role`
  son las acciones de adentro (`asignar-conductor`).
- El cierre de entrega da **409 sin documento y 200 con documento**. El botón no
  está roto: le faltaba decir la verdad sobre el bloqueo.

## 5. Navegador real (Chromium, viewport 390×844, `isMobile`)

`/login/conductor` contra el API local:

```
[1] título: Activa tu cuenta
[1] landmark <main>: 1
[1] scroll horizontal en 390px: false
[2] claves distintas → Las claves no coinciden. Revísalas e intenta de nuevo. | requests: 0 (debe ser 0)
[3] PIN incorrecto → Revisa tu RUT y el PIN. Si no lo tienes, pídeselo a tu empresa. | requests: 1
[4] ya activada → Tu cuenta ya está activada. Entra con tu RUT y tu clave numérica.Ir a iniciar sesión
[4] link al login: /login
[5] activación con PIN correcto → 200 del API: true
```

Los cuatro estados quedaron en captura (`cond-1` … `cond-4`).

**Límite declarado**: el último paso de la activación
(`signInDriverWithCustomToken`) pega al Firebase real — `apps/web` no tiene
`connectAuthEmulator`, así que ese salto no se puede caminar en un navegador
local. Se verificó que el API responde 200 (paso 5) y el resto por tests. Ver
§5 del spec.

## 6. Sin verificar

- El dashboard `/app/conductor` en navegador: requiere sesión Firebase, mismo
  límite de arriba. Cubierto por 25 tests unitarios más el e2e de API, que
  ejercita todos los endpoints que la pantalla llama.
- Nada tocó producción.
