# Auditoría de Seguridad y Compliance Chile — Booster AI

**Fecha**: 2026-06-14
**Modo**: READ-ONLY (diagnóstico, sin fixes)
**Cobertura**: apps/api, apps/web, apps/whatsapp-bot, apps/telemetry-tcp-gateway, apps/telemetry-processor, apps/document-service, apps/matching-engine, apps/notification-service; packages/{dte-provider,factoring-engine,carbon-calculator,pricing-engine,config,logger,shared-schemas}; infrastructure/; .github/workflows/

> Nota: ningún secreto se imprime en cleartext. Los valores sensibles se citan por prefijo o redactados.

---

## P0 — Críticos (acción inmediata)

### P0-1: reCAPTCHA site key de producción en `.env.local` local

**Ruta**: `apps/web/.env.local:18`
**Categoría**: Secret en entorno local / aislamiento dev-prod
**Evidencia**: `.env.local` existe en el worktree con `VITE_RECAPTCHA_SITE_KEY` real (prefijo `6Lc5B…`). `.gitignore` excluye `.env.*` y `git ls-files` confirma que NO está trackeado. El comentario del archivo dice: "La actual está asociada al proyecto de prod — revisar al migrar a dev".
**Impacto**: La site key reCAPTCHA v3 es pública por diseño, pero el comentario indica una sola cuenta Firebase/reCAPTCHA sin aislamiento dev/prod en frontend. Si el entorno dev apunta a prod, las acciones de desarrollo golpean producción.
**Acción**: Crear proyecto Firebase separado para dev. Rotar la site key de prod. Completar `.env.local` apuntando al proyecto dev.

### P0-2: GCP Project ID y Billing Account hardcoded en código de producción

**Rutas**:
- `apps/api/src/config.ts:566` — default Zod con `'booster-ai-494222.billing_export.gcp_billing_export_v1_019461_C73CDE_DCE377'`
- `apps/api/src/server.ts:625` — fallback `config.GOOGLE_CLOUD_PROJECT ?? 'booster-ai-494222'`
- `packages/certificate-generator/src/tipos.ts:118` — KMS key resource path con `booster-ai-494222` literal

**Categoría**: Information disclosure / configuración hardcoded
**Impacto**: Project ID de prod, billing account ID (`019461_C73CDE_DCE377`) y dataset BigQuery de billing versionados. Facilita reconocimiento y construcción de paths de recursos GCP válidos.
**Acción**: Mover el default de `BILLING_EXPORT_TABLE` a variable Terraform sin default en código. `gcpProjectId` sin fallback a prod (usar `undefined`). Paths KMS en tipos.ts como documentación, no defaults productivos.

### P0-3: Firebase UIDs de cuentas demo antiguas hardcoded post-disclosure

**Ruta**: `apps/api/src/services/harden-demo-accounts.ts:33-38`
**Categoría**: PII (identificadores de usuario) en código versionado — Ley 19.628
**Evidencia**: Cuatro Firebase UIDs reales como `OLD_DEMO_UIDS`. Comentario: "post-disclosure replacement 2026-05-24 (ADR-053)".
**Impacto**: Aunque retiradas, quedan en el historial git indefinidamente. Los identificadores de usuario son PII bajo Ley 19.628.
**Acción**: Mover a env var o Secret Manager. Evaluar `git filter-repo` sobre el historial con asesor legal.

### P0-4: Retention Lock del bucket DTE/SII en `false` — compliance SII Art. 17

**Rutas**: `infrastructure/storage.tf:145-151`, `infrastructure/crash-traces.tf:86`
**Categoría**: Compliance SII / ADR-007
**Evidencia**: `retention_policy { retention_period = 189216000; is_locked = false }`. Política de 6 años CONFIGURADA pero NO bloqueada. Comentario en storage.tf: "bucket vacío / 0 tráfico DTE → SC-4 insatisfacible".
**Impacto legal**: El SII exige conservar DTEs ≥6 años sin posibilidad de alteración/destrucción (Código Tributario Art. 17 + Resolución SII Exenta N°45). `is_locked=false` permite a un admin GCP destruir DTEs antes de 6 años. Si ya hay DTEs reales emitidos, es incumplimiento. Si no, el gate del comentario ("0 tráfico DTE") es válido.
**Acción**: Verificar si hay DTEs reales en el bucket. Si los hay, activar `is_locked = true` previo sign-off del PO y asesor legal. Documentar en ADR-007. **CONGELADO legalmente — requiere revisión legal, no edit directo.**

### P0-5: Scope validation débil para `portafolio_viajes` en consentimientos ESG (IDOR)

**Ruta**: `apps/api/src/routes/me-consents.ts:85-95`
**Categoría**: IDOR / autorización insuficiente (ADR-028) — Ley 19.628 Art. 4
**Evidencia**: Para `scope_type === 'portafolio_viajes'` solo valida "el user tiene alguna membership activa" (`eq(memberships.userId, …)` sin filtrar por rol ni empresa). El `scope_id` no se valida contra trips del otorgante. El propio código tiene comentario "P1: validar que TODOS los trips del portafolio sean de empresas donde el user es dueño/admin".
**Impacto**: Un usuario con rol `visualizador`/`conductor` puede otorgar grants ESG sobre un portafolio arbitrario, incluyendo trips de otra empresa. Consentimiento inválido sobre datos de terceros (Ley 19.628 Art. 4).
**Acción**: Validar que el `scope_id` pertenezca a una empresa donde el user tiene rol `dueno`/`admin`. **Requiere revisión legal (consentimiento de datos de terceros).**

---

## P1 — Altos (este sprint)

### P1-1: `sql.raw()` con constante de configuración en producción
**Ruta**: `apps/api/src/services/chat-whatsapp-fallback.ts:103`
**Evidencia**: `sql\`now() - INTERVAL '${sql.raw(String(UNREAD_THRESHOLD_MINUTES))} minutes'\``. La constante no es input de usuario → sin inyección real, pero el patrón `sql.raw(String(x))` está prohibido (crea hábito replicable con input externo).
**Acción**: Usar literal seguro o parametrización nativa de Drizzle para el intervalo.

### P1-2: `sql.raw()` en migrator con nombres de tabla/schema
**Ruta**: `apps/api/src/db/migrator.ts:182,221,224`
**Evidencia**: `sql.raw()` sobre `MIGRATIONS_SCHEMA`/`MIGRATIONS_TABLE` y sentencias de archivos de migración versionados. Valores controlados por el sistema → riesgo real bajo (Drizzle no parametriza identificadores de schema/tabla).
**Acción**: Documentar con comentario por qué es seguro en este contexto.

### P1-3: Telemetry TCP Gateway — open enrollment sin rate limiting ni auth de IMEIs
**Ruta**: `apps/telemetry-tcp-gateway/src/imei-auth.ts:32-66`
**Evidencia**: Acepta conexiones TCP de cualquier IMEI no registrado, hace `upsert` en `dispositivos_pendientes` por conexión, mantiene la conexión abierta. Sin rate limiting por IP de origen ni por IMEI rechazado.
**Impacto**: Atacante con acceso a la red puede llenar `dispositivos_pendientes` con basura y agotar file descriptors/memoria con miles de conexiones TCP.
**Acción**: (1) Confirmar que el puerto solo es accesible desde rangos IP Teltonika/carriers (GKE NetworkPolicy). (2) Rate limiting por IP a nivel TCP. (3) Cuota máxima de `dispositivos_pendientes` por IP.

### P1-4: `/public/tracking/:token` sin rate limiting
**Ruta**: `apps/api/src/routes/public-tracking.ts:12-16`
**Evidencia**: Comentario propio: "Rate limiting: TODO post-deploy con Cloud Armor… Por ahora confiamos en la opacidad del token UUID (122 bits)".
**Impacto**: 122 bits hace inviable adivinar tokens, pero el endpoint queda sin cap contra DoS volumétrico (flood de requests agota pool de conexiones DB sin adivinar ningún token).
**Acción**: Rate limiting por IP (~60 req/min) en Cloud Armor o middleware Hono antes de llegar a la DB.

### P1-5: Consent scope `portafolio_viajes` no valida empresa scope_id
Ver P0-5 (clasificado P0 por impacto, P1 por esfuerzo de implementación).

### P1-6: Twilio status callback reconstruye la URL dinámicamente para verificar firma
**Ruta**: `apps/whatsapp-bot/src/routes/webhook.ts:154`
**Evidencia**: `const statusWebhookUrl = \`${webhookUrl.replace(/\/webhooks\/whatsapp$/, '')}/webhooks/twilio-status\`;`. Si `webhookUrl` no termina en `/webhooks/whatsapp`, el `.replace()` no hace nada y la firma se verifica contra una URL incorrecta.
**Impacto**: Verificación HMAC sobre URL incorrecta puede permitir requests falsas sin firma válida al `/webhooks/twilio-status`.
**Acción**: Usar `STATUS_WEBHOOK_URL` como env var separada (ya sugerido en comentario). No construir la URL dinámicamente.

### P1-7: Consent de empresa no valida que scope_id pertenezca a empresa del actor (IDOR)
**Ruta**: `apps/api/src/routes/me-consents.ts:98-106`
**Evidencia**: Para scopes `generador_carga`/`transportista`/`organizacion` no valida `empresaId === scope_id`; solo que el user es dueno/admin de alguna empresa.
**Impacto**: Un dueno de empresa A puede otorgar grants ESG sobre empresa B sin ser miembro de B.
**Acción**: Añadir `eq(memberships.empresaId, opts2.scopeId)` al WHERE.

### P1-8: `OLD_DEMO_UIDS` en historial git
Complemento de P0-3: el historial retiene los UIDs indefinidamente. Evaluar `git filter-repo`.

---

## P2 — Medios (próximo sprint)

- **P2-1** `apps/api/src/server.ts:625` — fallback hardcoded `?? 'booster-ai-494222'` confunde ambientes en logs OTel. Quitar fallback.
- **P2-2** `console.*` en scripts CI/audit (`apps/api/scripts/check-is-demo-allowlist-comments.ts:166-176`, `check-allowlist-pr-guard.ts:88-127`, `classify-google-idp-accounts.ts:248-299`). Verificar redacción de emails en classify-google-idp-accounts.ts.
- **P2-3** `.github/workflows/security.yml:122` — Trivy config scan con `exit-code: '0'` (no bloquea misconfigs HIGH/CRITICAL). Cambiar a `'1'` con excepciones documentadas.
- **P2-4** `apps/api/src/config.ts:566` — default `BILLING_EXPORT_TABLE` expone billing account ID. Remover default; required en prod.
- **P2-5** `apps/web/src/lib/firebase.ts:55-57` — App Check debug token activo en DEV; riesgo real solo si dev/prod comparten proyecto Firebase (ver P0-1).
- **P2-6** `infrastructure/storage.tf:210` — bucket `certificates` usa key `storage_operational` en vez de key dedicada; reduce trazabilidad de audit KMS para certificados de carbono.
- **P2-7** `apps/api/src/services/consent.ts` / `schema.ts:1445` — verificar que todo endpoint ESG llame `recordStakeholderAccess` (audit bloqueante ADR-028, Ley 19.628 Art. 12). Añadir test de integración.
- **P2-8** Patrón `sql.raw(String(...))` replicable (ver P1-1).
- **P2-9** `infrastructure/org-policies.tf:22-29` — `allow_all = "TRUE"` en `iam.allowedPolicyMemberDomains` aplica a todo el proyecto, no solo Cloud Run. Un `allUsers` errado sobre Secret Manager/Cloud SQL no sería bloqueado. Evaluar excepción más acotada.
- **P2-10** `.github/workflows/security.yml:111` — Trivy filesystem scan con `exit-code: '0'`. Cambiar a `'1'` con `ignore-unfixed: true`.

---

## Verificación de Stack vs ADRs (CONFORME salvo lo anotado)

| Item | Estado |
|------|--------|
| JWT/OIDC RS256/ES256 (no HS256, no `none`), `exp`/`iss`/`aud` validados | CONFORME (firebase-auth.ts, auth.ts) |
| Firma JWT verificada + revocation (`verifyIdToken(token, true)`) | CONFORME |
| Credenciales vía Secret Manager (sin secretos en código) | CONFORME |
| CORS con lista de orígenes desde env (no `*`) | CONFORME |
| Validación Zod en endpoints (`zValidator`) | CONFORME (mayoritario) |
| Zero `console.*` runtime | CONFORME runtime / NON-CONFORME en scripts (P2-2) |
| PII redactada en logs (`packages/logger/src/redaction.ts`) | CONFORME |
| RBAC por rol | CONFORME (gaps de scope IDOR en consents: P0-5/P1-7) |
| IAM mínimo privilegio | MAYORITARIAMENTE (org policy `allow_all` es el punto amplio, P2-9) |
| CMEK en buckets / firma KMS documentos | CONFORME |
| Retención 6 años SII | ESTRUCTURAL sí / OPERACIONAL no (`is_locked=false`, P0-4) |
| k-anonymity datos stakeholder (k=5) | CONFORME (stakeholder-aggregations.ts) |
| DNSSEC on | CONFORME (networking.tf:26) |
| Workload Identity Federation (sin SA keys JSON) | CONFORME (iam.tf) |

---

## Resumen ejecutivo — P0

1. **P0-1** — `.env.local` con reCAPTCHA site key de prod; sin aislamiento Firebase dev/prod.
2. **P0-2** — GCP project ID + billing account ID hardcoded como defaults Zod (config.ts:566, server.ts:625).
3. **P0-3** — 4 Firebase UIDs reales hardcoded y versionados (harden-demo-accounts.ts:33-38).
4. **P0-4** — Bucket DTE/SII con `is_locked=false`; viola Código Tributario Art. 17 si hay DTEs reales. **CONGELADO legal.**
5. **P0-5** — Consent `portafolio_viajes` sin validar scope_id contra trips del otorgante; IDOR sobre datos de terceros (ADR-028, Ley 19.628). **Requiere revisión legal.**
