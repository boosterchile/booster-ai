import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from './api-client.js';
import {
  CertDisabledError,
  CertNotIssuedError,
  descargarCertificadoDeViaje,
} from './cert-download.js';

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('open', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('descargarCertificadoDeViaje', () => {
  it('happy path: GET retorna download_url y abre window.open con _blank', async () => {
    const getSpy = vi.spyOn(api, 'get').mockResolvedValueOnce({
      download_url: 'https://storage.googleapis.com/booster/cert-abc.pdf?sig=...',
      expires_in_seconds: 300,
      tracking_code: 'TR-123',
    });

    await descargarCertificadoDeViaje('trip-uuid-1');

    expect(getSpy).toHaveBeenCalledWith('/trip-requests-v2/trip-uuid-1/certificate/download');
    expect(window.open).toHaveBeenCalledWith(
      'https://storage.googleapis.com/booster/cert-abc.pdf?sig=...',
      '_blank',
      'noopener',
    );
  });

  it('ApiError code=certificate_not_issued → throw CertNotIssuedError', async () => {
    vi.spyOn(api, 'get').mockRejectedValueOnce(
      new ApiError(404, 'certificate_not_issued', 'cert not yet issued'),
    );
    await expect(descargarCertificadoDeViaje('trip-1')).rejects.toThrow(CertNotIssuedError);
  });

  it('ApiError code=certificates_disabled → throw CertDisabledError', async () => {
    vi.spyOn(api, 'get').mockRejectedValueOnce(
      new ApiError(503, 'certificates_disabled', 'KMS not configured'),
    );
    await expect(descargarCertificadoDeViaje('trip-1')).rejects.toThrow(CertDisabledError);
  });

  it('error genérico (no ApiError) se propaga sin transformar', async () => {
    vi.spyOn(api, 'get').mockRejectedValueOnce(new Error('network fail'));
    await expect(descargarCertificadoDeViaje('trip-1')).rejects.toThrow('network fail');
  });

  it('ApiError con código distinto → se propaga el ApiError original', async () => {
    const otherErr = new ApiError(500, 'unknown', 'boom');
    vi.spyOn(api, 'get').mockRejectedValueOnce(otherErr);
    await expect(descargarCertificadoDeViaje('trip-1')).rejects.toBe(otherErr);
  });
});
