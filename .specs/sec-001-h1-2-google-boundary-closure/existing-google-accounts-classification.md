# Clasificación de cuentas IdP Google existentes (T4 / SC-G2)

- **Spec**: [`spec.md`](./spec.md) SC-G2 · **Plan**: [`plan.md`](./plan.md) T4 · **ADR**: [057](../../docs/adr/057-google-signup-boundary-and-reaper-supersedes-054.md)
- **Script**: [`apps/api/scripts/classify-google-idp-accounts.ts`](../../apps/api/scripts/classify-google-idp-accounts.ts) (read-only)
- **Estado**: ⏳ **template — pendiente del run operacional contra prod + decisiones PO**

## Metodología

El script regenera el inventario **contra el estado IdP ACTUAL** (Admin SDK `listUsers`, paginado) — NO hereda el `ghost-users-dry-run.csv` viejo (DA R2 N2: snapshot stale para una decisión destructiva). Cruza cada cuenta Google contra `usuarios` + `solicitudes_registro`:

| Categoría | Criterio | Acción |
|---|---|---|
| **LEGITIMATE** | fila `usuarios` (dual-match `firebase_uid` OR `LOWER(TRIM(email))`, OQ-G6 inclusivo) **o** allowlist never-reapable | fuera del scope del reaper |
| **PENDING** | sin fila `usuarios`, pero `solicitudes_registro` en `pendiente_aprobacion`/`aprobado` | esperar resolución del pipeline; no reapear |
| **INERT** | sin fila `usuarios` ni solicitud activa | candidato reaper → **decisión PO por cada una** |

Scope OQ-G3: solo cuentas con provider `google.com` + email presente (excluye phone/SAML → elimina R-G8). `dev@boosterchile.com` nunca reapable (allowlist `NEVER_REAPABLE_EMAILS`).

> **Expectativa (de `oq-resolution.md` OQ-G1)**: `solicitudes_registro` está **vacía** en prod → no habrá PENDING; las cuentas serán LEGITIMATE (con fila `usuarios`) o INERT (self-signup Google sin provisión, el vector H1.2).

## Cómo correrlo (gate operacional)

```bash
gcloud auth application-default login
# IAP tunnel al db-bastion (ver memoria reference_prod_db_headless_query) → exportar DATABASE_URL
export DATABASE_URL='postgresql://…@127.0.0.1:<puerto-tunel>/<db>?sslmode=require'
export BOOSTER_PLATFORM_ADMIN_EMAILS='dev@boosterchile.com,...'  # mismos que prod (never-reapable)
pnpm --filter @booster-ai/api exec tsx scripts/classify-google-idp-accounts.ts
# escribe el reporte CON PII a existing-google-accounts-classification.generated.md
# (gitignored — NO COMMITEAR). Este archivo (sin datos) queda como template versionado.
```

> **PII (REVIEW finding E)**: el reporte real (`*.generated.md`) contiene emails + nombres → está en `.gitignore`; revisarlo localmente, no subirlo. **never-reapable (finding D)**: el script usa `BOOSTER_PLATFORM_ADMIN_EMAILS` + `dev@boosterchile.com`, igual que el reaper en runtime.

## Resultados

> _Pendiente del run operacional. El script escribe acá el resumen (conteo por categoría) + el detalle por cuenta. Tras el run, el PO completa la columna "Decisión PO" de cada fila INERT con timestamp + rationale + reversibilidad (disable-before-delete, ADR-057)._

| firebaseUid | email | displayName | createdAt | lastSignInAt | clasificación | rationale | Decisión PO (solo INERT) |
|---|---|---|---|---|---|---|---|
| _(pendiente run)_ | | | | | | | |

## Protocolo de decisión PO (INERT)

Por cada cuenta INERT, registrar de forma auditable:
- **timestamp** de la decisión,
- **rationale** (por qué reapear o conservar),
- confirmación de **reversibilidad** (el reaper hace `disable-before-delete` + 2º grace; el primer paso no destruye).

Ninguna cuenta LEGITIMATE (incl. `dev@boosterchile.com`) entra al scope del reaper. Esta clasificación alimenta el hard-guard del reaper (T7/T8).
