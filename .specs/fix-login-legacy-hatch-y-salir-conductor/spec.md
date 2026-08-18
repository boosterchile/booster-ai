# fix(web): `?legacy=1` vuelve a forzar el login con correo · el conductor puede cerrar sesión

**Estado**: aceptada · **Fecha**: 2026-08-16 · **Rama**: `fix/login-legacy-hatch-y-salir-conductor` · **App**: `apps/web`

## Problema (verificado en prod el 2026-08-16)

### 1. El escape hatch `?legacy=1` del login no funciona
`apps/web/src/routes/login.tsx:52-61` decide el flujo con `search.legacy !== '1'`. TanStack Router
parsea los search params con semántica JSON, así que `?legacy=1` llega como el **número `1`**, la
comparación con el string `'1'` falla y la ruta cae siempre al flujo universal (RUT + clave).
`/login?legacy=%221%22` (string JSON) sí muestra el formulario legacy — es la prueba del diagnóstico.

Impacto real: la pantalla `needs-rotation` de `LoginUniversal.tsx:523-528` ("Usar método anterior")
enlaza a `/login?legacy=1` → el usuario sin clave numérica vuelve a la misma pantalla RUT + clave.
Callejón sin salida para dueños legacy (Google / correo) — hoy hay 4 de 9 dueños sin clave en prod.

### 2. El conductor no puede cerrar sesión
`Sidebar.tsx:110-121` tiene "Salir" para el shell del operador; el shell del conductor
(`conductor.tsx`, `conductor-configuracion.tsx`) no ofrece ninguna forma de cerrar sesión ni de
cambiar de cuenta.

## Criterio de éxito

1. `LoginRoute` con flag `auth_universal_v1_activated=true` y `search.legacy` = `1` (número), `'1'`
   (string) o `true` renderiza el formulario legacy (botón "Continuar con Google"); sin `legacy`
   sigue renderizando el flujo universal. Tests unitarios en `login.test.tsx`, **rojo exhibido**.
2. `/app/conductor/configuracion` muestra un botón "Salir" que llama a `signOutUser()`
   (`hooks/use-auth.ts`); `ProtectedRoute` ya redirige a `/login` cuando no hay usuario. Test en
   `conductor-configuracion.test.tsx`, **rojo exhibido**.
3. Suite `apps/web` verde, `typecheck` y `biome` verdes.

## Fuera de alcance (deliberado)

- **No** se reintroduce el enlace "Entrar con correo / método anterior" en el selector de tipo de
  usuario de `LoginUniversal`: se retiró por decisión del PO (D6, 2026-07-08, spec
  `ws2-descubribilidad-login`) porque el flujo legacy se retira antes de comercializar. Ese cimiento
  no se reabre desde código; solo se actualiza el comentario que decía "ese toggle está roto".
- Rediseñar el header del conductor. "Salir" va al final de Configuración (donde el conductor ya
  gestiona su dispositivo), no en el panel de servicios, para no competir con los botones de operación.
