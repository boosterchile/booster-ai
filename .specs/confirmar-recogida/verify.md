# Verificación — Confirmar recogida

Corrido el 2026-08-03 sobre el código final de la rama. Node 24.17.0, Postgres
17 local, emulador Firebase Auth, API en `localhost:8080`.

## 1. TDD — rojo exhibido

### El service no existía

```
$ vitest run src/services/confirmar-recogida-viaje.test.ts
Error: Cannot find module './confirmar-recogida-viaje.js'
 Tests  no tests
```

### La ruta no existía

```
$ vitest run test/unit/assignments-route.test.ts -t "confirmar-recogida"
  × sin userContext → 401
  × conductor asignado → 200 y el service lo recibe como conductor
  × despachador (no conductor) → llega como carrier con escritura
  × visualizador que no es el conductor → llega sin ningún privilegio
  × idempotente → 200 con already_picked_up
  × ya entregado → 409 invalid_status con el estado actual

AssertionError: expected 404 to be 401
AssertionError: expected 404 to be 200      ← las 6 en 404
 Tests  6 failed
```

### El botón no existía

```
$ vitest run src/routes/conductor.test.tsx -t "acciones del servicio"
  × con el servicio asignado ofrece confirmar la recogida
  × pide confirmación antes de marcar la recogida
  × recogida fallida → mensaje accionable…

TestingLibraryElementError: Unable to find role="button" and name `/Confirmar recogida/i`
 Tests  3 failed | 10 passed
```

## 2. Verde

```
$ vitest run   (apps/api)     Test Files 159 passed  ·  Tests 1937 passed
$ vitest run   (apps/web)     Test Files 130 passed  ·  Tests 1262 passed
$ pnpm --filter @booster-ai/api typecheck   → exit 0
$ pnpm --filter @booster-ai/web typecheck   → exit 0
$ biome check apps/web/src apps/api/src     → 478 files, 0 errores, 12 warnings
```

Los 12 warnings son preexistentes: verificado stasheando los cambios y
volviendo a correr biome sobre `bootstrap-platform-admin.ts` y
`calcular-distancia-real.test.ts`, que ya los tenían en `main`.

El service se probó con una DB falsa que **modela el CAS por estado**: un
`UPDATE ... WHERE estado='asignado'` cuyo estado ya cambió no devuelve fila,
igual que Postgres. Eso es lo que cubre el test de carrera concurrente.

Un detalle que costó un rojo intermedio: el fake DB leía `tabla._.name` a mano
y devolvía `undefined`, así que los asserts sobre qué tabla se actualizó
pasaban sin verificar nada. Se corrigió con `getTableName` de Drizzle.

## 3. E2E contra el API real

Cadena completa con conductor activado de verdad (RUT + PIN + su clave), más un
conductor **ajeno** para probar el rechazo:

```
  ✓ conductor activado (200)
  ✓ punto de partida: asignado/asignado, recogido_en NULL
  ✓ un conductor ajeno NO puede confirmar → 403
  ✓ el conductor asignado confirma → 200 {"ok":true,"already_picked_up":false,…}
  ✓ primera vez: already_picked_up=false
  ✓ asignaciones.estado = recogido
  ✓ recogido_en QUEDÓ ESCRITO
  ✓ viajes.estado = en_proceso
  ✓ 1 evento recogida_confirmada
  ✓ el evento registra QUIÉN confirmó
  ✓ payload.confirmed_via = conductor
  ✓ segundo toque → 200 already_picked_up=true
  ✓ el evento NO se duplicó (1)
  ✓ la pantalla de Servicios ve el estado recogido
  ✓ entrega desde recogido → 200
  ✓ cierre completo (entregado/entregado)
  ✓ recogida sobre entregado → 409

17 ok · 0 falla
```

Lo que importa de esta corrida:

- **Las dos capas quedaron escritas en la base**, no solo un 200. Si solo se
  moviera el assignment, el tracking del consignatario seguiría sin mostrar
  posición (`get-public-tracking` exige `asignado|en_proceso` en el VIAJE).
- **El ciclo `asignado → recogido → entregado` corre entero por primera vez.**
  Hasta hoy el paso del medio no lo escribía nadie en todo el repo.
- **La idempotencia no ensucia la auditoría**: dos toques, un solo evento.
- **La entrega sigue funcionando desde `recogido`**, y también seguiría desde
  `asignado` — no se forzó la secuencia.

## 4. Sin verificar

- La pantalla del conductor en un navegador con datos reales: `apps/web` no
  tiene `connectAuthEmulator`, misma limitación declarada en #642 y #643.
  Cubierto por los tests de la ruta y por el e2e de API.
- Nada tocó producción.
