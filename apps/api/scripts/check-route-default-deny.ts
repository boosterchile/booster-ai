#!/usr/bin/env tsx
/**
 * T2 / SC-G1b — harness CI default-deny (spec sec-001-h1-2-google-boundary-closure T15).
 *
 * Reemplaza el backstop creation-time (la blocking function, ADR-054 →
 * superseded por ADR-057) por una **invariante de wiring durable**: cada
 * ruta montada en `apps/api/src/server.ts` DEBE estar clasificada. Si
 * aparece un mount nuevo sin clasificar, el build FALLA (exit 1) — forzando
 * a un humano a auditar y clasificar cada ruta nueva antes de que llegue a
 * `main`.
 *
 * Diseño (resuelve la objeción P1-1 del DA R2): el check de referencia
 * `check-is-demo-wire-completeness.ts` escanea SOLO `app.use('/path', …)`
 * (line-based) → NO ve `app.route()` ni los sub-mounts `<router>.route()`,
 * que es exactamente donde viven las rutas privilegio-relevantes fuera de
 * userContext (`meRouter.route('/consents', …)`, `meRouter.route('/',
 * …clave-numerica)`). Este harness clasifica **por factory** `create*Routes`
 * / `*Router` — la clave única y estable de cada mount — vía enumeración
 * multi-línea (no line-based; grep perdía ~14 mounts).
 *
 * Invariantes verificadas (cualquiera falla → exit 1):
 *   1. default-deny: todo factory/router enumerado en un `.route()` está en
 *      ROUTE_CLASSIFICATION (mount nuevo sin clasificar → fail). [T15]
 *   2. no-stale: toda entrada de ROUTE_CLASSIFICATION sigue montada en
 *      server.ts (la tabla no oculta rutas removidas).
 *   3. rationale: toda entrada NO-ENFORCED tiene rationale no vacío (la
 *      excepción a userContext exige justificación por entrada).
 *
 * La tabla ROUTE_CLASSIFICATION proviene del audit T1 (`route-boundary-audit.md`).
 *
 * Ejecución directa:
 *   pnpm --filter @booster-ai/api exec tsx scripts/check-route-default-deny.ts
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SERVER_FILE = new URL('../src/server.ts', import.meta.url).pathname;

/**
 * Categorías del boundary (SC-G1, definiciones estrictas del audit T1):
 * - ENFORCED: userContext (fila `users` resuelta) precede el mount.
 * - GATED-CLOSED: bare firebaseAuth, pero el handler niega/no-opera para un
 *   token no-provisionado (resolución por `firebase_uid` → 404, allowlist, o flag).
 * - INTENTIONAL-OPEN: público por diseño; no sirve datos sensibles ni otorga privilegio.
 * - INTERNAL: auth de servicio (OIDC SA) o cron (no end-user).
 * - MIXED: el mount combina sub-paths públicos read-only + auth-required (rationale obligatorio).
 */
export type RouteCategory = 'ENFORCED' | 'GATED-CLOSED' | 'INTENTIONAL-OPEN' | 'INTERNAL' | 'MIXED';

export interface RouteMount {
  path: string;
  /** Factory (`create*`) o router-var (`meRouter`/`assignmentsRouter`/`chatRouter`). */
  key: string;
}

export interface RouteClassificationEntry {
  category: RouteCategory;
  /** Justificación por entrada. Vacío SOLO permitido para ENFORCED (userContext precede). */
  rationale: string;
}

/**
 * Clasificación de cada factory/router montado en server.ts. Default-deny:
 * lo que no esté acá rompe el build. ENFORCED no requiere rationale (la
 * propiedad la da el userContext en el chain); el resto sí.
 */
export const ROUTE_CLASSIFICATION: Record<string, RouteClassificationEntry> = {
  // --- ENFORCED (userContext precede el mount) ---
  createMePushSubscriptionRoutes: { category: 'ENFORCED', rationale: '' },
  createCobraHoyMeRoutes: { category: 'ENFORCED', rationale: '' },
  createMeLiquidacionesRoutes: { category: 'ENFORCED', rationale: '' },
  createTripRequestsV2Routes: { category: 'ENFORCED', rationale: '' },
  createOfferRoutes: { category: 'ENFORCED', rationale: '' },
  createCobraHoyAssignmentsRoutes: { category: 'ENFORCED', rationale: '' },
  createAdminDispositivosRoutes: { category: 'ENFORCED', rationale: '' },
  createAdminCobraHoyRoutes: { category: 'ENFORCED', rationale: '' },
  createAdminStakeholderOrgsRoutes: { category: 'ENFORCED', rationale: '' },
  createAdminSignupRequestsRoutes: { category: 'ENFORCED', rationale: '' },
  createSiteSettingsRoutes: { category: 'ENFORCED', rationale: '' },
  createAdminSeedRoutes: { category: 'ENFORCED', rationale: '' },
  createAdminMatchingBacktestRoutes: { category: 'ENFORCED', rationale: '' },
  createAdminObservabilityRoutes: { category: 'ENFORCED', rationale: '' },
  createVehiculosRoutes: { category: 'ENFORCED', rationale: '' },
  createConductoresRoutes: { category: 'ENFORCED', rationale: '' },
  createSucursalesRoutes: { category: 'ENFORCED', rationale: '' },
  createDocumentosRoutes: { category: 'ENFORCED', rationale: '' },
  createCumplimientoRoutes: { category: 'ENFORCED', rationale: '' },
  // Router-vars montados bajo /assignments (userContext en app.use('/assignments/*', …)).
  assignmentsRouter: { category: 'ENFORCED', rationale: '' },
  chatRouter: { category: 'ENFORCED', rationale: '' },
  // Repositorio documental de transporte (ADR-070, F4-4a): firebaseAuth +
  // userContext preceden el mount vía app.use('/transport-orders/*', …) y
  // app.use('/documents/*', …); la autorización por tenant (shipper-owner |
  // carrier-assigned) la resuelve cada handler.
  transportDocsRouter: { category: 'ENFORCED', rationale: '' },

  // --- GATED-CLOSED (bare firebaseAuth, gate in-handler) ---
  meRouter: {
    category: 'GATED-CLOSED',
    rationale:
      'createMeRoutes (root /me): resuelve userId por firebase_uid; account-link y auto-provision platform-admin gateados por allowlist BOOSTER_PLATFORM_ADMIN_EMAILS (default-vacío). Sin fila/allowlist → no-op.',
  },
  createMeConsentsRoutes: {
    category: 'GATED-CLOSED',
    rationale:
      'sub-mount /me/consents: resuelve userId por firebase_uid → 404 si no hay fila users.',
  },
  createStakeholderZonasRoutes: {
    category: 'GATED-CLOSED',
    rationale:
      'sub-mount /me/stakeholder (geo aggregations, gap B2/D11): resuelve userId por firebase_uid → 404 si no hay fila; exige membership rol stakeholder_sostenibilidad activa → 403; gate k-anon dataset-level (total<5 → insufficient_data). TODO consent-scope (ADR-028 no modela zona).',
  },
  createMeClaveNumericaRoutes: {
    category: 'GATED-CLOSED',
    rationale:
      'sub-mount /me (clave-numérica): resuelve userId por firebase_uid → 404 si no hay fila.',
  },
  createEmpresaRoutes: {
    category: 'GATED-CLOSED',
    rationale:
      'self-serve OFF: flag EMPRESA_SELF_ONBOARDING_ENABLED default-false unset en prod → 403 + invariante SelfOnboardingDisabledError. Único caller usa authorizedBy=self_service; no hay path admin_provisioned reachable.',
  },

  // --- INTENTIONAL-OPEN (público por diseño; verificado línea-a-línea al codear T2) ---
  createHealthRouter: {
    category: 'INTENTIONAL-OPEN',
    rationale: 'liveness/ready probe; sin datos.',
  },
  createHealthSignupFlowRouter: {
    category: 'INTENTIONAL-OPEN',
    rationale: 'health del signup-flow para el synthetic monitor; sin DB ni datos.',
  },
  createFeatureFlagsRoutes: {
    category: 'INTENTIONAL-OPEN',
    rationale: 'flags públicos leídos en boot pre-login para decidir UI (ADR-035/036).',
  },
  createSignupRequestRoutes: {
    category: 'INTENTIONAL-OPEN',
    rationale:
      'submission pública (ADR-052); rate-limited; 202 anti-enumeration; no otorga acceso.',
  },
  createPublicSiteSettingsRoutes: {
    category: 'INTENTIONAL-OPEN',
    rationale: 'versión publicada de site-settings, read-only, cache 5min (ADR-039).',
  },
  createPublicTrackingRoutes: {
    category: 'INTENTIONAL-OPEN',
    rationale:
      'tracking público: defensa = opacidad del token UUID v4 (122 bits, no enumerable); datos restringidos, read-only. Verificado: sin app.use de auth precediéndolo.',
  },
  createWebpushPublicRoutes: {
    category: 'INTENTIONAL-OPEN',
    rationale:
      'VAPID public key (identidad del sender, no secreto). Verificado: sin app.use de auth precediéndolo.',
  },
  createAuthUniversalRoutes: {
    category: 'INTENTIONAL-OPEN',
    rationale:
      'emisor de auth (/auth/login-rut mint custom token; no requiere firebase previa). Verificado: sin app.use de auth precediéndolo.',
  },
  createDriverAuthRoutes: {
    category: 'INTENTIONAL-OPEN',
    rationale:
      'emisor de auth driver (/auth/driver-activate; driver aún sin Firebase user; rate-limit-pin inline). Verificado: sin app.use de auth precediéndolo.',
  },
  createDemoLoginRoutes: {
    category: 'INTENTIONAL-OPEN',
    rationale:
      'login demo (mint custom token; doble guard flag DEMO_MODE_ACTIVATED + es_demo). Verificado: sin app.use de auth precediéndolo.',
  },
  createDemoCacheWarmRoutes: {
    category: 'INTENTIONAL-OPEN',
    rationale:
      'pre-warm de cache demo, IP rate-limited inline (10/min/IP). Verificado: sin app.use de auth precediéndolo.',
  },

  // --- MIXED ---
  createCertificatesRoutes: {
    category: 'MIXED',
    rationale:
      'mount con userContext (resto) + skip-auth wrapper para GET /certificates/:t/verify (público read-only por diseño, ADR-015). Ver server.ts skipAuthForVerify.',
  },

  // --- INTERNAL (auth de servicio / cron, no end-user) ---
  createTripRequestsRoutes: {
    category: 'INTERNAL',
    rationale: 'service-to-service: OIDC SA authMiddleware (ALLOWED_CALLER_SA).',
  },
  createAdminJobsRoutes: {
    category: 'INTERNAL',
    rationale: 'cron: Cloud Scheduler OIDC (cronAuthMiddleware, INTERNAL_CRON_CALLER_SA).',
  },
  createInternalSafetyEventsRoutes: {
    category: 'INTERNAL',
    rationale:
      'Pub/Sub push: OIDC SA auth inline (SAFETY_PUSH_CALLER_SA); fail-closed si SA no configurado. No usa firebaseAuthMiddleware ni userContext.',
  },
};

/**
 * Enumera todos los mounts `.route(path, <handler>)` de un source. Multi-línea
 * (no line-based). Captura `app.route(...)` y los sub-mounts `<router>.route(...)`.
 *
 * REVIEW finding A: la `key` es **cualquier identificador** del 2º argumento (no
 * solo `create*`/`*Router`). Antes el regex solo reconocía esas dos convenciones
 * de naming → un mount con handler nombrado distinto (`billingRoutes`) NO se
 * enumeraba → NO disparaba default-deny → pasaba el build sin clasificar (falsa
 * cobertura). Ahora todo `.route(path, <id>)` se enumera; lo no clasificado falla.
 * Para `createX(...)` captura `createX`; para `meRouter` captura `meRouter`.
 */
export function enumerateRouteMounts(source: string): RouteMount[] {
  const pattern = /\.route\(\s*['"]([^'"]+)['"]\s*,\s*([A-Za-z_$][A-Za-z0-9_$]*)/g;
  const mounts: RouteMount[] = [];
  let match: RegExpExecArray | null = pattern.exec(source);
  while (match !== null) {
    const path = match[1] as string;
    const key = match[2] as string;
    mounts.push({ path, key });
    match = pattern.exec(source);
  }
  return mounts;
}

/**
 * Detecta rutas inline `app.<method>('path', …)` (get/post/put/patch/delete/
 * options/head/all). REVIEW finding A: estas NO pasan por un factory clasificado,
 * así que el default-deny por factory no las ve. Si aparece alguna, el build
 * FALLA — toda ruta de negocio debe montarse vía un factory en ROUTE_CLASSIFICATION
 * (o, si se decide permitir inline, clasificarla explícitamente acá primero).
 */
export function findInlineMethodRoutes(source: string): string[] {
  const pattern = /\bapp\.(get|post|put|patch|delete|options|head|all)\(\s*['"]([^'"]+)['"]/g;
  const found: string[] = [];
  let match: RegExpExecArray | null = pattern.exec(source);
  while (match !== null) {
    found.push(`app.${match[1]}('${match[2]}')`);
    match = pattern.exec(source);
  }
  return found;
}

/** Keys enumerados en server.ts que NO están en la clasificación (default-deny → fail). */
export function findUnclassifiedMounts(
  source: string,
  classification: Record<string, RouteClassificationEntry>,
): string[] {
  const seen = new Set<string>();
  const unclassified: string[] = [];
  for (const { key } of enumerateRouteMounts(source)) {
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    if (!(key in classification)) {
      unclassified.push(key);
    }
  }
  return unclassified;
}

/** Keys de la clasificación que ya NO se montan en server.ts (tabla stale → fail). */
export function findStaleClassifications(
  source: string,
  classification: Record<string, RouteClassificationEntry>,
): string[] {
  const mounted = new Set(enumerateRouteMounts(source).map((m) => m.key));
  return Object.keys(classification).filter((key) => !mounted.has(key));
}

/** Entradas NO-ENFORCED sin rationale (la excepción a userContext exige justificación). */
export function findMissingRationale(
  classification: Record<string, RouteClassificationEntry>,
): string[] {
  return Object.entries(classification)
    .filter(([, entry]) => entry.category !== 'ENFORCED' && entry.rationale.trim() === '')
    .map(([key]) => key);
}

export interface RouteEvaluation {
  ok: boolean;
  totalMounts: number;
  unclassified: string[];
  stale: string[];
  missingRationale: string[];
  inlineRoutes: string[];
}

/**
 * Evalúa las 4 invariantes contra un source + clasificación. Pura (sin IO):
 * el grueso de la lógica del check, testeable sin tocar disco ni process.exit.
 */
export function evaluateRoutes(
  source: string,
  classification: Record<string, RouteClassificationEntry>,
): RouteEvaluation {
  const unclassified = findUnclassifiedMounts(source, classification);
  const stale = findStaleClassifications(source, classification);
  const missingRationale = findMissingRationale(classification);
  const inlineRoutes = findInlineMethodRoutes(source);
  return {
    ok:
      unclassified.length === 0 &&
      stale.length === 0 &&
      missingRationale.length === 0 &&
      inlineRoutes.length === 0,
    totalMounts: enumerateRouteMounts(source).length,
    unclassified,
    stale,
    missingRationale,
    inlineRoutes,
  };
}

function main(): void {
  const source = readFileSync(SERVER_FILE, 'utf-8');
  const { ok, totalMounts, unclassified, stale, missingRationale, inlineRoutes } = evaluateRoutes(
    source,
    ROUTE_CLASSIFICATION,
  );

  if (inlineRoutes.length > 0) {
    console.error(
      '\n[check-route-default-deny] FAIL — rutas inline app.<method>() sin pasar por un factory clasificado:',
    );
    for (const r of inlineRoutes) {
      console.error(`  - ${r}`);
    }
    console.error(
      '\nFix: montar la ruta vía un factory create*Routes y clasificarlo en ROUTE_CLASSIFICATION (el default-deny por factory no ve rutas inline).',
    );
  }

  if (unclassified.length > 0) {
    console.error('[check-route-default-deny] FAIL — mounts nuevos sin clasificar (default-deny):');
    for (const key of unclassified) {
      console.error(`  - ${key}`);
    }
    console.error(
      '\nFix: clasificar cada factory/router en ROUTE_CLASSIFICATION (ENFORCED si userContext precede; si no, GATED-CLOSED/INTENTIONAL-OPEN/INTERNAL/MIXED con rationale). Auditar el middleware chain ANTES de clasificar.',
    );
  }

  if (stale.length > 0) {
    console.error(
      '\n[check-route-default-deny] FAIL — entradas de ROUTE_CLASSIFICATION ya no montadas (tabla stale):',
    );
    for (const key of stale) {
      console.error(`  - ${key}`);
    }
    console.error('\nFix: remover las entradas obsoletas de ROUTE_CLASSIFICATION.');
  }

  if (missingRationale.length > 0) {
    console.error('\n[check-route-default-deny] FAIL — entradas no-ENFORCED sin rationale:');
    for (const key of missingRationale) {
      console.error(`  - ${key}`);
    }
    console.error('\nFix: agregar rationale por entrada (justifica la excepción a userContext).');
  }

  if (!ok) {
    process.exit(1);
  }

  console.log(
    `[check-route-default-deny] OK — ${totalMounts} mounts (${Object.keys(ROUTE_CLASSIFICATION).length} factories/routers únicos) clasificados en server.ts; cero sin clasificar, cero stale.`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
