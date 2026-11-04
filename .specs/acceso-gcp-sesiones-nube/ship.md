# Ship: acceso-gcp-sesiones-nube

- Spec: .specs/acceso-gcp-sesiones-nube/spec.md · ADR-086 · PR #833 (`40be33e`)
- Fecha: 2026-10-23. Apply y llave por el PO desde su Mac (`dev@boosterchile.com`); verificación desde la sesión en la nube `session_01YL2ptdy12WopnhKKgyXat7`.

## Lista de verificación

- [x] Plan acotado del runbook §4 sobre un worktree limpio de `main`: `Plan: 5 to add, 0 to change, 0 to destroy`.
- [x] `terraform apply sa.plan`: `Apply complete! Resources: 5 added, 0 changed, 0 destroyed` (política `allow_sa_keys`, SA `claude-cloud-readonly`, 3 bindings).
- [x] `roles/billing.viewer` sobre `019461-C73CDE-DCE377`: `Updated IAM policy for account`.
- [x] Llave creada: `edbb8d6a7ee480e3a4f07e3a5a6ddd1e6d4c85e0`. El primer intento, segundos después del apply, falló con `FAILED_PRECONDITION` por propagación de la org policy; unos minutos después `gcloud org-policies describe … --effective` mostró `enforce: false` y la llave se creó.
- [x] Llave cargada como Network secret del entorno Default (tipo «GCP access token (with Service Account Key)», hosts `*.googleapis.com`) y archivo local borrado.

## Criterios de éxito

| SC | Evidencia (2026-10-23, sesión en la nube) |
|---|---|
| SC-1 | Plan de 5 recursos, nada que cambiar ni destruir (arriba). |
| SC-2 | `keys create` funcionó para `claude-cloud-readonly` una vez propagada la política. Que siga fallando en otros proyectos se deduce de la herencia (override solo en `booster-ai-494222`); no se probó. |
| SC-3 | `gcloud projects describe booster-ai-494222` → `booster-ai-494222 ACTIVE`. `bq query` al billing export → `202609, 652191` · `202610, 405433`. `gcloud run services update booster-ai-matching-engine --update-labels=…` → `PERMISSION_DENIED`. `gcloud secrets versions access latest --secret=resend-api-key` → `PERMISSION_DENIED`. |
| SC-4 | `env` sin `private_key`, `client_email` ni similares (0 coincidencias); sin archivos de credenciales en `~/.config/gcloud`; `CLOUDSDK_AUTH_ACCESS_TOKEN` sigue siendo el placeholder `proxy-…`. El proxy firma las requests fuera del contenedor. |

El secreto aplicó en la sesión que ya estaba abierta, sin reiniciarla.

Nota: `oauth2/v3/tokeninfo` devuelve `email` vacío para el token firmado por el proxy (scope `cloud-platform` presente, sin scope `email`). Las llamadas reales confirman la identidad por sus permisos: lectura sí, escritura y secretos no.

## Pendiente

- Control de ADR-086 §5 (única llave `USER_MANAGED` del proyecto) en cada rotación anual. Línea base: 1 llave, la de `claude-cloud-readonly`.
- ADR-086 dice en su encabezado que pasa a Aceptado con el merge de #833; la etiqueta la cambia el PO (archivo protegido).
