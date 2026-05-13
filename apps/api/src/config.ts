import {
  commonEnvSchema,
  databaseEnvSchema,
  gcpEnvSchema,
  parseEnv,
  redisEnvSchema,
} from '@booster-ai/config';
import { z } from 'zod';

/**
 * Parsea env var boolean correctamente. `z.coerce.boolean()` es un footgun
 * — coerce-ea CUALQUIER string non-empty a `true`, incluyendo "false".
 *
 * Bug descubierto 2026-05-13: `WAKE_WORD_VOICE_ACTIVATED="false"` se
 * coerce-eaba a `true`. Propagó al endpoint /feature-flags y a logic
 * server. Mismo issue afectaba a AUTH_UNIVERSAL_V1_ACTIVATED,
 * MATCHING_ALGORITHM_V2_ACTIVATED, FACTORING_V1_ACTIVATED,
 * PRICING_V2_ACTIVATED.
 *
 * Mapea explícitamente: "true"/"1" → true, "false"/"0"/"" → false,
 * otros (incluyendo undefined) → defaultValue.
 */
function booleanFlag(defaultValue: boolean) {
  return z
    .preprocess((v) => {
      if (typeof v === 'boolean') {
        return v;
      }
      if (typeof v !== 'string') {
        return defaultValue;
      }
      const normalized = v.trim().toLowerCase();
      if (normalized === 'true' || normalized === '1') {
        return true;
      }
      if (normalized === 'false' || normalized === '0' || normalized === '') {
        return false;
      }
      return defaultValue;
    }, z.boolean())
    .default(defaultValue);
}

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
     * GCP project ID — Cloud Run lo setea automáticamente en runtime.
     * Usado para:
     *   - Vertex AI Gemini endpoint (ADR-037, coaching IA post-entrega).
     *   - Header X-Goog-User-Project en Routes API via ADC (ADR-038).
     *
     * Default-required en producción; optional acá porque en tests/dev
     * locales puede no estar definido (los flows caen al fallback
     * determinístico automáticamente sin generar error).
     */
    GOOGLE_CLOUD_PROJECT: z.string().min(1).optional(),

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
    PRICING_V2_ACTIVATED: booleanFlag(process.env.NODE_ENV === 'production'),

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
    FACTORING_V1_ACTIVATED: booleanFlag(process.env.NODE_ENV === 'production'),

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

    /**
     * ADR-033 — Activa el algoritmo de matching v2 (multi-factor con
     * awareness de empty-backhaul). Default `false` en todos los
     * entornos durante rollout inicial.
     *
     * Cuando `false`: el orquestador usa el scoring v1 capacity-only.
     * Cuando `true`: el orquestador hace lookups adicionales (trips
     * activos del carrier, histórico 7d, ofertas 90d, tier) y usa
     * `scoreCandidateV2`. Ambos algoritmos coexisten — flag flip es
     * reversible sin redeploy.
     *
     * Rollout plan:
     *   1. PRs 1-4 mergeados con flag=false default.
     *   2. Backtest sobre 30d de staging — si delta favorable, flag=true en staging por 7d.
     *   3. Si métricas siguen estables, flag=true en prod.
     */
    MATCHING_ALGORITHM_V2_ACTIVATED: booleanFlag(false),

    /**
     * ADR-035 (Wave 4) — Feature flag para activar el flow universal
     * RUT + clave numérica en `/login`.
     *
     * Cuando `false` (default): `/login` muestra el form email/password
     * legacy. `/auth/login-rut` queda live pero el frontend no lo usa.
     *
     * Cuando `true`: `/login` muestra el selector de tipo de usuario +
     * form RUT+clave. `/login/conductor` redirige a `/login?tipo=conductor`.
     *
     * Rollout:
     *   1. PR 1 (backend foundation, este branch): flag=false default.
     *      Endpoint vivo, sin uso desde UI.
     *   2. PR 2 (frontend selector): flag=false default. Smoke staging
     *      con flag=true. Si OK, flag=true en prod.
     *   3. PR 3 (migración 30d): forzar rotación al login siguiente.
     */
    AUTH_UNIVERSAL_V1_ACTIVATED: booleanFlag(false),

    /**
     * ADR-036 (Wave 5) — Feature flag para wake-word "Oye Booster" en
     * el conductor. Default OFF. Cuando `true`:
     *   - La card "Activación por voz" en /app/conductor/configuracion
     *     es activa (toggle real, no "próximamente").
     *   - El usuario puede opt-in para que su PWA escuche el wake-word
     *     "Oye Booster" cuando el vehículo está detenido.
     *
     * El listener Porcupine es on-device (WASM); el audio del wake-word
     * NO sale del teléfono. Solo cuando se detecta la frase, el audio
     * del comando subsecuente se envía a Booster para procesar.
     *
     * Rollout: false en prod hasta que el modelo custom
     * `oye-booster-cl.ppn` esté entrenado con voces chilenas (Wave 5 PR 2).
     */
    WAKE_WORD_VOICE_ACTIVATED: booleanFlag(false),

    /**
     * ADR-033 §1 — Pesos custom para los componentes del scoring v2.
     * JSON con shape `{ capacidad: number; backhaul: number;
     * reputacion: number; tier: number }`. Suma debe ser ≈ 1.0
     * (validado runtime por validateWeights).
     *
     * Si la env var está vacía o malformada → se usan
     * `DEFAULT_WEIGHTS_V2` (0.40/0.35/0.15/0.10). Errores de parsing
     * loggean WARN y no rompen el startup — preferimos fallback a
     * defaults conocidos antes que crashear.
     *
     * Útil para A/B testing de pesos post-launch sin redeploy.
     */
    MATCHING_V2_WEIGHTS_JSON: z.string().default(''),

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
