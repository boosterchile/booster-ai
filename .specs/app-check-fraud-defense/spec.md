# Spec — App Check con Fraud Defense (reCAPTCHA Enterprise)

**Estado:** aceptada por el PO en el chat el 2026-11-24 («Migrar ahora»).
**Origen:** preparación de staging ([ADR-083](../../docs/adr/083-staging-gemelo-y-extraccion-con-shadow.md)), paso «Firebase / Identity Platform» de `docs/runbooks/staging.md`.

## Problema

La web inicializa Firebase App Check con `ReCaptchaV3Provider`, el proveedor de reCAPTCHA clásico (`apps/web/src/lib/firebase.ts`). Google declaró obsoleto ese proveedor:

- La consola de Firebase muestra «reCAPTCHA Classic está obsoleto. Usa Google Cloud Fraud Defense en su lugar».
- En una app nueva ya no deja registrarlo: en el proyecto de staging, el campo de la clave secreta y el botón de guardar aparecen deshabilitados (visto el 2026-11-24).
- Prod lo sigue usando porque su app se registró antes: su configuración `recaptchaV3Config` tiene la clave secreta cargada y `recaptchaEnterpriseConfig` está vacía (leído por la API de App Check el 2026-11-24).

Consecuencias: staging no puede registrar App Check con el proveedor que la web sabe usar, y prod depende de un proveedor en retirada, sin fecha conocida.

## Objetivo

Que la web pueda atestiguar con Fraud Defense (reCAPTCHA Enterprise), eligiendo el proveedor por entorno en el momento del build, sin cambiar el comportamiento de prod hasta que el PO decida migrarlo.

## Entradas

- Variable de build nueva `VITE_APPCHECK_PROVIDER`, con dos valores: `recaptcha-v3` y `recaptcha-enterprise`.
- `VITE_RECAPTCHA_SITE_KEY`, que no cambia de nombre: es la clave del sitio del proveedor elegido.

## Salidas

- `apps/web/src/lib/env.ts` valida la variable. Ausente o vacía equivale a `recaptcha-v3`. Cualquier otro valor hace fallar el arranque, igual que el resto de la configuración.
- `apps/web/src/lib/firebase.ts` crea `ReCaptchaEnterpriseProvider` o `ReCaptchaV3Provider` según la variable. Todo lo demás (orden de inicialización, token de depuración, emulador, refresco automático) queda igual.
- `apps/web/Dockerfile` y `cloudbuild.production.yaml` pasan la variable al build. El valor por defecto en Cloud Build es `recaptcha-v3`: el build de prod no cambia.
- `.github/workflows/release-staging.yml` construye staging con `recaptcha-enterprise`.
- `docs/runbooks/staging.md` y `apps/web/.env.example` describen el proveedor nuevo.

## Criterios de éxito

- [x] Sin la variable, o con ella vacía, la web usa `ReCaptchaV3Provider` con la clave del sitio (comportamiento actual de prod).
- [x] Con `recaptcha-enterprise`, la web usa `ReCaptchaEnterpriseProvider` con la clave del sitio y no instancia el proveedor clásico.
- [x] Con un valor desconocido, la validación de configuración falla.
- [x] Rojo exhibido antes de la implementación (dominio de autenticación).
- [x] Tests, lint, typecheck y build de la web en verde.
- [x] En App Check de `booster-ai-stg-494222`, el proveedor Fraud Defense de la app «Booster PWA (staging)» quedó registrado con la clave del sitio el 2026-11-24 (este proveedor no pide clave secreta). Leído por la API: `recaptchaEnterpriseConfig` con la clave del sitio y vigencia de 1 hora, `recaptchaV3Config` vacío y ningún servicio con aplicación obligatoria. La misma clave está en `STAGING_VITE_RECAPTCHA_SITE_KEY`.

## Fuera de alcance

- **Migrar prod.** Requiere crear una clave de Fraud Defense para `app.boosterchile.com`, registrarla en App Check de prod junto al proveedor clásico, cambiar `_VITE_RECAPTCHA_SITE_KEY` y `_VITE_APPCHECK_PROVIDER` en `cloudbuild.production.yaml` y desplegar. Es una activación en prod: decisión y calendario del PO. Mientras tanto, staging y prod difieren en el proveedor de App Check; es una diferencia declarada respecto del gemelo de ADR-083.
- Activar la aplicación obligatoria de App Check en algún servicio.
- Declarar `recaptchaenterprise.googleapis.com` en Terraform. Hoy está habilitada en los dos proyectos fuera de Terraform.

## Sin verificar

- El intercambio real de tokens con Fraud Defense: solo se comprueba con la PWA de staging desplegada y el proveedor registrado.
- La fecha en que Google retira el proveedor clásico.
