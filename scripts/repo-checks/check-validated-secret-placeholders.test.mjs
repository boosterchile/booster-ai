import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  analyzePlan,
  findServiceSecretMounts,
  findValidatedPlaceholders,
  main,
} from './check-validated-secret-placeholders.mjs';

/** Recurso: placeholder de un secret validado siendo creado (resource_changes). */
function placeholderChange(secret) {
  return {
    address: `google_secret_manager_secret_version.placeholder["${secret}"]`,
    type: 'google_secret_manager_secret_version',
    name: 'placeholder',
    change: { actions: ['create'], after: { secret: `projects/p/secrets/${secret}` } },
  };
}

/** Bloque template[containers[env]] que monta `secret` como env `envName`. */
function templateMounting(envName, secret, { asList = false } = {}) {
  const keyRef = { secret, version: 'latest' };
  const env = [
    {
      name: envName,
      value_source: asList ? [{ secret_key_ref: [keyRef] }] : { secret_key_ref: keyRef },
    },
  ];
  const containers = [{ env }];
  return asList ? [{ containers }] : { containers };
}

/** Recurso service (resource_changes, vía change.after). */
function serviceChange(serviceName, envName, secret, opts = {}) {
  return {
    address: `module.${serviceName}.google_cloud_run_v2_service.service`,
    type: 'google_cloud_run_v2_service',
    name: 'service',
    change: {
      actions: ['update'],
      after: { name: serviceName, template: templateMounting(envName, secret, opts) },
    },
  };
}

/** Recurso service en planned_values (vía resource.values) dentro de un child_module. */
function plannedPlanWithService(serviceName, envName, secret) {
  return {
    planned_values: {
      root_module: {
        resources: [],
        child_modules: [
          {
            address: `module.${serviceName}`,
            resources: [
              {
                type: 'google_cloud_run_v2_service',
                address: `module.${serviceName}.google_cloud_run_v2_service.service`,
                values: { name: serviceName, template: templateMounting(envName, secret) },
              },
            ],
          },
        ],
      },
    },
  };
}

describe('findValidatedPlaceholders', () => {
  it('detecta un placeholder de secret validado por prefijo (content-sid-*)', () => {
    const res = findValidatedPlaceholders([placeholderChange('content-sid-safety-alert')]);
    expect(res).toEqual([expect.objectContaining({ secret: 'content-sid-safety-alert' })]);
  });

  it('detecta un placeholder de secret validado por nombre exacto (twilio-account-sid)', () => {
    expect(findValidatedPlaceholders([placeholderChange('twilio-account-sid')])).toHaveLength(1);
  });

  it('detecta también por sentinel ROTATE_ME visible en secret_data', () => {
    const change = {
      address: 'google_secret_manager_secret_version.otra["content-sid-x"]',
      type: 'google_secret_manager_secret_version',
      name: 'otra',
      change: {
        actions: ['create'],
        after: { secret: 'content-sid-x', secret_data: 'ROTATE_ME_CONTENT_SID_X_PLACEHOLDER' },
      },
    };
    expect(findValidatedPlaceholders([change])).toHaveLength(1);
  });

  it('ignora secretos NO validados (flow-api-key, twilio-auth-token) aunque sean placeholder', () => {
    expect(findValidatedPlaceholders([placeholderChange('flow-api-key')])).toHaveLength(0);
    expect(findValidatedPlaceholders([placeholderChange('twilio-auth-token')])).toHaveLength(0);
  });

  it('ignora destroys (no dejan placeholder vigente)', () => {
    const c = placeholderChange('content-sid-safety-alert');
    c.change.actions = ['delete'];
    expect(findValidatedPlaceholders([c])).toHaveLength(0);
  });
});

describe('findServiceSecretMounts', () => {
  it('extrae el mount desde resource_changes (shape objeto)', () => {
    const m = findServiceSecretMounts({
      resource_changes: [
        serviceChange('service_api', 'CONTENT_SID_SAFETY_ALERT', 'content-sid-safety-alert'),
      ],
    });
    expect([...(m.get('content-sid-safety-alert') ?? [])]).toEqual(['service_api']);
  });

  it('extrae el mount desde resource_changes (shape lista del provider)', () => {
    const m = findServiceSecretMounts({
      resource_changes: [
        serviceChange('service_api', 'CONTENT_SID_SAFETY_ALERT', 'content-sid-safety-alert', {
          asList: true,
        }),
      ],
    });
    expect([...(m.get('content-sid-safety-alert') ?? [])]).toEqual(['service_api']);
  });

  it('extrae el mount desde planned_values (service que NO cambia, recursivo en child_modules)', () => {
    const m = findServiceSecretMounts(
      plannedPlanWithService(
        'booster-ai-api',
        'CONTENT_SID_SAFETY_ALERT',
        'content-sid-safety-alert',
      ),
    );
    expect([...(m.get('content-sid-safety-alert') ?? [])]).toEqual(['booster-ai-api']);
  });
});

describe('analyzePlan', () => {
  it('INCIDENTE INC-2026-06-19: placeholder validado + montado (resource_changes) → violación', () => {
    const plan = {
      resource_changes: [
        placeholderChange('content-sid-safety-alert'),
        serviceChange('booster-ai-api', 'CONTENT_SID_SAFETY_ALERT', 'content-sid-safety-alert'),
      ],
    };
    const { violations, warnings } = analyzePlan(plan);
    expect(violations).toEqual([
      { secret: 'content-sid-safety-alert', services: ['booster-ai-api'] },
    ]);
    expect(warnings).toHaveLength(0);
  });

  it('FN#1: placeholder en resource_changes + service SOLO en planned_values → violación (no warning)', () => {
    const plan = {
      resource_changes: [placeholderChange('content-sid-safety-alert')],
      ...plannedPlanWithService(
        'booster-ai-api',
        'CONTENT_SID_SAFETY_ALERT',
        'content-sid-safety-alert',
      ),
    };
    const { violations, warnings } = analyzePlan(plan);
    expect(violations).toEqual([
      { secret: 'content-sid-safety-alert', services: ['booster-ai-api'] },
    ]);
    expect(warnings).toHaveLength(0);
  });

  it('FN#2: twilio-account-sid placeholder + montado → violación', () => {
    const plan = {
      resource_changes: [
        placeholderChange('twilio-account-sid'),
        serviceChange('booster-ai-api', 'TWILIO_ACCOUNT_SID', 'twilio-account-sid'),
      ],
    };
    const { violations } = analyzePlan(plan);
    expect(violations).toEqual([{ secret: 'twilio-account-sid', services: ['booster-ai-api'] }]);
  });

  it('placeholder validado creado pero NO montado en ningún lado → warning, sin violación', () => {
    const plan = { resource_changes: [placeholderChange('content-sid-safety-alert')] };
    const { violations, warnings } = analyzePlan(plan);
    expect(violations).toHaveLength(0);
    expect(warnings).toEqual([{ secret: 'content-sid-safety-alert' }]);
  });

  it('plan limpio (sin placeholders validados) → sin violaciones ni warnings', () => {
    const plan = {
      resource_changes: [
        placeholderChange('flow-api-key'),
        serviceChange('booster-ai-api', 'FLOW_API_KEY', 'flow-api-key'),
      ],
    };
    expect(analyzePlan(plan)).toEqual({ violations: [], warnings: [] });
  });
});

describe('main (exit codes)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'preflight-'));
  const writePlan = (name, plan) => {
    const p = join(dir, name);
    writeFileSync(p, JSON.stringify(plan));
    return p;
  };

  it('exit 1 con la violación del incidente', () => {
    const p = writePlan('viol.json', {
      resource_changes: [
        placeholderChange('content-sid-safety-alert'),
        serviceChange('booster-ai-api', 'CONTENT_SID_SAFETY_ALERT', 'content-sid-safety-alert'),
      ],
    });
    expect(main([p])).toBe(1);
  });

  it('exit 1 cuando el mount solo está en planned_values (FN#1)', () => {
    const p = writePlan('fn1.json', {
      resource_changes: [placeholderChange('content-sid-safety-alert')],
      ...plannedPlanWithService(
        'booster-ai-api',
        'CONTENT_SID_SAFETY_ALERT',
        'content-sid-safety-alert',
      ),
    });
    expect(main([p])).toBe(1);
  });

  it('exit 0 con plan limpio', () => {
    const p = writePlan('clean.json', { resource_changes: [] });
    expect(main([p])).toBe(0);
  });

  it('exit 0 con placeholder no montado (solo warning)', () => {
    const p = writePlan('warn.json', {
      resource_changes: [placeholderChange('content-sid-safety-alert')],
    });
    expect(main([p])).toBe(0);
  });

  it('exit 2 sin argumento de archivo', () => {
    expect(main([])).toBe(2);
  });

  it('exit 2 con archivo ilegible', () => {
    expect(main([join(dir, 'no-existe.json')])).toBe(2);
  });
});
