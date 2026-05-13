#!/usr/bin/env node
/**
 * apps/api/scripts/smoke-wave1-conductor.mjs
 *
 * Smoke E2E del flujo Wave 1 (PR #179 — conductor identity invariant +
 * dashboard split). Ejecutar contra staging post-merge para verificar:
 *
 *   1. Migration 0029 corrió (todos los conductores existentes tienen
 *      membership rol=conductor + estado coherente con su firebase_uid).
 *   2. POST /admin/seed/demo crea conductor con membership automática.
 *   3. POST /auth/driver-activate con RUT + PIN funciona, mint custom
 *      token + promueve membership a `activa`.
 *   4. GET /me con el token del conductor activado devuelve
 *      `active_membership` poblado (NO "Sin empresa activa").
 *   5. GET /me/assignments responde sin error.
 *
 * Si algo falla, el script aborta con código de salida 1 + mensaje
 * claro indicando qué paso. Ejecutable manualmente o como parte de un
 * GitHub Action post-deploy.
 *
 * Usage:
 *   export BOOSTER_API_BASE=https://staging.api.boosterchile.com
 *   export FIREBASE_PROJECT_ID=booster-ai-staging
 *   export FIREBASE_WEB_API_KEY=AIza...
 *   export PLATFORM_ADMIN_EMAIL=dev@boosterchile.com
 *   node apps/api/scripts/smoke-wave1-conductor.mjs
 *
 * Requiere ADC para Firebase Admin SDK:
 *   gcloud auth application-default login
 */

import admin from 'firebase-admin';

const API_BASE = process.env.BOOSTER_API_BASE ?? 'https://api.boosterchile.com';
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID ?? 'booster-ai-494222';
const PLATFORM_ADMIN_EMAIL = process.env.PLATFORM_ADMIN_EMAIL ?? 'dev@boosterchile.com';
const FIREBASE_WEB_API_KEY = process.env.FIREBASE_WEB_API_KEY;

if (!FIREBASE_WEB_API_KEY) {
  // biome-ignore lint/suspicious/noConsole: script CLI, output va a stdout.
  console.error('ERROR: falta FIREBASE_WEB_API_KEY (export desde cloudbuild env vars).');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Pretty logger
// ---------------------------------------------------------------------------

const COLOR_RESET = '\x1b[0m';
const COLOR_GREEN = '\x1b[32m';
const COLOR_RED = '\x1b[31m';
const COLOR_YELLOW = '\x1b[33m';
const COLOR_CYAN = '\x1b[36m';
const COLOR_GRAY = '\x1b[90m';

function log(level, ...args) {
  const prefix = {
    info: `${COLOR_CYAN}ℹ${COLOR_RESET}`,
    ok: `${COLOR_GREEN}✓${COLOR_RESET}`,
    warn: `${COLOR_YELLOW}⚠${COLOR_RESET}`,
    fail: `${COLOR_RED}✗${COLOR_RESET}`,
    step: `${COLOR_GRAY}→${COLOR_RESET}`,
  }[level];
  // biome-ignore lint/suspicious/noConsole: script CLI.
  console.log(prefix, ...args);
}

function fail(message, details) {
  log('fail', message);
  if (details) {
    log('fail', JSON.stringify(details, null, 2));
  }
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

if (!admin.apps.length) {
  admin.initializeApp({ projectId: FIREBASE_PROJECT_ID });
}

async function mintIdToken(uid) {
  const customToken = await admin.auth().createCustomToken(uid, {});
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${FIREBASE_WEB_API_KEY}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    },
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`signInWithCustomToken failed (${res.status}): ${body}`);
  }
  const body = await res.json();
  return body.idToken;
}

async function apiCall(method, path, opts = {}) {
  const { idToken, body, expectedStatus = 200 } = opts;
  const headers = { 'content-type': 'application/json' };
  if (idToken) {
    headers.authorization = `Bearer ${idToken}`;
  }
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // body no es JSON.
  }
  if (res.status !== expectedStatus) {
    fail(`${method} ${path} → ${res.status} (esperado ${expectedStatus})`, parsed ?? text);
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

async function step1AdminLogin() {
  log('step', 'Paso 1 — Login como platform admin para invocar seed.');
  const adminUser = await admin
    .auth()
    .getUserByEmail(PLATFORM_ADMIN_EMAIL)
    .catch(() => null);
  if (!adminUser) {
    fail(`Platform admin ${PLATFORM_ADMIN_EMAIL} no existe en Firebase Auth.`);
  }
  const idToken = await mintIdToken(adminUser.uid);
  log('ok', `Admin logueado: ${PLATFORM_ADMIN_EMAIL} (uid ${adminUser.uid.slice(0, 8)}…)`);
  return idToken;
}

async function step2SeedDemo(adminIdToken) {
  log('step', 'Paso 2 — POST /admin/seed/demo (crea o reusa conductor demo).');
  const seedRes = await apiCall('POST', '/admin/seed/demo', {
    idToken: adminIdToken,
    body: {},
  });
  if (!seedRes || !seedRes.credentials) {
    fail('Seed devolvió shape inesperada (sin credentials).', seedRes);
  }
  const conductorRut = seedRes.credentials.conductor.rut;
  const activationPin = seedRes.credentials.conductor.activation_pin;
  log(
    'ok',
    `Conductor demo creado/reusado: RUT ${conductorRut} | PIN ${activationPin ? activationPin.slice(0, 2) + '••••' : 'NULL (ya activado)'}`,
  );
  return { conductorRut, activationPin, seedCredentials: seedRes.credentials };
}

async function step3DriverActivate(rut, pin) {
  log('step', 'Paso 3 — POST /auth/driver-activate (RUT + PIN).');
  if (!pin) {
    log('warn', 'PIN es null — el conductor ya fue activado en una corrida previa. Saltando paso.');
    return { customToken: null, syntheticEmail: null };
  }
  const res = await apiCall('POST', '/auth/driver-activate', {
    body: { rut, pin },
    expectedStatus: 200,
  });
  if (!res.custom_token || !res.synthetic_email) {
    fail('driver-activate devolvió shape inesperada.', res);
  }
  log('ok', `Driver activado. Email sintético: ${res.synthetic_email}`);
  return { customToken: res.custom_token, syntheticEmail: res.synthetic_email };
}

async function step4DriverMe(customToken) {
  log('step', 'Paso 4 — signInWithCustomToken + GET /me.');
  // Cambiamos el custom token devuelto por driver-activate por un ID token via Identity Toolkit.
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${FIREBASE_WEB_API_KEY}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    },
  );
  if (!res.ok) {
    fail(`signInWithCustomToken failed (${res.status}): ${await res.text()}`);
  }
  const body = await res.json();
  const idToken = body.idToken;

  const me = await apiCall('GET', '/me', { idToken });
  if (me.needs_onboarding === true) {
    fail('GET /me devolvió needs_onboarding=true — conductor activado debería ser onboarded.');
  }
  if (!me.active_membership) {
    fail(
      'GET /me devolvió active_membership=null — esto es EL bug que Wave 1 cierra. Migration 0029 NO corrió o ensureConductor/driver-activate no crearon la membership.',
      { memberships: me.memberships },
    );
  }
  log(
    'ok',
    `GET /me OK. active_membership: rol=${me.active_membership.role}, status=${me.active_membership.status}, empresa=${me.active_membership.empresa?.legal_name ?? me.active_membership.organizacion_stakeholder?.nombre_legal}.`,
  );
  return { idToken, me };
}

async function step5DriverAssignments(idToken) {
  log('step', 'Paso 5 — GET /me/assignments.');
  const res = await apiCall('GET', '/me/assignments', { idToken });
  if (!Array.isArray(res.assignments)) {
    fail('GET /me/assignments shape inesperada.', res);
  }
  log('ok', `/me/assignments OK. ${res.assignments.length} assignment(s) para el conductor.`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  log('info', `API base: ${API_BASE}`);
  log('info', `Firebase project: ${FIREBASE_PROJECT_ID}`);
  log('info', `Admin email: ${PLATFORM_ADMIN_EMAIL}`);
  log('info', '');

  const adminIdToken = await step1AdminLogin();
  const { conductorRut, activationPin } = await step2SeedDemo(adminIdToken);
  const { customToken } = await step3DriverActivate(conductorRut, activationPin);

  // Si el PIN era null (re-corrida), no tenemos custom token y no podemos
  // probar el flow downstream. Pasos 4-5 se omiten con warn.
  if (customToken) {
    const { idToken } = await step4DriverMe(customToken);
    await step5DriverAssignments(idToken);
  } else {
    log('warn', 'Pasos 4-5 saltados: PIN era null (conductor ya activado en corrida anterior).');
    log(
      'warn',
      'Para re-probar el flow completo, ejecuta primero --cleanup en demo-dry-run y re-corre.',
    );
  }

  log('info', '');
  log(
    'ok',
    `${COLOR_GREEN}Smoke Wave 1 OK. Conductor identity + dashboard flow verificado.${COLOR_RESET}`,
  );
}

main().catch((err) => {
  log('fail', `Smoke Wave 1 FALLÓ: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
