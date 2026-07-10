#!/usr/bin/env tsx
/**
 * CI gate de cobertura del impersonation-write-guard (impersonación auditada).
 *
 * Espejo de `check-is-demo-wire-completeness.ts`: parsea
 * `apps/api/src/server.ts`, identifica los mount points auth-required de
 * usuario final (los que aplican `firebaseAuthMiddleware`) y verifica que CADA
 * uno también aplique `impersonationWriteGuardMiddleware` en su chain. Exit 1
 * si algún path auth-required NO tiene el guard — un gap ahí sería una ruta
 * mutante por la que una sesión impersonada podría escribir sobre una empresa
 * real sin ser bloqueada.
 *
 * Por qué un gate y no confianza en la revisión: la protección de escritura en
 * este repo es dispersa (cada handler chequea su propia autorización). El guard
 * es central pero se cablea per-group; sin este gate, un PR futuro que agregue
 * un mount con `firebaseAuth` y olvide el guard abriría el hueco en silencio.
 *
 * Los mounts de auth service-to-service (OIDC `authMiddleware`,
 * `/trip-requests`, `/internal/*`, `/admin/jobs`) NO usan `firebaseAuth` y no
 * son impersonables → correctamente fuera del scope de este gate.
 *
 * Ejecución directa:
 *   pnpm exec tsx apps/api/scripts/check-impersonation-wire-completeness.ts
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { collectMiddlewaresPerPath } from './check-is-demo-wire-completeness.js';

const SERVER_FILE = new URL('../src/server.ts', import.meta.url).pathname;
const FIREBASE_AUTH_IDENTIFIER = 'firebaseAuthMiddleware';
const GUARD_IDENTIFIER = 'impersonationWriteGuardMiddleware';

/**
 * Paths con firebaseAuthMiddleware pero SIN impersonationWriteGuardMiddleware.
 * Retorna array vacío si la cobertura es completa.
 */
export function findMissingGuard(source: string): string[] {
  const map = collectMiddlewaresPerPath(source);
  const missing: string[] = [];
  for (const [path, middlewares] of map.entries()) {
    if (!middlewares.includes(FIREBASE_AUTH_IDENTIFIER)) {
      continue;
    }
    if (!middlewares.includes(GUARD_IDENTIFIER)) {
      missing.push(path);
    }
  }
  return missing;
}

function main(): void {
  const source = readFileSync(SERVER_FILE, 'utf-8');
  const missing = findMissingGuard(source);

  if (missing.length > 0) {
    console.error(
      '[check-impersonation-wire-completeness] FAIL — mount points auth-required sin impersonation-write-guard:',
    );
    for (const path of missing) {
      console.error(`  - ${path} (falta ${GUARD_IDENTIFIER})`);
    }
    console.error(
      `\n${missing.length} coverage gap(s) en ${SERVER_FILE}. Fix: agregar el guard al chain (per-group, DESPUÉS de userContextMiddleware).`,
    );
    process.exit(1);
  }

  console.log(
    '[check-impersonation-wire-completeness] OK — todos los mount points auth-required en server.ts tienen impersonation-write-guard wired.',
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
