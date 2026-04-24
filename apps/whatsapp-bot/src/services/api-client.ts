import type { Logger } from '@booster-ai/logger';
import type { WhatsAppIntakeCreateInput } from '@booster-ai/shared-schemas';
import { GoogleAuth } from 'google-auth-library';

/**
 * Cliente para apps/api usando identity tokens de Cloud Run SA-to-SA.
 *
 * Cada invocación obtiene un identity token firmado por Google con:
 *   - `iss` = https://accounts.google.com
 *   - `aud` = config.API_OIDC_AUDIENCE (típicamente la URL del service api)
 *   - `email` = service account que corre este pod (github-cloudrun-sa@...)
 *
 * google-auth-library cachea el token internamente hasta ~5min antes del exp,
 * así que no optimizar prematuramente con cache local.
 */
export class ApiClient {
  private readonly auth: GoogleAuth;

  constructor(
    private readonly options: {
      apiUrl: string;
      audience: string;
      logger: Logger;
    },
  ) {
    this.auth = new GoogleAuth();
  }

  async createTripRequest(
    input: WhatsAppIntakeCreateInput,
  ): Promise<{ tracking_code: string; id: string }> {
    const { apiUrl, audience, logger } = this.options;
    const client = await this.auth.getIdTokenClient(audience);

    const response = await client.request<{ tracking_code: string; id: string }>({
      url: `${apiUrl}/trip-requests`,
      method: 'POST',
      data: input,
      headers: { 'content-type': 'application/json' },
    });

    if (response.status !== 201) {
      logger.error(
        { status: response.status, data: response.data },
        'api.createTripRequest unexpected status',
      );
      throw new Error(`api.createTripRequest returned ${response.status}`);
    }

    return response.data;
  }
}
