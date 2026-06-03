# Follow-up — Activación de App Check enforcement (prod)

**Origen**: REVIEW de `app-check-recaptcha` (2026-06-03). El diff `feat/app-check` entrega
solo el **lado cliente** (emisión de tokens). App Check **no protege nada** hasta activar
enforcement por servicio en la consola Firebase. Residual sin tracking → este stub.

## Qué falta

Activar enforcement de App Check en Firebase Console para los servicios que usa el web app
(Auth/Identity Platform, Firestore, Storage, AI Logic si aplica). **Acción de consola del PO**,
fuera del repo.

## Secuencia obligatoria (orden importa — si se invierte → outage)

1. **Mergear + desplegar** `feat/app-check` a prod (el cliente debe estar emitiendo tokens).
2. **Dejar pasar tráfico real** y observar en App Check → APIs → Métricas que el **grueso
   aparezca como "verificado"** (no 0/0). Cubrir usuarios activos (horas/día).
3. **Recién entonces** activar enforcement. Activarlo con métricas en cero rechaza a TODOS
   los usuarios legítimos.

> Verificado empíricamente el 2026-06-03: las métricas estaban en 0/0 **porque el código aún
> no estaba desplegado** (vivía en rama sin merge). El reloj de observación arranca POST-deploy.

## Riesgos a mitigar

- Activar enforcement antes del deploy efectivo → caída de auth/datos para usuarios reales.
- Sin kill-switch en runtime: el init de App Check es incondicional; revertir requiere redeploy.
  Evaluar si vale un flag de runtime para desactivar sin redeploy.

## Estado

Pendiente. No bloquea el merge del cliente; bloquea la activación de enforcement.
