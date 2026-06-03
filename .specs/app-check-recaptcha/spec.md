# Spec — Firebase App Check con reCAPTCHA v3 (apps/web)

**Feature slug**: `app-check-recaptcha`
**Fase**: DEFINE
**Rama**: `feat/app-check`
**Fecha**: 2026-06-03
**Autor**: Claude (agente) + Felipe Vicencio (PO)

## 1. Objetivo

Integrar Firebase App Check con `ReCaptchaV3Provider` en la PWA web (`apps/web`) para
que los backends Firebase (Auth, Firestore, Storage, etc.) puedan exigir attestation
de que las requests vienen de la app legítima y no de un cliente automatizado/abusivo.

## 2. Por qué ahora

Verificación empírica vía `gcloud services api-keys describe` (2026-06-03) mostró que la
Firebase web key (`2bcd204b`) **no tiene restricción a nivel de API key** (`browserKeyRestrictions: {}`).
Su única protección posible es la capa Firebase (App Check + Security Rules). App Check
es el control que falta en el código cliente. Sin esta integración, la key pública no
está demostrablemente protegida contra abuso automatizado.

## 3. Criterios de éxito

- [ ] App Check se inicializa con `initializeAppCheck` + `ReCaptchaV3Provider` + `isTokenAutoRefresh: true`.
- [ ] La inicialización ocurre **inmediatamente después de `initializeApp` y antes de `getAuth`** (cualquier otro servicio Firebase).
- [ ] La site key se lee de una env var pública Vite: `VITE_RECAPTCHA_SITE_KEY`, validada por Zod en `env.ts`.
- [ ] `VITE_RECAPTCHA_SITE_KEY` está en `.env.example` con placeholder (nunca la key real versionada).
- [ ] El debug token (`self.FIREBASE_APPCHECK_DEBUG_TOKEN = true`) se activa **solo en desarrollo** (`import.meta.env.DEV`), nunca en prod (eliminado por tree-shaking en `vite build`).
- [ ] Comentario en código explica cómo registrar el debug token en Firebase Console.
- [ ] Tests existentes (`firebase.test.ts`) siguen pasando + nuevo test cubre App Check init y orden.
- [ ] Lint (Biome), typecheck y build pasan.

## 4. Comportamiento visible

- En producción: la app envía tokens App Check (reCAPTCHA v3, invisible) con cada request a backends Firebase. Sin cambio visible de UX.
- En desarrollo: la consola del navegador imprime un debug token la primera carga; el dev lo registra manualmente en Firebase Console.

## 5. Límites técnicos / fuera de alcance

- **NO** se toca la configuración de enforcement de App Check en la consola GCP/Firebase (lo hace el PO aparte).
- **NO** se modifica ninguna API key ni restricción en GCP.
- **NO** se integra App Check en otras apps (api, etc.) — solo `apps/web`.
- **NO** se hace push a `main`; se entrega rama + diff para revisión.

## 6. Decisiones de diseño (rubber-duck con escéptico)

### 6.1 ¿`VITE_RECAPTCHA_SITE_KEY` required u optional en el schema Zod?

- **Alternativa A (descartada): optional + init condicional** — mirroring del Maps key.
  Riesgo: un build de prod sin la var inicializaría App Check con provider inválido o lo
  saltaría silenciosamente → control de seguridad ausente sin aviso. Contradice la
  filosofía del propio `env.ts` ("mejor que la app no arranque que fallar en prod").
- **Alternativa B (elegida): required** — el build/boot falla fast si falta. App Check es
  un control de seguridad, no una feature opcional como los mapas. Coste: hay que agregar
  la var al stub de tests (`test/setup.ts`) y los devs deben definirla en `.env.local`.

### 6.2 ¿`self` vs `window` para el debug flag?

Firebase docs usan `self.FIREBASE_APPCHECK_DEBUG_TOKEN` (funciona en main thread y workers).
Se respeta `self` como pidió el PO. Tipado limpio vía `declare global { interface Window {...} }`
(en DOM lib `self: Window & typeof globalThis`), evitando `as unknown as` (prohibido por CLAUDE.md).

### 6.3 Garantía "nunca en prod"

`import.meta.env.DEV` es reemplazado estáticamente por `false` en `vite build`. El bloque
`if (import.meta.env.DEV) { ... }` queda como `if (false)` → dead code elimination. El flag
debug no existe en el bundle de producción.

## 7. Riesgos

- Si el dev no registra el debug token en consola, App Check rechazará sus requests locales
  (mitigado: comentario explícito en código + sección en este spec).
- Si enforcement se activa en consola antes de que esta integración esté desplegada, los
  clientes legítimos serían rechazados (mitigado: el PO controla enforcement por separado y
  lo activa después del deploy de este código).

## 8. Archivos afectados

| Archivo | Cambio |
|---|---|
| `apps/web/src/lib/env.ts` | + `VITE_RECAPTCHA_SITE_KEY` (required) al schema Zod |
| `apps/web/src/lib/firebase.ts` | + import `firebase/app-check`, init App Check entre `initializeApp` y `getAuth`, bloque debug DEV |
| `apps/web/.env.example` | + `VITE_RECAPTCHA_SITE_KEY=your-recaptcha-v3-site-key` |
| `apps/web/test/setup.ts` | + stub `VITE_RECAPTCHA_SITE_KEY` |
| `apps/web/src/lib/firebase.test.ts` | + mock `firebase/app-check` + tests de init, orden y invariante debug-token |
| `apps/web/Dockerfile` | **(post-review)** + `ARG`/`ENV VITE_RECAPTCHA_SITE_KEY` — la var es required, debe inyectarse a build-time |
| `cloudbuild.production.yaml` | **(post-review)** + `--build-arg` + substitution `_VITE_RECAPTCHA_SITE_KEY` — sin esto la PWA no bootea en prod (runtime throw de env.ts) |

## 9. Lista de tests

1. `initializeAppCheck` se llama 1 vez con `isTokenAutoRefreshEnabled: true` y un `ReCaptchaV3Provider`.
2. `ReCaptchaV3Provider` se construye con la site key de env.
3. App Check se inicializa **antes** que `getAuth` (orden vía `invocationCallOrder`).
4. **(post-review)** Invariante debug-token: con `import.meta.env.DEV=false` NO se setea `self.FIREBASE_APPCHECK_DEBUG_TOKEN`; con `DEV=true` SÍ.
5. (regresión) los 4 tests existentes de firebase.ts siguen pasando.
