import {
  commonEnvSchema,
  databaseEnvSchema,
  gcpEnvSchema,
  parseEnv,
  redisEnvSchema,
} from '@booster-ai/config';
import { z } from 'zod';

const apiEnvSchema = commonEnvSchema
  .merge(databaseEnvSchema)
  .merge(redisEnvSchema)
  .merge(gcpEnvSchema)
  .extend({
    SERVICE_NAME: z.literal('booster-ai-api'),
    CORS_ALLOWED_ORIGINS: z.string().transform((s) => s.split(',').filter(Boolean)),
    JWT_ISSUER: z.string().default('booster-ai'),
    FIREBASE_PROJECT_ID: z.string().min(1),

    /**
     * Audiences aceptadas en el OIDC token de Cloud Run SA-to-SA.
     *
     * CSV ("https://api.boosterchile.com,https://booster-ai-api-...run.app")
     * por diseño: el api acepta ambas URLs como audience válida.
     *   - *.run.app cubre tráfico interno Cloud Run-to-Cloud Run (canónico).
     *   - api.boosterchile.com cubre callers futuros que entren por el LB
     *     público y firmen el OIDC con la URL pública como audience.
     *
     * Cada entrada debe ser una URL completa (https://...). El middleware de
     * auth chequea `claims.aud ∈ API_AUDIENCE`.
     *
     * Ver: https://cloud.google.com/run/docs/authenticating/service-to-service
     */
    API_AUDIENCE: z
      .string()
      .transform((s) =>
        s
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean),
      )
      .refine(
        (arr) => arr.length > 0 && arr.every((u) => /^https?:\/\//.test(u)),
        'API_AUDIENCE debe ser CSV de URLs (al menos una)',
      ),

    /**
     * Email del SA que está autorizado a invocar endpoints protegidos.
     * En el thin slice: el SA del whatsapp-bot.
     */
    ALLOWED_CALLER_SA: z
      .string()
      .regex(/^[a-z0-9-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com$/, 'SA email inválido'),

    /**
     * Credenciales Twilio para enviar templates al carrier (B.8).
     *
     * El api comparte el mismo Sender (+19383365293) que apps/whatsapp-bot —
     * ambos servicios pueden mandar mensajes desde el mismo número porque
     * Twilio identifica el sender por From + auth, no por servicio.
     *
     * TWILIO_AUTH_TOKEN viene de Secret Manager (mismo secreto que el bot).
     * Si las 3 vars no están seteadas, el dispatcher de notificaciones
     * loggea warn y skipea el envío — útil en dev y entornos donde aún
     * no se aprobaron templates.
     */
    TWILIO_ACCOUNT_SID: z
      .string()
      .regex(/^AC[a-fA-F0-9]+$/, 'Account SID debe empezar con AC')
      .optional(),
    TWILIO_AUTH_TOKEN: z.string().min(16).optional(),
    TWILIO_FROM_NUMBER: z
      .string()
      .regex(/^\+\d+$/, 'Formato E.164 con +')
      .optional(),

    /**
     * Content SID del template aprobado para notificar al carrier que
     * llegó una nueva oferta. Viene de Twilio Content Editor tras
     * aprobación de Meta (24-48h tras submit).
     *
     * Variables esperadas (1-based):
     *   {{1}} → tracking_code
     *   {{2}} → "Origen → Destino"
     *   {{3}} → precio CLP formateado
     *   {{4}} → URL al dashboard del carrier
     *
     * Optional para permitir merge antes de la aprobación. Si está vacío,
     * el dispatcher loguea warn y skipea.
     *
     * IMPORTANTE: el preprocess trata string vacío como undefined. Cloud
     * Run / Terraform a veces pasan la env var como "" (no como ausente),
     * y `.optional()` solo cubre `undefined` — sin el preprocess, "" cae
     * al regex y mata el startup con FATAL. Lección de incidente
     * 2026-05-02 cuando un terraform apply sin -var dejó la var en "" y
     * el api revienta en boot.
     */
    CONTENT_SID_OFFER_NEW: z.preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
      z
        .string()
        .regex(/^HX[a-fA-F0-9]+$/, 'Debe empezar con HX seguido de hex chars')
        .optional(),
    ),

    /**
     * URL pública del frontend, usada para construir el deep-link al
     * dashboard del carrier en el template.
     */
    WEB_APP_URL: z.string().url().default('https://app.boosterchile.com'),

    /**
     * Configuración para emisión de certificados de huella de carbono
     * (P2 — packages/certificate-generator).
     *
     * CERTIFICATE_SIGNING_KEY_ID: resource ID de la KMS asymmetric key
     *   (sin :versions). Inyectado por Terraform desde
     *   google_kms_crypto_key.certificate_carbono_signing.id. Si está
     *   ausente, el wire de fire-and-forget en confirmar-entrega-viaje
     *   skipea el certificado y loggea warn (útil en dev sin KMS).
     *
     * CERTIFICATES_BUCKET: nombre del bucket GCS donde subir el PDF
     *   firmado, sidecar y cert X.509 cacheado. Reusa el bucket
     *   `documents` existente (CMEK + retention 6y).
     *
     * Ambos optional para no bloquear startup en dev. El servicio
     * emitirCertificadoViaje chequea presencia y skipea si falta.
     */
    CERTIFICATE_SIGNING_KEY_ID: z.string().min(1).optional(),
    CERTIFICATES_BUCKET: z.string().min(1).optional(),

    /**
     * Bucket GCS para adjuntos del chat shipper↔transportista (P3.a):
     * fotos subidas por los participantes durante la conversación.
     *
     * Path layout: gs://{bucket}/chat/{assignment_id}/{message_id}.jpg
     * Lifecycle: 90 días (los chats viejos no necesitan conservar fotos
     * pesadas). Sin retention lock — son adjuntos operativos, no
     * documentos legales.
     *
     * Optional para que el endpoint POST /messages funcione en dev sin
     * GCS — los mensajes tipo 'foto' devuelven 503 si el bucket no está.
     * Mensajes texto + ubicación funcionan sin esta env var.
     */
    CHAT_ATTACHMENTS_BUCKET: z.string().min(1).optional(),

    /**
     * Pub/Sub topic name para el realtime del chat (P3.b). Cada mensaje
     * insertado se publica con atributo `assignment_id`; los GET
     * /:id/messages/stream crean una subscription efímera filtrada por
     * ese atributo y consumen via SSE.
     *
     * Optional: si está ausente, POST /messages igual escribe a la DB
     * pero no publica al topic, y GET /stream devuelve 503. La UI cae
     * a polling 5s como fallback (sin perder funcionalidad, solo
     * latencia).
     */
    CHAT_PUBSUB_TOPIC: z.string().min(1).optional(),

    /**
     * VAPID keys para Web Push (P3.c). Generadas con
     * `npx web-push generate-vapid-keys` post-deploy y subidas a Secret
     * Manager. La pública se sirve via GET /webpush/vapid-public-key
     * (público, sin auth) para que el cliente subscribe; la privada
     * SOLO la usa el api para firmar el JWT Authorization que va al push
     * service del browser.
     *
     * Optional: sin estas, POST /me/push-subscription devuelve 503 y los
     * mensajes nuevos NO disparan push notif (los mensajes igual se
     * insertan en DB y los SSE viewers los reciben).
     */
    WEBPUSH_VAPID_PUBLIC_KEY: z.string().min(1).optional(),
    WEBPUSH_VAPID_PRIVATE_KEY: z.string().min(1).optional(),
    /**
     * Subject del JWT VAPID (mailto: o https://). El push service usa
     * esto para contactar al sender si hay abuso. Default vendor-neutral.
     */
    WEBPUSH_VAPID_SUBJECT: z.string().default('mailto:soporte@boosterchile.com'),

    /**
     * Content SID del template Twilio `chat_unread_v1` para el fallback
     * WhatsApp del chat (P3.d). Variables (1-based):
     *   {{1}} → tracking_code
     *   {{2}} → sender_name (display name del que escribió)
     *   {{3}} → message_preview (primeros ~80 chars o "📷 foto"/"📍 ubicación")
     *   {{4}} → URL al chat (deep-link al PWA)
     *
     * Optional para no romper startup mientras Meta aprueba el template
     * (24-48h post-submit). Mientras esté vacío, el cron de fallback
     * loggea warn y skipea — los push notifs (P3.c) y SSE (P3.b) cubren
     * el caso real-time; el WhatsApp es solo para users sin push.
     */
    CONTENT_SID_CHAT_UNREAD: z.preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
      z
        .string()
        .regex(/^HX[a-fA-F0-9]+$/, 'Debe empezar con HX seguido de hex chars')
        .optional(),
    ),

    /**
     * Content SID del template Twilio `tracking_link_v1` (Phase 5 PR-L3).
     * Body: "Tu carga {{1}} ya tiene transportista" + URL con {{4}} =
     * token UUID v4. Variables (1-based):
     *   {{1}} → tracking_code
     *   {{2}} → origin region label (ej. "Metropolitana")
     *   {{3}} → destination region label (ej. "Coquimbo")
     *   {{4}} → public tracking token (UUID v4 opaco)
     *
     * Optional. Mientras Meta aprueba el template (submitted 2026-05-10,
     * SID HXac1ef21ed9423258a2c38dad02f31e41), notify-tracking-link
     * loggea warn y skipea sin afectar el flow de aceptar oferta.
     */
    CONTENT_SID_TRACKING: z.preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
      z
        .string()
        .regex(/^HX[a-fA-F0-9]+$/, 'Debe empezar con HX seguido de hex chars')
        .optional(),
    ),

    /**
     * SA email autorizado a invocar /admin/jobs/* (P3.d Cloud Scheduler
     * cron de fallback WhatsApp). Cloud Scheduler firma OIDC con este SA;
     * el middleware valida claims.email === este valor.
     *
     * Optional para no requerirlo en dev. Si está ausente, los endpoints
     * /admin/jobs/* devuelven 503 disabled.
     */
    INTERNAL_CRON_CALLER_SA: z
      .string()
      .regex(/^[a-z0-9-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com$/, 'SA email inválido')
      .optional(),

    /**
     * API key para Google Routes API (Phase 1 — eco route suggestion).
     *
     * IMPORTANTE: esta key DEBE estar restringida a los servidores de
     * Cloud Run del backend, NO al dominio app.boosterchile.com — Routes
     * API se llama server-to-server, no desde el browser. La restricción
     * en GCP Console → APIs → Credentials → "Booster Routes - API
     * Backend" debe ser por IP o por SA, nunca HTTP referrer.
     *
     * Optional: si está ausente, los servicios que la usan caen al
     * fallback de estimarDistanciaKm (tabla pre-computada Chile) y NO
     * generan sugerencia de eco-route. Útil en dev sin quota Routes API.
     */
    GOOGLE_ROUTES_API_KEY: z.string().min(1).optional(),

    /**
     * API key para Google Gemini API (Phase 3 — coaching IA).
     *
     * Server-side: la usa apps/api en `generar-coaching-viaje.ts` para
     * generar el mensaje de coaching personalizado post-entrega.
     *
     * Optional: si está ausente, el coaching cae al fallback de plantilla
     * determinística de @booster-ai/coaching-generator. El carrier
     * recibe igual feedback útil — la diferencia es solo personalización
     * por contexto del trip.
     *
     * El secret `gemini-api-key` ya existe en Secret Manager (TF
     * security.tf). Cargar con: gcloud secrets versions add gemini-api-key
     * --data-file=<(echo -n "AIza...").
     */
    GEMINI_API_KEY: z.string().min(1).optional(),

    /**
     * Feature flag para activar pricing v2 (ADR-030 + ADR-031).
     *
     * Default por entorno (ADR-031 §2):
     *   - production → `true` (activación inmediata para el primer carrier)
     *   - dev/test/staging → `false` (preservar tests existentes)
     *
     * Comportamiento cuando es `false`:
     *   - `liquidarTrip()` retorna `skipped_flag_disabled` sin tocar BD.
     *   - El cron mensual de cobro de membresías no factura.
     *
     * Comportamiento cuando es `true`:
     *   - El service evalúa carrier_memberships + consent T&Cs v2 antes
     *     de emitir cualquier cobro. Sin consent firmado, las liquidaciones
     *     quedan en `pending_consent` (DTE emisión bloqueada por el carrier,
     *     no por Booster).
     *   - DTE Tipo 33 se emite vía Sovos cuando esté integrado;
     *     mientras tanto las liquidaciones quedan `lista_para_dte`
     *     (auditables, válidas contablemente, sin presentación SII).
     *
     * Override explícito: setear `PRICING_V2_ACTIVATED=false` en Cloud Run
     * env revierte la activación en segundos sin tocar BD ni código.
     */
    PRICING_V2_ACTIVATED: z.coerce.boolean().default(process.env.NODE_ENV === 'production'),

    /**
     * Feature flag para activar factoring v1 / "Booster Cobra Hoy"
     * (ADR-029 + ADR-032). Default por entorno:
     *   - production → `true`
     *   - dev/test/staging → `false`
     *
     * Cuando es `false`:
     *   - `cobraHoy()` retorna `skipped_flag_disabled`.
     *   - Endpoints devuelven 503 con `feature_disabled`.
     *   - UI no muestra botón "Cobra hoy".
     *
     * Cuando es `true`:
     *   - Endpoints operan pero requieren que el shipper tenga
     *     `shipper_credit_decisions.approved=true` vigente. Sin
     *     decisión aprobada → 422 `shipper_no_aprobado`.
     *   - El partner factoring real (Toctoc/Mafin/Increase/Cumplo)
     *     queda diferido — adelantos quedan en `solicitado` hasta
     *     integración del partner.
     */
    FACTORING_V1_ACTIVATED: z.coerce.boolean().default(process.env.NODE_ENV === 'production'),

    /**
     * Allowlist de emails con acceso a endpoints `/admin/cobra-hoy/*`
     * (operadores de Booster Chile SpA, no admins de empresa carrier).
     *
     * Formato CSV: `dev@boosterchile.com,contacto@boosterchile.com`. El
     * helper `requirePlatformAdmin` compara `userContext.user.email` ∈
     * lista; sin match → 403 `forbidden_platform_admin`.
     *
     * Alineado con el Workspace group `admins@boosterchile.com` creado
     * en el sprint IaC hardening (handoff 2026-05-09). Por simpleza
     * mantenemos la fuente de verdad en config (ENV), no en BD ni en
     * custom claims Firebase — son 1-2 humanos hasta TRL 10.
     *
     * Default vacío para que ningún entorno tenga acceso accidental.
     * Cloud Run prod debe setear esta var explícitamente.
     */
    /**
     * ADR-024 — Provider activo para emisión de DTEs (factura comisión
     * Booster al carrier post-liquidación). Valores válidos:
     *   - 'disabled' (default): no se emiten DTEs. Las liquidaciones
     *     quedan `lista_para_dte` indefinidamente. Útil en staging y
     *     mientras no hay creds.
     *   - 'mock': MockDteAdapter — folios sintéticos in-memory. Útil
     *     en dev para validar el flow sin tocar Sovos. Restart del
     *     server pierde la secuencia (no persistente).
     *   - 'sovos': SovosDteAdapter contra Paperless Chile. Exige
     *     SOVOS_API_KEY + SOVOS_BASE_URL.
     */
    DTE_PROVIDER: z.enum(['disabled', 'mock', 'sovos']).default('disabled'),

    /**
     * Sovos credentials (solo se leen cuando `DTE_PROVIDER='sovos'`).
     * Optional para que dev/staging arranque sin estas. Cuando el
     * factory las necesita y faltan, se lanza DteNotConfiguredError.
     */
    SOVOS_API_KEY: z.string().min(1).optional(),
    SOVOS_BASE_URL: z.string().url().optional(),

    /**
     * Datos de Booster Chile SpA como emisor de la factura comisión.
     * Hardcoded por env para no exponerlos en el repo. Se inyectan al
     * SovosAdapter en cada emisión.
     *
     * BOOSTER_RUT debe ser el RUT real registrado en SII (cuando
     * Booster Chile SpA esté constituida) — placeholder en config para
     * dev/staging.
     */
    BOOSTER_RUT: z.string().min(1).default('76.000.000-0'),
    BOOSTER_RAZON_SOCIAL: z.string().min(1).default('Booster Chile SpA'),
    BOOSTER_GIRO: z.string().min(1).default('Marketplace digital de logística'),
    BOOSTER_DIRECCION: z.string().min(1).default('Av. Providencia 1000'),
    BOOSTER_COMUNA: z.string().min(1).default('Providencia'),

    BOOSTER_PLATFORM_ADMIN_EMAILS: z
      .string()
      .default('')
      .transform((s) =>
        s
          .split(',')
          .map((x) => x.trim().toLowerCase())
          .filter(Boolean),
      ),
  });

export type ApiEnv = z.infer<typeof apiEnvSchema>;

export const config: ApiEnv = parseEnv(apiEnvSchema);
