import { describe, expect, it } from 'vitest';
import { checkCertificateBackendInvariants } from './certificate-backend-invariants.js';

describe('checkCertificateBackendInvariants (backend local del E2E, T10-02)', () => {
  const KMS = 'projects/p/locations/southamerica-west1/keyRings/r/cryptoKeys/k';

  it('production con KMS y bucket GCS → sin errores', () => {
    expect(
      checkCertificateBackendInvariants({
        nodeEnv: 'production',
        signingKeyId: KMS,
        certificatesBucket: 'booster-ai-certificates',
      }),
    ).toEqual([]);
  });

  it('production con key local: → error', () => {
    const errors = checkCertificateBackendInvariants({
      nodeEnv: 'production',
      signingKeyId: 'local:e2e',
      certificatesBucket: 'booster-ai-certificates',
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/CERTIFICATE_SIGNING_KEY_ID/);
  });

  it('production con bucket file: → error', () => {
    const errors = checkCertificateBackendInvariants({
      nodeEnv: 'production',
      signingKeyId: KMS,
      certificatesBucket: 'file:/tmp/certs',
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/CERTIFICATES_BUCKET/);
  });

  it('development con backend local → permitido (E2E)', () => {
    expect(
      checkCertificateBackendInvariants({
        nodeEnv: 'development',
        signingKeyId: 'local:e2e',
        certificatesBucket: 'file:/tmp/certs',
      }),
    ).toEqual([]);
  });

  it('sin config de certificados → sin errores (emisión se salta con warn)', () => {
    expect(
      checkCertificateBackendInvariants({
        nodeEnv: 'production',
        signingKeyId: undefined,
        certificatesBucket: undefined,
      }),
    ).toEqual([]);
  });
});
