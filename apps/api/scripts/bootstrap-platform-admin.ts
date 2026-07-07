#!/usr/bin/env tsx
/**
 * Bootstrap reproducible del platform admin (Gap A del alta de usuarios).
 *
 * Spec: .specs/bootstrap-platform-admin/spec.md
 * Diagnóstico: docs/corfo/hito-2/diagnostico-alta-usuarios.md §7
 * Runbook: docs/qa/runbook-bootstrap-platform-admin.md
 *
 * Crea/reconcilia — idempotente y no destructivo — la cuenta Firebase y la
 * fila `usuarios` de un platform admin, dejándolo operable por LoginUniversal
 * (RUT + clave numérica) y aceptado por `requirePlatformAdmin`. Toda la
 * lógica vive en `src/services/bootstrap-platform-admin.ts` (testeada en
 * `test/integration/bootstrap-platform-admin.integration.test.ts`); este
 * wrapper solo parsea args, pide la clave por canal seguro y wirea Firebase
 * Admin + Postgres.
 *
 * Usage (operador Booster, NUNCA CI):
 *   gcloud auth application-default login       # ADC para Admin SDK
 *   # túnel IAP al db-bastion y DATABASE_URL apuntando al túnel
 *   export BOOSTER_PLATFORM_ADMIN_EMAILS="dev@boosterchile.com"
 *   pnpm --filter @booster-ai/api exec tsx scripts/bootstrap-platform-admin.ts \
 *     --email dev@boosterchile.com --rut 12.345.678-5 --full-name "Felipe Vicencio" [--dry-run]
 *
 * La clave (6 dígitos) se pide por prompt TTY oculto con doble confirmación,
 * o via env `BOOTSTRAP_ADMIN_CLAVE` para entornos no interactivos del
 * operador. JAMÁS por argv (queda en el historial del shell y en `ps`).
 */

import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { createLogger } from '@booster-ai/logger';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { createDb } from '../src/db/client.js';
import {
  type BootstrapPlatformAdminResult,
  bootstrapPlatformAdmin,
} from '../src/services/bootstrap-platform-admin.js';

interface CliArgs {
  email: string;
  rut: string;
  fullName: string;
  rotateClave: boolean;
  dryRun: boolean;
}

function usageAndExit(message?: string): never {
  if (message) {
    console.error(`\n✗ ${message}\n`);
  }
  console.error(
    [
      'Usage: tsx scripts/bootstrap-platform-admin.ts --email <email> --rut <rut> --full-name "<nombre>" [--rotate-clave] [--dry-run]',
      '',
      'Env requerido:',
      '  DATABASE_URL                    conexión Postgres (túnel IAP al db-bastion)',
      '  BOOSTER_PLATFORM_ADMIN_EMAILS   allowlist vigente (mismo valor que el servicio api; fuente: Terraform)',
      'Env opcional:',
      '  BOOTSTRAP_ADMIN_CLAVE           clave de 6 dígitos (si no, prompt TTY oculto)',
      '',
      'Ver docs/qa/runbook-bootstrap-platform-admin.md',
    ].join('\n'),
  );
  process.exit(1);
}

function parseArgs(argv: string[]): CliArgs {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg?.startsWith('--')) {
      usageAndExit(`Argumento no reconocido: ${arg}`);
    }
    const eq = arg.indexOf('=');
    if (eq !== -1) {
      values.set(arg.slice(2, eq), arg.slice(eq + 1));
      continue;
    }
    const name = arg.slice(2);
    if (name === 'rotate-clave' || name === 'dry-run') {
      flags.add(name);
      continue;
    }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      usageAndExit(`--${name} requiere un valor`);
    }
    values.set(name, next);
    i += 1;
  }

  const email = values.get('email');
  const rut = values.get('rut');
  const fullName = values.get('full-name');
  if (!email || !rut || !fullName) {
    usageAndExit('Faltan argumentos requeridos (--email, --rut, --full-name).');
  }
  if (values.has('clave')) {
    usageAndExit(
      'La clave NUNCA va por argv (queda en historial/ps). Usa el prompt o BOOTSTRAP_ADMIN_CLAVE.',
    );
  }
  return {
    email,
    rut,
    fullName,
    rotateClave: flags.has('rotate-clave'),
    dryRun: flags.has('dry-run'),
  };
}

/**
 * Prompt TTY con echo suprimido (el readline escribe en un sink mudo salvo
 * la pregunta misma). Doble entrada con confirmación — un typo en una
 * credencial de 6 dígitos que se va a scrypt no tiene recuperación visual.
 */
async function promptClaveHidden(): Promise<string> {
  if (!process.stdin.isTTY) {
    usageAndExit(
      'stdin no es TTY y BOOTSTRAP_ADMIN_CLAVE no está definida. Define la env var para modo no interactivo.',
    );
  }
  const ask = (question: string): Promise<string> => {
    let muted = false;
    const mutedOut = new Writable({
      write(chunk: Buffer | string, _enc, cb) {
        if (!muted) {
          process.stdout.write(chunk);
        }
        cb();
      },
    });
    const rl = createInterface({ input: process.stdin, output: mutedOut, terminal: true });
    return new Promise((resolve) => {
      rl.question(question, (answer) => {
        muted = false;
        process.stdout.write('\n');
        rl.close();
        resolve(answer.trim());
      });
      muted = true;
    });
  };

  const first = await ask('Clave numérica del admin (6 dígitos, no se muestra): ');
  const second = await ask('Confirma la clave: ');
  if (first !== second) {
    console.error('✗ Las claves no coinciden. Abort.');
    process.exit(1);
  }
  return first;
}

function printReport(result: BootstrapPlatformAdminResult): void {
  console.log('');
  console.log(
    `— Reporte bootstrap-platform-admin ${result.dryRun ? '(DRY-RUN, sin escrituras)' : ''}`,
  );
  console.log(`  Firebase : ${result.firebase} (uid=${result.firebaseUid})`);
  console.log(`  usuarios : ${result.user}${result.userId ? ` (id=${result.userId})` : ''}`);
  for (const action of result.actions) {
    console.log(`   · ${action}`);
  }
  console.log('');
  if (!result.dryRun) {
    console.log('Verificación siguiente (runbook §4): login por la UI real con RUT + clave');
    console.log('(tarjeta "Booster" en /login) y approve de una solicitud de prueba.');
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    usageAndExit('DATABASE_URL no está definida (túnel IAP al db-bastion).');
  }
  const allowlistRaw = process.env.BOOSTER_PLATFORM_ADMIN_EMAILS;
  if (!allowlistRaw) {
    usageAndExit(
      'BOOSTER_PLATFORM_ADMIN_EMAILS no está definida. Copia el valor vigente del servicio api (Terraform) — este script valida contra ella, no la modifica.',
    );
  }
  const allowlist = allowlistRaw
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);

  const clave = process.env.BOOTSTRAP_ADMIN_CLAVE ?? (await promptClaveHidden());

  const logger = createLogger({
    service: 'bootstrap-platform-admin',
    version: '0',
    level: 'info',
    pretty: true,
  });

  initializeApp();
  const firebaseAuth = getAuth();
  const { db, pool } = createDb({
    databaseUrl,
    poolMax: 2,
    connectTimeoutMs: 10_000,
  });

  try {
    const result = await bootstrapPlatformAdmin({
      db,
      firebaseAuth,
      logger,
      allowlist,
      input: {
        email: args.email,
        rut: args.rut,
        fullName: args.fullName,
        clave,
        rotateClave: args.rotateClave,
        dryRun: args.dryRun,
      },
    });
    printReport(result);
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  const name = err instanceof Error ? err.name : 'Error';
  const message = err instanceof Error ? err.message : String(err);
  console.error(`✗ [${name}] ${message}`);
  process.exit(1);
});
