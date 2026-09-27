# Plan: alta-membresia — fase 1

## Corte

`POST /admin/signup-requests/exencion` + formulario en `/app/platform-admin/signup-requests`.

El path cuelga de `/admin/signup-requests/*`, que ya pasa por Firebase auth y user context. No se abre el path exacto `/admin/signup-requests` (ese mount no lleva el middleware `/*`).

## Decisiones de este corte

- `decidirAltaExencion` es pura y es la que se prueba en rojo.
- El servicio inserta la solicitud y llama a `approveSignupRequest` solo con el modo admin-provisioned. Si el flag o el secreto faltan, la ruta responde 503 antes de llamar al servicio.
- La respuesta arma `onboarding_link` con el mismo `buildOnboardingLink` del approve. No devuelve `access_link`.
- Sin migración. La admisión `exencion_admin` viaja en el body y en el span; la columna para distinguir `pago_confirmado` entra con la fase 2.

## Verificación

1. Rojo: `decidirAltaExencion` no existe → el test del servicio falla al importar.
2. Verde: unit del decisor + route del endpoint + test de la pantalla.
3. `biome check` sobre los archivos tocados, typecheck de `api` y `web`.

## Fase 4 — ficha legal

`POST /admin/empresas` en el router que ya monta `/admin/empresas`. Sin persona, sin clave, estado `pendiente_verificacion`. Plan slug `gratis`. Si es transportista, `carrier_memberships` tier `free`. El formulario vive en platform-admin. Stakeholders siguen en `POST /admin/stakeholder-orgs`.
