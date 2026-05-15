#!/usr/bin/env -S npx tsx
/**
 * forensia-demo-password.ts
 * OPS-X — forensia password-spray retroactivo pre-rotation.
 *
 * Verifica si el password literal `BoosterDemo2026!` está reusado en cuentas
 * no-demo del tenant Booster-AI (Firebase Auth project booster-ai-494222)
 * ANTES de la rotation (OPS-1) que destruye la evidencia de potencial reuso.
 *
 * Cubre: spec §3 H1.5, §9 R21 (compromise residual del literal en git history).
 *
 * Fases:
 *   1. SANITY (positive control): literal contra las 4 cuentas demo.
 *      Esperado: TODAS retornan 200 OK. Si <4, ABORT — rotation accidental
 *      o algo cambió, diagnosticar antes de continuar.
 *   2. SPRAY (real test): literal contra las 4 cuentas no-demo sprayables.
 *      Esperado: TODAS retornan 400 INVALID_LOGIN_CREDENTIALS.
 *      >=1 con 200 OK = MATCH — R17 incident response, pausa H1.
 *
 * Self-throttle: 220ms entre requests (<=5 req/s, respeta R21 throttling).
 *
 * Exit codes:
 *   0 — clean (sanity OK + 0 spray matches), proceder a OPS-1.
 *   2 — >=1 spray match, R17 incident response.
 *   1 — sanity fail u otro error.
 *
 * Uso:
 *   pnpm tsx infrastructure/scripts/forensia-demo-password.ts --full
 *   pnpm tsx infrastructure/scripts/forensia-demo-password.ts --sanity-only
 *   pnpm tsx infrastructure/scripts/forensia-demo-password.ts --dry-run --full
 */

import { writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

// Firebase public Web API key — OK hardcoded (visible en cualquier client del frontend)
const API_KEY = 'AIzaSyDrmKjRa1i0RVAJQKtFsVcQCF_uuJ6IxZk';
const PROJECT_ID = 'booster-ai-494222';
const LITERAL = 'BoosterDemo2026!';
const THROTTLE_MS = 220;

interface Target {
  uid: string;
  email: string;
  persona?: string;
}

// PF-5.1 + accounts:batchGet verified 2026-05-15
const DEMO_TARGETS: Target[] = [
  {
    uid: 'nQSqGqVCHGUn8yrU21uFtnLvaCK2',
    email: 'demo-shipper@boosterchile.com',
    persona: 'shipper',
  },
  {
    uid: 's1qSYAUJZcUtjGu4Pg2wjcjgd2o1',
    email: 'demo-carrier@boosterchile.com',
    persona: 'carrier',
  },
  {
    uid: 'Uxa37UZPAEPWPYEhjjG772ELOiI2',
    email: 'demo-stakeholder@boosterchile.com',
    persona: 'stakeholder',
  },
  {
    uid: 'Gg9k3gIPa1cJZtgKC0RRkWQ0QHJ3',
    email: 'drivers+123456785@boosterchile.invalid',
    persona: 'conductor',
  },
];

const NONDEMO_TARGETS: Target[] = [
  { uid: 'tBZtLbhurnWyCdTObdMiUKkhllE3', email: 'fvicencio@gmail.com' },
  { uid: 'rCY9ZKFbfPWCh6XOJQxkIaUhwxZ2', email: 'pensando@fueradelacaja.co' },
  { uid: '9iTEKErBinemdNhRK9GGXdr3uxt2', email: 'contacto@boosterchile.com' },
  { uid: 'eMSaQTM7TbMWpOpTCOwfV7vnvzp1', email: 'dev@boosterchile.com' },
];

const ENDPOINT = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`;

interface AttemptResult {
  uid: string;
  email: string;
  persona?: string;
  httpStatus: number;
  apiError: string | null;
  durationMs: number;
  isMatch: boolean;
}

async function attemptSignIn(t: Target, dryRun: boolean): Promise<AttemptResult> {
  const start = Date.now();
  if (dryRun) {
    return {
      uid: t.uid,
      email: t.email,
      persona: t.persona,
      httpStatus: 0,
      apiError: 'DRY_RUN',
      durationMs: 0,
      isMatch: false,
    };
  }
  const resp = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // returnSecureToken: false → no nos importa el idToken, solo el status.
    body: JSON.stringify({ email: t.email, password: LITERAL, returnSecureToken: false }),
  });
  const body = (await resp.json().catch(() => ({}))) as {
    idToken?: string;
    error?: { message?: string };
  };
  return {
    uid: t.uid,
    email: t.email,
    persona: t.persona,
    httpStatus: resp.status,
    apiError: body.error?.message ?? null,
    durationMs: Date.now() - start,
    // Match = la API aceptó el password (status 200). El idToken existe pero NO lo usamos.
    isMatch: resp.status === 200,
  };
}

async function runPhase(
  label: string,
  targets: Target[],
  expectedMatch: boolean,
  dryRun: boolean,
): Promise<AttemptResult[]> {
  console.log(
    `\n=== Phase: ${label} (${targets.length} targets, expectedMatch=${expectedMatch}) ===`,
  );
  const results: AttemptResult[] = [];
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    const r = await attemptSignIn(t, dryRun);
    results.push(r);
    const align = r.isMatch === expectedMatch ? '✓ EXPECTED' : '✗ UNEXPECTED';
    const matchLabel = r.isMatch ? 'MATCH' : 'no-match';
    console.log(
      `  ${align}  ${matchLabel.padEnd(9)} | uid=${r.uid.slice(0, 14)} | ${r.email.padEnd(45)} | http=${r.httpStatus} | err=${r.apiError ?? '(none)'} | ${r.durationMs}ms`,
    );
    if (i < targets.length - 1) {
      await sleep(THROTTLE_MS);
    }
  }
  return results;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const dryRun = args.has('--dry-run');
  const phase: 'sanity' | 'spray' | 'full' = args.has('--sanity-only')
    ? 'sanity'
    : args.has('--spray-only')
      ? 'spray'
      : 'full';

  console.log(`OPS-X forensia (${phase}${dryRun ? ' --dry-run' : ''})`);
  console.log(`Project: ${PROJECT_ID}`);
  console.log(`Literal: ${LITERAL.slice(0, 5)}***${LITERAL.slice(-2)}`);

  const sanity =
    phase !== 'spray'
      ? await runPhase('SANITY (4 demo, expect 200 OK)', DEMO_TARGETS, true, dryRun)
      : [];

  // Abort si sanity falla — rotation accidental detectada, no continuar a spray.
  const sanityFails = sanity.filter((r) => !r.isMatch);
  if (sanityFails.length > 0 && !dryRun && phase === 'full') {
    console.error(
      `\n⚠️  ABORT: ${sanityFails.length}/${DEMO_TARGETS.length} demo accounts failed sanity. Rotation accidental o algo cambió.`,
    );
    console.error(
      'Failures:',
      sanityFails.map((r) => `${r.email} (${r.apiError})`),
    );
    process.exit(1);
  }

  const spray =
    phase !== 'sanity'
      ? await runPhase('SPRAY (4 non-demo, expect 400)', NONDEMO_TARGETS, false, dryRun)
      : [];

  const sprayMatches = spray.filter((r) => r.isMatch);

  console.log('\n=== Summary ===');
  console.log(
    `Sanity: ${sanity.length - sanityFails.length}/${sanity.length} demo accounts matched literal (expected: ALL match)`,
  );
  console.log(
    `Spray:  ${sprayMatches.length}/${spray.length} non-demo accounts matched literal (expected: 0 matches)`,
  );
  if (sprayMatches.length > 0) {
    console.log('🚨 SPRAY MATCHES (R17 incident response trigger):');
    sprayMatches.forEach((r) => console.log(`   - ${r.email} (uid ${r.uid})`));
  }

  const reportPath = `/tmp/forensia-result-${Date.now()}.json`;
  writeFileSync(
    reportPath,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        phase,
        dryRun,
        project: PROJECT_ID,
        sanity,
        spray,
        sanityFails,
        sprayMatches,
      },
      null,
      2,
    ),
  );
  console.log(`\nReport JSON: ${reportPath}`);

  if (sprayMatches.length > 0) {
    console.error('\n🚨 R17 INCIDENT RESPONSE: >=1 cuenta no-demo matches el literal.');
    console.error('DO NOT execute OPS-1 (rotation) — destruye chain de evidencia.');
    console.error('Pausa H1 entera. Proceder a R17 forensia + remediation.');
    process.exit(2);
  }
  console.log('\n✅ Clean. Proceder a OPS-1 (rotation).');
  process.exit(0);
}

main().catch((e) => {
  console.error('ERROR:', e);
  process.exit(1);
});
