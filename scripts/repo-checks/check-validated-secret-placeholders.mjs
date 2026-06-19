#!/usr/bin/env node
/**
 * @booster-ai/scripts — check-validated-secret-placeholders (INC-2026-06-19)
 *
 * Preflight de `terraform apply`: impide que un secreto con valor PLACEHOLDER
 * (`ROTATE_ME_<NAME>_PLACEHOLDER`, ver infrastructure/security.tf) y FORMATO
 * VALIDADO en el env schema sea montado en un Cloud Run service — porque el
 * service rechaza el arranque (`Invalid environment configuration. Refusing to
 * start.`) y la revisión falla el startup probe, bloqueando deploys.
 *
 * Origen (post-mortem INC-2026-06-19): un `terraform apply` creó
 * `content-sid-safety-alert` con su placeholder `ROTATE_ME_..._PLACEHOLDER` y
 * lo montó en `service_api` como `CONTENT_SID_SAFETY_ALERT`, que el api valida
 * con `^HX[a-fA-F0-9]+$` (apps/api/src/config.ts). El placeholder no matchea →
 * el api "Refusing to start" → toda revisión nueva (incluido el próximo deploy
 * de cloudbuild) falla. Prod siguió sirviendo la revisión vieja, que NO montaba
 * el secreto. Este check lo habría atajado ANTES del apply.
 *
 * Cobertura de mounts: cruzamos los placeholders contra el ESTADO RESULTANTE
 * COMPLETO (`planned_values.root_module` + child_modules recursivos), no solo
 * `resource_changes` — un service que ya monta el secreto puede no aparecer en
 * resource_changes (image/traffic/scaling están en `ignore_changes`), y aun así
 * su próxima revisión montaría el placeholder y fallaría (FN hallado en review).
 *
 * Secretos "validados por formato": sus env vars tienen un `.regex(/^XX.../)`
 * anclado en los env schema (apps/api/src/config.ts y apps/whatsapp-bot/src/
 * config.ts) — el valor DEBE empezar con literales, que el placeholder
 * `ROTATE_ME_*` nunca cumple. Hoy: `content-sid-*` (`^HX`) y `twilio-account-sid`
 * (`^AC`). (`twilio-auth-token` usa `.min(16)`: el placeholder de 38 chars pasa
 * → NO está en alcance.) Mantener en sync; follow-up: derivarlo de los `.regex`.
 *
 * El `secret_data` es sensible y el plan JSON lo redacta, así que detectamos el
 * placeholder por el ADDRESS del recurso
 * (`google_secret_manager_secret_version.placeholder[...]`) y por el sentinel
 * cuando viene visible.
 *
 * Usage:
 *   terraform -chdir=infrastructure show -json tfplan > plan.json
 *   node scripts/repo-checks/check-validated-secret-placeholders.mjs plan.json
 *
 * Exit codes:
 *   0 = sin placeholders validados montados (ok; puede haber warnings no-fatales)
 *   1 = al menos un secreto validado con placeholder montado en un service
 *   2 = error de uso (archivo no legible / JSON inválido)
 */
import { readFileSync } from 'node:fs';
import process from 'node:process';

/**
 * Prefijos de nombres de secretos cuyo env var tiene validación de FORMATO
 * (`.regex(/^...)` anclado) en los env schema. Un placeholder los rompe.
 */
export const VALIDATED_SECRET_PREFIXES = ['content-sid-'];

/** Nombres exactos de secretos validados por formato que no comparten prefijo. */
export const VALIDATED_SECRET_NAMES = ['twilio-account-sid'];

/** Sentinel de placeholder que setea infrastructure/security.tf. */
const PLACEHOLDER_RE = /^ROTATE_ME_.*_PLACEHOLDER$/;

const DEFAULT_VALIDATED = { prefixes: VALIDATED_SECRET_PREFIXES, names: VALIDATED_SECRET_NAMES };

/** Última parte de un id de secret (`projects/x/secrets/NAME` → `NAME`). */
function secretShortName(id) {
  if (typeof id !== 'string') {
    return undefined;
  }
  const parts = id.split('/secrets/');
  return (parts[1] ?? id).split('/')[0];
}

/** Extrae la key entre comillas de un address `...placeholder["<key>"]`. */
function keyFromAddress(address) {
  const m = /\["([^"]+)"\]/.exec(address ?? '');
  return m ? m[1] : undefined;
}

/** Normaliza un bloque nested de plan JSON (objeto o array-de-uno) a array. */
function asArray(v) {
  if (Array.isArray(v)) {
    return v;
  }
  return v == null ? [] : [v];
}

function isValidated(secretName, validated = DEFAULT_VALIDATED) {
  if (!secretName) {
    return false;
  }
  const prefixes = validated.prefixes ?? [];
  const names = validated.names ?? [];
  return prefixes.some((p) => secretName.startsWith(p)) || names.includes(secretName);
}

/**
 * Secretos validados que se CREAN/quedan como placeholder en el plan. Detecta
 * por recurso `google_secret_manager_secret_version` cuyo nombre de recurso es
 * `placeholder` (convención de security.tf) o cuyo `secret_data` visible matchea
 * el sentinel.
 * @returns {{secret:string, address:string}[]}
 */
export function findValidatedPlaceholders(resourceChanges, validated = DEFAULT_VALIDATED) {
  const out = [];
  for (const rc of resourceChanges ?? []) {
    if (rc?.type !== 'google_secret_manager_secret_version') {
      continue;
    }
    const actions = rc.change?.actions ?? [];
    // Solo nos importan creates/updates que dejan el valor placeholder vigente.
    if (!actions.includes('create') && !actions.includes('update')) {
      continue;
    }
    const after = rc.change?.after ?? {};
    const secret = secretShortName(after.secret) ?? keyFromAddress(rc.address);
    if (!isValidated(secret, validated)) {
      continue;
    }
    const isPlaceholderResource =
      rc.name === 'placeholder' || /\.placeholder\b/.test(rc.address ?? '');
    const dataLooksPlaceholder =
      typeof after.secret_data === 'string' && PLACEHOLDER_RE.test(after.secret_data);
    if (isPlaceholderResource || dataLooksPlaceholder) {
      out.push({ secret, address: rc.address });
    }
  }
  return out;
}

/** Recolecta secretos montados como env (secret_key_ref) de un objeto de service. */
function collectMounts(serviceObj, serviceName, map) {
  for (const tmpl of asArray(serviceObj?.template)) {
    for (const container of asArray(tmpl?.containers)) {
      for (const env of asArray(container?.env)) {
        for (const vs of asArray(env?.value_source)) {
          for (const ref of asArray(vs?.secret_key_ref)) {
            const secret = secretShortName(ref?.secret);
            if (!secret) {
              continue;
            }
            if (!map.has(secret)) {
              map.set(secret, new Set());
            }
            map.get(secret).add(serviceName);
          }
        }
      }
    }
  }
}

/** Recorre root_module + child_modules recursivamente aplicando `visit(resource)`. */
function walkPlannedModules(module, visit) {
  if (!module) {
    return;
  }
  for (const r of module.resources ?? []) {
    visit(r);
  }
  for (const cm of module.child_modules ?? []) {
    walkPlannedModules(cm, visit);
  }
}

/**
 * Mapa secret → Set(serviceName) de secretos montados como env. Une dos fuentes:
 *  - `resource_changes` (services que CAMBIAN en este plan) vía `change.after`.
 *  - `planned_values.root_module` recursivo (ESTADO resultante completo, incluye
 *    services que montan el secreto pero NO cambian) vía `resource.values`.
 * @returns {Map<string, Set<string>>}
 */
export function findServiceSecretMounts(plan) {
  const map = new Map();
  for (const rc of plan?.resource_changes ?? []) {
    if (rc?.type !== 'google_cloud_run_v2_service') {
      continue;
    }
    const after = rc.change?.after ?? {};
    collectMounts(after, after.name ?? rc.address, map);
  }
  walkPlannedModules(plan?.planned_values?.root_module, (r) => {
    if (r?.type !== 'google_cloud_run_v2_service') {
      return;
    }
    const values = r.values ?? {};
    collectMounts(values, values.name ?? r.address, map);
  });
  return map;
}

/**
 * @returns {{violations:{secret:string,services:string[]}[], warnings:{secret:string}[]}}
 */
export function analyzePlan(plan, validated = DEFAULT_VALIDATED) {
  const placeholders = findValidatedPlaceholders(plan?.resource_changes ?? [], validated);
  const mounts = findServiceSecretMounts(plan);
  const violations = [];
  const warnings = [];
  for (const { secret } of placeholders) {
    const services = mounts.get(secret);
    if (services && services.size > 0) {
      violations.push({ secret, services: [...services].sort() });
    } else {
      warnings.push({ secret });
    }
  }
  return { violations, warnings };
}

export function main(argv) {
  const files = argv.filter((a) => !a.startsWith('-'));
  const file = files[0];
  if (!file) {
    process.stderr.write(
      '[check-validated-secret-placeholders] uso: <plan.json>\n' +
        '  terraform -chdir=infrastructure show -json tfplan > plan.json\n',
    );
    return 2;
  }
  let plan;
  try {
    plan = JSON.parse(readFileSync(file, 'utf-8'));
  } catch (err) {
    process.stderr.write(
      `[check-validated-secret-placeholders] no se pudo leer ${file}: ${err.message}\n`,
    );
    return 2;
  }

  const { violations, warnings } = analyzePlan(plan);

  for (const w of warnings) {
    process.stdout.write(
      `[check-validated-secret-placeholders] NOTA — '${w.secret}' se crea como placeholder ` +
        'y no está montado en ningún service en este plan (poblá su valor real antes de montarlo).\n',
    );
  }

  if (violations.length === 0) {
    process.stdout.write(
      '[check-validated-secret-placeholders] OK — ningún secreto validado con placeholder montado.\n',
    );
    return 0;
  }

  process.stderr.write(
    `[check-validated-secret-placeholders] FAIL — ${violations.length} secreto(s) validado(s) por formato ` +
      'con placeholder, montados en un service (romperán el startup probe):\n',
  );
  for (const v of violations) {
    process.stderr.write(`  ${v.secret} → ${v.services.join(', ')}\n`);
  }
  process.stderr.write(
    '\nUn secreto cuyo env var se valida con regex (ej. CONTENT_SID_* = /^HX[a-fA-F0-9]+$/ o\n' +
      'TWILIO_ACCOUNT_SID = /^AC.../ en los config.ts) NO puede aplicarse con su placeholder\n' +
      'ROTATE_ME_*: el service rechaza el arranque y toda revisión nueva (incluido el próximo\n' +
      'deploy) falla. Antes del apply:\n' +
      '  1. Poblá el valor real:\n' +
      "       printf %s '<valor real>' | gcloud secrets versions add <secret> --data-file=-\n" +
      '  2. O excluí el mount/secret de ESTE apply hasta tener el valor real.\n' +
      'Post-mortem: docs/incidents/INC-2026-06-19-content-sid-placeholder-startup.md\n',
  );
  return 1;
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  process.exit(main(process.argv.slice(2)));
}
