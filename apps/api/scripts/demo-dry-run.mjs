#!/usr/bin/env node
/**
 * apps/api/scripts/demo-dry-run.mjs
 *
 * Dry-run end-to-end del flujo demo de Booster AI, contra la API real
 * de producción (api.boosterchile.com). Pensado como "smoke test
 * operacional" antes de un pitch importante (ej. Corfo) — verifica que
 * todo el pipeline de matching → ofertas → asignación → telemetría →
 * cierre → certificado funcione end-to-end con un usuario sintético.
 *
 * No es un test automatizado de CI (no tiene assertions estrictas),
 * es una herramienta de verificación manual. La idea: ejecutarlo,
 * mirar el output paso a paso, identificar dónde algo se ve raro,
 * arreglarlo antes de la demo real.
 *
 * Requiere:
 *   - `gcloud auth application-default login` previo (ADC para Firebase
 *     Admin SDK).
 *   - El usuario logueado debe estar en `BOOSTER_PLATFORM_ADMIN_EMAILS`
 *     (sino el POST /admin/seed/demo devolverá 403).
 *   - `FIREBASE_WEB_API_KEY` exportada (la pública, embebida en la PWA).
 *     Sacar de `cloudbuild.production.yaml > _VITE_FIREBASE_API_KEY`.
 *
 * Uso:
 *   export FIREBASE_WEB_API_KEY=AIza...
 *   node apps/api/scripts/demo-dry-run.mjs                # ejecuta flujo
 *   node apps/api/scripts/demo-dry-run.mjs --cleanup      # solo limpia
 *   node apps/api/scripts/demo-dry-run.mjs --keep-data    # no limpia al final
 *
 * Default behavior: ejecuta el flujo completo y NO limpia al final
 * (deja datos cargados para que el operador pueda navegar la UI con
 * data real). Usar `--cleanup` para borrar después.
 */

import crypto from 'node:crypto';
import admin from 'firebase-admin';

// ----------------------------------------------------------------------------
// Config
// ----------------------------------------------------------------------------

const API_BASE = process.env.BOOSTER_API_BASE ?? 'https://api.boosterchile.com';
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID ?? 'booster-ai-494222';
const PLATFORM_ADMIN_EMAIL = process.env.PLATFORM_ADMIN_EMAIL ?? 'dev@boosterchile.com';

// La Firebase Web API key se lee de env. Es pública (la PWA la embebe en el
// bundle JS), pero por higiene de gitleaks la dejamos fuera del source.
// Obtener desde: cloudbuild.production.yaml > _VITE_FIREBASE_API_KEY.
const FIREBASE_WEB_API_KEY = process.env.FIREBASE_WEB_API_KEY;
if (!FIREBASE_WEB_API_KEY) {
  console.error(
    'FIREBASE_WEB_API_KEY no está seteada. Exportala desde cloudbuild.production.yaml o pásala inline:\n' +
      '  FIREBASE_WEB_API_KEY=AIza... node apps/api/scripts/demo-dry-run.mjs',
  );
  process.exit(1);
}

const args = process.argv.slice(2);
const ONLY_CLEANUP = args.includes('--cleanup');
const KEEP_DATA = args.includes('--keep-data');

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function log(emoji, label, detail) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${emoji}  ${label}${detail ? ` — ${detail}` : ''}`);
}

function fail(label, err) {
  console.error(`\n❌  ${label}`);
  console.error(err);
  process.exit(1);
}

async function exchangeCustomTokenForIdToken(customToken) {
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
    throw new Error(`exchange custom token failed: ${res.status} ${body}`);
  }
  const data = await res.json();
  return data.idToken;
}

async function signInWithEmailPassword(email, password) {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_WEB_API_KEY}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`sign-in failed for ${email}: ${res.status} ${body}`);
  }
  const data = await res.json();
  return data.idToken;
}

async function apiCall(method, path, opts = {}) {
  const headers = {
    'content-type': 'application/json',
    ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
    ...(opts.empresaId ? { 'x-empresa-id': opts.empresaId } : {}),
  };
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
  });
  const text = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed };
}

// ----------------------------------------------------------------------------
// Phases
// ----------------------------------------------------------------------------

async function getPlatformAdminToken() {
  log('🔑', 'Phase 0: token de platform-admin');
  // Estrategia: setear un password temporal vía Admin SDK (NO requiere
  // signBlob, sólo el `firebase.identityToolkit` scope que viene con
  // ADC) y autenticar con email+password vía Identity Toolkit REST.
  // Si usáramos createCustomToken haría falta una SA con signBlob — más
  // setup operacional para un script one-off.
  const tempPassword = `DryRun${Date.now()}!`;
  let userRecord;
  try {
    userRecord = await admin.auth().getUserByEmail(PLATFORM_ADMIN_EMAIL);
    log('  ✓', 'user existente en Firebase', userRecord.uid);
    await admin.auth().updateUser(userRecord.uid, { password: tempPassword });
    log('  ✓', 'password temporal seteado (rotará al final del script)');
  } catch (err) {
    if (err.code === 'auth/user-not-found') {
      userRecord = await admin.auth().createUser({
        email: PLATFORM_ADMIN_EMAIL,
        password: tempPassword,
        emailVerified: true,
      });
      log('  +', 'user creado en Firebase con password temporal', userRecord.uid);
    } else {
      throw err;
    }
  }
  const idToken = await signInWithEmailPassword(PLATFORM_ADMIN_EMAIL, tempPassword);
  log('  ✓', 'ID token obtenido vía email+password');
  return { idToken, uid: userRecord.uid };
}

async function rotateAdminPassword(uid) {
  // Por seguridad: tras el script, dejamos el password en algo random
  // que el operador real no conozca (de todos modos Felipe se loguea
  // con OAuth Google, no password). Sino el script siguiente reescribe
  // el password y queda un valor conocido en logs.
  const randomPassword = `Rotated${crypto.randomUUID()}!`;
  await admin.auth().updateUser(uid, { password: randomPassword });
}

async function ensureUserRecord(adminToken, email) {
  // Si el user no existe en la BD local del API (creado por Firebase pero
  // no por el endpoint /me que se llama típicamente al hacer login en la
  // UI), el seed igual debería tolerarlo. Acá solo verificamos.
  const me = await apiCall('GET', '/me', { token: adminToken });
  if (me.status === 200) {
    log('  ✓', 'user existe en BD local', email);
  } else {
    log('  !', `user no existe en BD aún (${me.status}) — el seed lo crea`);
  }
}

async function runSeed(adminToken) {
  log('🌱', 'Phase 1: seed demo');
  const res = await apiCall('POST', '/admin/seed/demo', {
    token: adminToken,
    body: {},
  });
  if (res.status !== 200) {
    fail('seed-demo POST', res);
  }
  log('  ✓', 'seed ejecutado', JSON.stringify(res.body.credentials, null, 2).slice(0, 300));
  return res.body.credentials;
}

async function runDeleteDemo(adminToken) {
  log('🧹', 'Phase X: delete demo');
  const res = await apiCall('DELETE', '/admin/seed/demo', { token: adminToken });
  if (res.status !== 200) {
    fail('delete-demo', res);
  }
  log(
    '  ✓',
    'delete completo',
    `empresas=${res.body.empresas_eliminadas} viajes=${res.body.viajes_eliminados}`,
  );
}

async function createTrip(shipperToken) {
  log('🚛', 'Phase 2: shipper crea viaje');
  // Ventana de pickup: empieza en 2h, dura 24h. Cumple validación
  // MIN_PICKUP_LEAD_MS (30 min) y MAX_PICKUP_WINDOW_MS (30 días).
  const startAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  const endAt = new Date(Date.now() + 26 * 60 * 60 * 1000).toISOString();

  const body = {
    origin: {
      address_raw: 'Av. Pajaritos 1234, Maipú',
      region_code: 'XIII',
    },
    destination: {
      address_raw: 'Av. Brasil 2345, Valparaíso',
      region_code: 'V',
    },
    cargo: {
      cargo_type: 'carga_seca',
      weight_kg: 5_000,
      volume_m3: 12,
      description: 'Demo Corfo — 200 cajas insumos industriales',
    },
    pickup_window: { start_at: startAt, end_at: endAt },
    proposed_price_clp: 480_000,
  };

  const res = await apiCall('POST', '/trip-requests-v2', { token: shipperToken, body });
  if (res.status !== 200 && res.status !== 201) {
    fail('create trip', res);
  }
  const trip = res.body.trip_request;
  const matching = res.body.matching;
  log('  ✓', 'trip creado', `id=${trip.id} status=${trip.status} tracking=${trip.tracking_code}`);
  if (matching) {
    log(
      '  ✓',
      'matching disparado',
      `candidates=${matching.candidates_evaluated} offers=${matching.offers_created}`,
    );
    if (matching.offers_created === 0) {
      log(
        '  ⚠',
        'matching produjo 0 ofertas — investigar (carrier sin zona / sin vehículo apto / no transportistas)',
      );
    }
  }
  return { trip, matching };
}

async function acceptOffer(carrierToken, offerId, carrierEmpresaId, overrideVehicleId) {
  log('🤝', 'Phase 3: carrier acepta oferta');
  const res = await apiCall('POST', `/offers/${offerId}/accept`, {
    token: carrierToken,
    empresaId: carrierEmpresaId,
    body: {
      // Override al vehículo DEMO01 (con teltonika_imei_espejo a Van
      // Oosterwyk). Sin override, matching elige el más chico que sirve
      // (DEMO02) que NO tiene telemetría — para la demo Corfo queremos
      // ver tracking real, así que forzamos al vehículo espejo.
      ...(overrideVehicleId ? { override_vehicle_id: overrideVehicleId } : {}),
    },
  });
  // El endpoint devuelve 201 Created (no 200 OK).
  if (res.status !== 200 && res.status !== 201) {
    fail('accept offer', res);
  }
  const supersededCount = (res.body.superseded_offer_ids ?? []).length;
  log(
    '  ✓',
    'oferta aceptada',
    `assignment_id=${res.body.assignment?.id ?? '?'} status=${res.body.assignment?.status} superseded=${supersededCount}`,
  );
  return res.body.assignment;
}

async function listMyOffers(carrierToken, carrierEmpresaId) {
  const res = await apiCall('GET', '/offers/mine', {
    token: carrierToken,
    empresaId: carrierEmpresaId,
  });
  if (res.status !== 200) {
    fail('list offers', res);
  }
  return res.body.offers ?? res.body;
}

async function activateDriver(rut, pin) {
  log('🪪', 'Phase 4: conductor activa cuenta');
  const res = await apiCall('POST', '/auth/driver-activate', {
    body: { rut, pin },
  });
  if (res.status !== 200) {
    fail('driver-activate', res);
  }
  log('  ✓', 'conductor activado', `synthetic_email=${res.body.synthetic_email}`);
  const idToken = await exchangeCustomTokenForIdToken(res.body.custom_token);
  return { idToken, syntheticEmail: res.body.synthetic_email };
}

async function listMyConductores(carrierToken, carrierEmpresaId) {
  const res = await apiCall('GET', '/conductores', {
    token: carrierToken,
    empresaId: carrierEmpresaId,
  });
  if (res.status !== 200) {
    fail('list conductores', res);
  }
  return res.body.conductores ?? [];
}

async function assignDriver(carrierToken, carrierEmpresaId, assignmentId, driverUserId) {
  log('👷', 'Phase 4b: carrier asigna conductor al assignment');
  const res = await apiCall('POST', `/assignments/${assignmentId}/asignar-conductor`, {
    token: carrierToken,
    empresaId: carrierEmpresaId,
    body: { driver_user_id: driverUserId },
  });
  if (res.status !== 200) {
    fail('asignar-conductor', res);
  }
  log(
    '  ✓',
    'conductor asignado al assignment',
    `driver_user_id=${res.body.new_driver_user_id} name=${res.body.driver_name}`,
  );
}

async function listMyAssignmentsAsDriver(driverToken) {
  const res = await apiCall('GET', '/me/assignments', { token: driverToken });
  if (res.status !== 200) {
    fail('list /me/assignments', res);
  }
  return res.body.assignments ?? [];
}

async function reportDriverPosition(driverToken, assignmentId) {
  log('📍', 'Phase 5: conductor reporta GPS (1 punto, simulado)');
  // Lat/lng intermedio entre Maipú y Valparaíso (ruta 68 aprox).
  const body = {
    latitude: -33.0234,
    longitude: -71.1234,
    accuracy_m: 12.5,
    speed_kmh: 90.0,
    heading_deg: 270,
    timestamp_device: new Date().toISOString(),
  };
  const res = await apiCall('POST', `/assignments/${assignmentId}/driver-position`, {
    token: driverToken,
    body,
  });
  if (res.status !== 200 && res.status !== 201 && res.status !== 204) {
    log('  ⚠', `driver-position respondió ${res.status}`, JSON.stringify(res.body).slice(0, 200));
  } else {
    log('  ✓', 'GPS reportado');
  }
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------

async function main() {
  // Init firebase-admin con ADC (gcloud auth application-default login).
  admin.initializeApp({ projectId: FIREBASE_PROJECT_ID });

  if (ONLY_CLEANUP) {
    const { idToken: adminToken, uid } = await getPlatformAdminToken();
    await runDeleteDemo(adminToken);
    await rotateAdminPassword(uid);
    log('🎉', 'cleanup completo');
    return;
  }

  // Fase 0: token admin
  const { idToken: adminToken, uid: adminUid } = await getPlatformAdminToken();
  await ensureUserRecord(adminToken, PLATFORM_ADMIN_EMAIL);

  // Fase 1: seed
  const creds = await runSeed(adminToken);

  // Fase 2: shipper crea viaje + matching dispara
  const shipperToken = await signInWithEmailPassword(
    creds.shipper_owner.email,
    creds.shipper_owner.password,
  );
  log('  ✓', 'shipper logueado', creds.shipper_owner.email);
  const { trip, matching } = await createTrip(shipperToken);

  if (!matching || matching.offers_created === 0) {
    log('🛑', 'demo dry-run abortó porque no se generaron ofertas — fix el matching primero');
    log('ℹ️ ', 'datos cargados quedan en prod para que puedas inspeccionar:', `trip_id=${trip.id}`);
    if (!KEEP_DATA) {
      log('🧹', 'limpiando con --no-keep-data implícito');
      await runDeleteDemo(adminToken);
    }
    process.exit(2);
  }

  // Fase 3: carrier acepta oferta
  const carrierToken = await signInWithEmailPassword(
    creds.carrier_owner.email,
    creds.carrier_owner.password,
  );
  log('  ✓', 'carrier logueado', creds.carrier_owner.email);

  const offers = await listMyOffers(carrierToken, creds.carrier_empresa_id);
  const myOffer = offers.find((o) => matching.offer_ids.includes(o.id));
  if (!myOffer) {
    log(
      '🛑',
      `carrier no ve la oferta esperada — offers visibles: ${offers.map((o) => o.id).join(',') || '(vacío)'}`,
    );
    if (!KEEP_DATA) {
      await runDeleteDemo(adminToken);
    }
    process.exit(3);
  }
  log('  ✓', 'oferta visible para el carrier', `offer_id=${myOffer.id}`);

  const assignment = await acceptOffer(
    carrierToken,
    myOffer.id,
    creds.carrier_empresa_id,
    creds.vehicle_with_mirror_id,
  );

  // Fase 4: conductor activa cuenta (si tiene PIN)
  let driverToken = null;
  if (creds.conductor.activation_pin) {
    const { idToken } = await activateDriver(creds.conductor.rut, creds.conductor.activation_pin);
    driverToken = idToken;
  } else {
    log('  !', 'conductor ya activado — saltando driver-activate');
    // Para el dry-run completo necesitaríamos el password, que se regenera
    // al re-activar. Saltamos GPS si no podemos loguear como driver.
  }

  // Fase 4b: carrier asigna el conductor al assignment.
  // Esto cierra el gap del flow accept-offer (que crea el assignment con
  // driver_user_id=NULL). Sin este paso, driver-position falla con
  // 403 not_assigned_driver.
  if (assignment && driverToken) {
    // Listar los conductores del carrier para encontrar el user_id del
    // conductor demo (cuyo RUT está en creds.conductor.rut).
    const conductores = await listMyConductores(carrierToken, creds.carrier_empresa_id);
    // Match por RUT normalizado (cred RUT viene canónico).
    const demoConductor = conductores.find(
      (c) => c.user?.rut === creds.conductor.rut || c.user_id !== undefined,
    );
    if (demoConductor) {
      await assignDriver(
        carrierToken,
        creds.carrier_empresa_id,
        assignment.id,
        demoConductor.user_id,
      );
    } else {
      log('  ⚠', 'conductor demo no aparece en la lista del carrier — skip asignación');
    }
  }

  // Fase 4c: verificar que /me/assignments del driver lista el assignment.
  if (driverToken) {
    const driverAssignments = await listMyAssignmentsAsDriver(driverToken);
    log(
      '📋',
      'Phase 4c: GET /me/assignments del driver',
      `total=${driverAssignments.length} primer trip=${driverAssignments[0]?.trip?.tracking_code ?? '(vacío)'}`,
    );
  }

  // Fase 5: conductor reporta GPS (si pudimos loguear)
  if (driverToken && assignment) {
    await reportDriverPosition(driverToken, assignment.id);
  }

  // Reporte final
  log('🎉', 'dry-run completo');
  log('', '', '');
  log('📋', 'Resumen:');
  log('  •', `Trip ID: ${trip.id} (tracking: ${trip.tracking_code})`);
  log('  •', `Status del trip: ${trip.status}`);
  log('  •', `Candidates evaluados: ${matching.candidates_evaluated}`);
  log('  •', `Ofertas creadas: ${matching.offers_created}`);
  log('  •', `Assignment ID: ${assignment?.id ?? '?'}`);
  log('  •', `Carrier empresa: ${creds.carrier_empresa_id}`);
  log('  •', `Shipper empresa: ${creds.shipper_empresa_id}`);
  log('', '', '');
  log('🔑', 'Credenciales para navegar manualmente:');
  log('  shipper:', `${creds.shipper_owner.email} / ${creds.shipper_owner.password}`);
  log('  carrier:', `${creds.carrier_owner.email} / ${creds.carrier_owner.password}`);
  log('  stakeholder:', `${creds.stakeholder.email} / ${creds.stakeholder.password}`);
  log(
    '  conductor:',
    `RUT ${creds.conductor.rut} / PIN ${creds.conductor.activation_pin ?? '(ya activado)'}`,
  );

  if (!KEEP_DATA) {
    log('', '', '');
    log('🧹', 'limpiando datos del dry-run (usa --keep-data para conservar)');
    await runDeleteDemo(adminToken);
  }

  // Rotate password admin para que no quede el temporal accesible en logs
  await rotateAdminPassword(adminUid);
  log('🔒', 'password temporal de admin rotado a random');
}

main().catch((err) => {
  fail('script crashed', err);
});
