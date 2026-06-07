import { describe, expect, it } from 'vitest';
import { buildRedisTlsOptions } from './redis-tls.js';

const FAKE_CA = '-----BEGIN CERTIFICATE-----\nMIID...\n-----END CERTIFICATE-----';

describe('buildRedisTlsOptions', () => {
  it('tls=false → undefined (sin TLS, dev local)', () => {
    expect(buildRedisTlsOptions({ tls: false })).toBeUndefined();
    expect(buildRedisTlsOptions({ tls: false, caCert: FAKE_CA })).toBeUndefined();
  });

  it('tls=true sin CA → {} (preserva validación contra bundle del sistema)', () => {
    expect(buildRedisTlsOptions({ tls: true })).toEqual({});
    expect(buildRedisTlsOptions({ tls: true, caCert: undefined })).toEqual({});
  });

  it('tls=true con CA → pinnea la CA y deshabilita el check de hostname', () => {
    const opts = buildRedisTlsOptions({ tls: true, caCert: FAKE_CA });
    expect(opts).toBeDefined();
    expect(opts?.ca).toEqual([FAKE_CA]);
    // checkServerIdentity definido y retorna undefined (= identidad OK, conexión por IP)
    expect(typeof opts?.checkServerIdentity).toBe('function');
    // @ts-expect-error — invocación de prueba; los args reales los pasa Node en runtime
    expect(opts?.checkServerIdentity?.('172.25.0.3', {})).toBeUndefined();
  });

  it('NO usa rejectUnauthorized:false (la cadena CA debe seguir validándose)', () => {
    const opts = buildRedisTlsOptions({ tls: true, caCert: FAKE_CA });
    expect((opts as { rejectUnauthorized?: boolean })?.rejectUnauthorized).toBeUndefined();
  });
});
