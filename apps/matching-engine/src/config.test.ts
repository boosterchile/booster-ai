import { describe, expect, it } from 'vitest';
import { InvalidConfigError, loadConfig } from './config.js';

const minimo = {
  OIDC_AUDIENCE: 'https://booster-ai-matching-engine-1.southamerica-west1.run.app',
  ALLOWED_CALLER_SA: 'cloud-run-runtime@booster-ai-494222.iam.gserviceaccount.com',
};

describe('loadConfig', () => {
  it('defaults de puerto, log y entorno', () => {
    expect(loadConfig(minimo)).toEqual({
      ...minimo,
      PORT: 8080,
      LOG_LEVEL: 'info',
      NODE_ENV: 'production',
    });
  });

  it('se rehúsa a arrancar sin audience o con caller que no es email', () => {
    expect(() => loadConfig({ ALLOWED_CALLER_SA: minimo.ALLOWED_CALLER_SA })).toThrow(
      InvalidConfigError,
    );
    expect(() => loadConfig({ ...minimo, ALLOWED_CALLER_SA: 'no-es-email' })).toThrow(
      InvalidConfigError,
    );
  });
});
