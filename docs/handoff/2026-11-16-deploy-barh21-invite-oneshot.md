# One-shot — deploy BARH-21 (invitaciones correo → `/crear-cuenta`)

**Fecha**: 2026-11-16 · America/Santiago  
**Pedido**: tras merge de #986, desplegar a prod y enviar invitaciones reales a
`gerencia@boosterchile.com` y `sandoval.felipe@gmail.com`.  
**Quién dispara release / gate**: **PO** (`dev@boosterchile.com`).  
**Quién no**: Cursor / `cursor-agent@` — sin `actions:write`, sin gate
`production`, sin `run.services.update`, sin `terraform apply` en prod.

```bash
TZ=America/Santiago date
# Ejemplo: lun 16 nov 2026 10:XX -03
```

## 1. Qué hay en `main` (aún no en prod)

| PR | Commit | Qué trae |
|---|---|---|
| [#985](https://github.com/boosterchile/booster-ai/pull/985) | `3107bb6b` | ADR-093 + spec: personal Booster / Stakeholder → **correo + clave**; resto sigue RUT+clave (ADR-035) |
| [#984](https://github.com/boosterchile/booster-ai/pull/984) | `9ca4df06` | From canónico `Booster <contacto@boosterchile.com>` (`config.ts` default + `EMAIL_FROM` en `infrastructure/compute.tf`) + oneshot panel legado |
| [#986](https://github.com/boosterchile/booster-ai/pull/986) | `25826165` | **Slice 1 ADR-093**: migración `0084_invitaciones_correo_cuenta`, `POST /admin/personal-booster/invitar`, `GET/POST /auth/invitar-cuenta`, UI `/crear-cuenta`, login tipo Booster correo+clave, panel «Invitar por correo» |

**HEAD `main`**: `25826165` (`feat(auth): invite personal Booster por correo a /crear-cuenta (#986)`).  
**Prod actual** (corte pre-release): Cloud Run en `74461b85` (release
[43807662486](https://github.com/boosterchile/booster-ai/actions/runs/43807662486),
03:41 -03). **Gap**: `74461b85` → `25826165` (docs #985/#984 + código #986).

Camino canónico post-deploy (no el alta RUT de #984):

1. Panel `/app/platform-admin/personal` → «Invitar por correo» (solo email).
2. Mail From `contacto@` con enlace a `/crear-cuenta?token=…`.
3. Invitado consigna nombre, RUT (opcional según schema), clave Firebase.
4. Login `/login?tipo=booster` → correo + clave.

## 2. Release canónico (PO)

```bash
# Desde máquina/cuenta del PO con actions:write
gh workflow run release.yml --ref main
# Abrir el run y aprobar el Environment `production` (gate humano).
# Canary Cloud Build: api 1 % → 100 %; no cancelar runs en paralelo
# (un duplicado se cancela; ver run 43809899052).
```

Checklist del gate:

- [ ] Run `Release + Deploy` en `main` @ `25826165` (o más nuevo si hubo merge).
- [ ] PO aprueba environment **`production`**.
- [ ] Jobs verdes; canary del api llega a 100 %.
- [ ] No lanzar un segundo `release.yml` mientras el primero está en canary.

**Cursor no ejecuta** `gh workflow run release.yml` ni aprueba el gate.

## 3. Confirmación post-deploy (America/Santiago)

### 3.1 Revisiones Cloud Run

```bash
TZ=America/Santiago date
gcloud run services describe booster-ai-api \
  --project=booster-ai-494222 --region=southamerica-west1 \
  --format='value(status.latestReadyRevisionName,status.traffic)'
gcloud run services describe booster-ai-web \
  --project=booster-ai-494222 --region=southamerica-west1 \
  --format='value(status.latestReadyRevisionName,status.traffic)'
# Esperado: revisión nueva con commit/label de 25826165 (o SHA del release);
# tráfico 100 % en la revisión lista.
```

Smoke HTTP:

```bash
curl -sS https://api.boosterchile.com/health
curl -sS https://api.boosterchile.com/ready
curl -sS -o /dev/null -w '%{http_code}\n' https://app.boosterchile.com/
# Esperado: 200; ready con db ok.
```

Conservar flags ya ON (no deben regresar):

```bash
curl -sS https://api.boosterchile.com/feature-flags
# rutas_api_activada: true
gcloud run services describe booster-ai-api \
  --project=booster-ai-494222 --region=southamerica-west1 \
  --format='yaml(spec.template.spec.containers[0].env)' \
  | grep -A1 -E 'MATCHING_ELEGIBILIDAD_MODO|RUTAS_API_ACTIVADA|EMAIL_FROM|AUTH_UNIVERSAL'
# Esperado: RUTAS_API_ACTIVADA=true; MATCHING_ELEGIBILIDAD_MODO=activa
```

### 3.2 `EMAIL_FROM` / `contacto@`

Dos capas (cualquiera alcanza para el From en runtime; idealmente ambas):

| Capa | Esperado tras release |
|---|---|
| Default `apps/api` (`config.ts`) | `Booster <contacto@boosterchile.com>` (ya en la imagen de #986) |
| Env Cloud Run `EMAIL_FROM` | Ideal: `Booster <contacto@boosterchile.com>` vía Terraform (`compute.tf`). Si el release **conserva** env y la var seguía ausente, el default de la imagen nueva ya manda `contacto@`. |

```bash
gcloud run services describe booster-ai-api \
  --project=booster-ai-494222 --region=southamerica-west1 \
  --format='yaml(spec.template.spec.containers[0].env)' \
  | grep -A1 EMAIL_FROM || true
# Si ausente: OK temporal (default imagen = contacto@).
# Para fijar IaC sin drift: terraform apply del PO (module.service_api)
# que inyecta EMAIL_FROM — no lo hace Cursor.
```

Resend: dominio / sender `contacto@boosterchile.com` **verified** (DNS en
`infrastructure/email.tf`). Si Resend responde 422, la invitación queda en DB
y el panel puede reintentar; hay que entregar el enlace a mano si hace falta.

### 3.3 Migración `0084` en journal / prod

Expand-only: crea `invitaciones_correo_cuenta` (+ índices). Arranca con el api
(`runMigrationsGated` en `main.ts`).

```bash
# Solo lectura — scripts/db/agent-query.sh (ADC con permiso)
scripts/db/agent-query.sh -c "
SELECT id, hash, created_at
FROM drizzle.__drizzle_migrations
ORDER BY created_at DESC
LIMIT 5;
"
scripts/db/agent-query.sh -c "
SELECT to_regclass('public.invitaciones_correo_cuenta') AS tabla;
"
# Esperado: fila/tag de 0084_invitaciones_correo_cuenta (o hash del journal);
# to_regclass → invitaciones_correo_cuenta
```

En disco / journal: `apps/api/drizzle/0084_invitaciones_correo_cuenta.sql` +
entrada en `apps/api/drizzle/meta/_journal.json`.

## 4. Invitar desde el panel (los 2 correos)

**Login PO** (igual que antes):

| Camino | URL | Credencial |
|---|---|---|
| RUT (universal) | `https://app.boosterchile.com/login` → Booster | RUT `14289398-3` + clave |
| Correo / Google (legacy) | `https://app.boosterchile.com/login?legacy=1` | Google `dev@boosterchile.com` |

Pasos UI (ADR-093 — **no** el formulario RUT+código legado de la misma pantalla):

1. Abrir `https://app.boosterchile.com/app/platform-admin/personal`.
2. Sección **«Invitar por correo (usuario nuevo)»** (`data-testid=personal-invitar-correo`).
3. Correo `gerencia@boosterchile.com` → enviar. Confirmar mensaje de OK + `expira_en`.
4. Correo `sandoval.felipe@gmail.com` → enviar.
5. Cada persona abre el mail (From `Booster <contacto@boosterchile.com>`),
   enlace `https://app.boosterchile.com/crear-cuenta?token=…`.
6. En `/crear-cuenta`: nombre completo, RUT si el form lo pide, clave + confirmación.
7. Tras crear: login `https://app.boosterchile.com/login?tipo=booster` → correo + clave.

API equivalente (sesión platform-admin; **no** pegar el token en chats):

```bash
API=https://api.boosterchile.com
curl -sS -X POST "$API/admin/personal-booster/invitar" \
  -H "Authorization: Bearer $ID_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"email":"gerencia@boosterchile.com"}'
curl -sS -X POST "$API/admin/personal-booster/invitar" \
  -H "Authorization: Bearer $ID_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"email":"sandoval.felipe@gmail.com"}'
```

## 5. Smoke post-invite

```bash
# Invitaciones pendientes (solo lectura)
scripts/db/agent-query.sh -c "
SELECT email, tipo, expira_en, consumido_en, creado_en
FROM invitaciones_correo_cuenta
WHERE email IN (
  'gerencia@boosterchile.com',
  'sandoval.felipe@gmail.com'
)
ORDER BY creado_en DESC;
"
```

Por cada invitado, tras `/crear-cuenta`:

- [ ] Mail recibido; From = `contacto@boosterchile.com` (no `no-reply@`).
- [ ] Enlace abre `/crear-cuenta` con el correo precargado.
- [ ] Cuenta creada; `es_admin_plataforma = true` para personal Booster.
- [ ] `consumido_en` poblado en la fila de invitación.
- [ ] Login `/login?tipo=booster` con correo + clave → entra al panel.
- [ ] Reuso del mismo token → 410 / «invitación inválida».

Si el mail no sale: revisar logs api (`correo de invitación crear-cuenta`);
confirmar Resend + `EMAIL_FROM`; reenviar desde el panel si hay acción, o
nueva invitación tras invalidar la pendiente.

## 6. Reverso (si aplica)

| Qué falló | Reverso |
|---|---|
| Release / imagen mala | Redeploy del SHA anterior estable (`74461b85`) vía release a ese ref **o** tráfico Cloud Run a la revisión previa (PO / owner). Flags `RUTAS_API_ACTIVADA` / matching `activa` no se apagan salvo incidente. |
| Migración `0084` | **Expand-only** (solo `CREATE TABLE` / índices). No hay down automático (ADR-066). Rollback de imagen deja la tabla; es inocua si nadie escribe. DROP manual solo con visto PO + lista ADR-076. |
| `EMAIL_FROM` / TF | Si un apply inyectó la var y hay que volver: quitar o cambiar env con apply/`gcloud` del owner. Sin apply, el default de la imagen decide. |
| Invitación errónea | No completar `/crear-cuenta`. La fila vence (`expira_en`, 7 días) o queda sin consumir. Si ya crearon cuenta: quitar acceso desde el panel (`POST …/quitar-acceso`) + limpieza Firebase solo con el PO. |
| Invitados ya con cuenta mala | No re-invitar el mismo email mientras exista cuenta (`email_already_registered` 409). |

## 7. Qué NO hacer desde Cursor

- `gh workflow run release.yml` / aprobar environment `production`.
- `terraform apply` (prod).
- `gcloud run services update` (sin `run.services.update`).
- Invitar por el flujo RUT legado (`POST /admin/personal-booster` con nombre+RUT) para estos dos correos.
- Crear Firebase email/password a mano (bypass ADR-093).

## 8. Trabajo en paralelo (no abandona el plan)

Mientras el PO hace el release / gate:

1. **Observar matching `activa`**: al primer matching real, log
   `matching: elegibilidad por carga` + ofertas generadas; registrar en
   `docs/handoff/CURRENT.md` (aún **sin** matching real observado).
2. Con el primer cierre de viaje/ruta tras #977: confirmar versión 3 /
   `distancia_no_plausible` si aplica.
3. Staging ADR-083: checklist en seco; el agente no crea proyecto ni apply.

## Referencias

- Spec: `.specs/auth-correo-clave-booster-stakeholder/spec.md` (SC8 oneshot).
- ADR-093: `docs/adr/093-auth-correo-clave-booster-stakeholder.md`.
- Oneshot previo (legado RUT / From): `docs/handoff/2026-11-16-invitar-personal-booster-oneshot.md`.
- Estado vivo: `docs/handoff/CURRENT.md`.
