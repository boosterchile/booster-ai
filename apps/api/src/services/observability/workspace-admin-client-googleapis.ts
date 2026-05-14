import type { Logger } from '@booster-ai/logger';
import { GoogleAuth, type OAuth2Client } from 'google-auth-library';
import { google } from 'googleapis';
import type { WorkspaceAdminClient } from './workspace-service.js';

/**
 * Adapter "real" del `WorkspaceAdminClient` que usa googleapis para
 * llamar Admin SDK Directory v1 + Enterprise License Manager v1 via
 * Domain-Wide Delegation (DWD).
 *
 * Diseño cero-key (cumple `iam.disableServiceAccountKeyCreation` org
 * policy de Booster):
 *
 * 1. El SA del Cloud Run (`booster-cloudrun-sa`) tiene
 *    `roles/iam.serviceAccountTokenCreator` sobre la SA dedicada
 *    `observability-workspace-reader`.
 * 2. En runtime, este adapter:
 *    a. Construye un JWT con `iss=observability-workspace-reader`,
 *       `sub=<admin-impersonate-email>` (DWD subject), scopes Admin
 *       SDK + Licensing.
 *    b. Llama a IAM Credentials API `signJwt` (firma con la identidad
 *       de la SA del reader, sin descargar key — la key vive only
 *       dentro de GCP).
 *    c. Intercambia el JWT firmado por un access token via OAuth 2
 *       (grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer).
 *    d. Usa ese access token para las llamadas Admin SDK + Licensing.
 *
 * Pre-condición (manual, PO):
 *   1. SA `observability-workspace-reader@booster-ai-494222...` creada.
 *   2. DWD habilitada en admin.google.com con scopes:
 *      - https://www.googleapis.com/auth/admin.directory.user.readonly
 *      - https://www.googleapis.com/auth/apps.licensing
 *   3. Email del admin Workspace a impersonar configurado en env var
 *      `GOOGLE_WORKSPACE_IMPERSONATE_EMAIL`.
 *
 * Si DWD no se autoriza, este módulo loggea WARN al primer call y el
 * caller pasa null al `WorkspaceService` — UI muestra unavailable.
 *
 * Runbook: docs/runbooks/2026-05-13-workspace-admin-sdk-setup.md
 */

const SCOPES = [
  'https://www.googleapis.com/auth/admin.directory.user.readonly',
  'https://www.googleapis.com/auth/apps.licensing',
];

const PRODUCT_ID = 'Google-Apps';
const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const TOKEN_LIFETIME_SECONDS = 3600;
/** Re-firmar el JWT cuando queden < 5 min del token (cache margen). */
const TOKEN_REFRESH_MARGIN_SECONDS = 300;

export interface WorkspaceAdminClientOpts {
  /** Email completo de la SA dedicada al reader (no del runtime SA). */
  readerSaEmail: string;
  /** Email del admin Workspace a impersonar (DWD subject). */
  impersonateEmail: string;
  logger: Logger;
  /** Inyectable para tests. Si se pasa, omite ADC + IAM Credentials. */
  fetchImpl?: typeof fetch;
}

interface CachedToken {
  accessToken: string;
  expiresAtMs: number;
}

export function createWorkspaceAdminClientGoogleapis(
  opts: WorkspaceAdminClientOpts,
): WorkspaceAdminClient {
  const logger = opts.logger;
  const fetchImpl = opts.fetchImpl ?? fetch;

  // Token cache compartido entre llamadas del mismo proceso.
  let cached: CachedToken | null = null;

  // ADC client del Cloud Run runtime SA. Tiene tokenCreator sobre el reader SA.
  const auth = new GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });

  async function getDwdAccessToken(): Promise<string> {
    const nowMs = Date.now();
    if (cached && cached.expiresAtMs - TOKEN_REFRESH_MARGIN_SECONDS * 1000 > nowMs) {
      return cached.accessToken;
    }

    // Step 1: Sign JWT via IAM Credentials API
    const nowSec = Math.floor(nowMs / 1000);
    const jwtPayload = {
      iss: opts.readerSaEmail,
      sub: opts.impersonateEmail,
      scope: SCOPES.join(' '),
      aud: OAUTH_TOKEN_URL,
      iat: nowSec,
      exp: nowSec + TOKEN_LIFETIME_SECONDS,
    };

    const client = (await auth.getClient()) as OAuth2Client;
    const accessTokenForSign = await client.getAccessToken();
    if (!accessTokenForSign.token) {
      throw new Error('workspace adapter: ADC token unavailable');
    }

    const signResponse = await fetchImpl(
      `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${opts.readerSaEmail}:signJwt`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessTokenForSign.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ payload: JSON.stringify(jwtPayload) }),
      },
    );
    if (!signResponse.ok) {
      const body = await signResponse.text();
      throw new Error(
        `workspace adapter: signJwt failed (${signResponse.status}): ${body.slice(0, 200)}`,
      );
    }
    const { signedJwt } = (await signResponse.json()) as { signedJwt: string };

    // Step 2: Exchange signed JWT for access token at OAuth 2 endpoint
    const tokenResponse = await fetchImpl(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: signedJwt,
      }).toString(),
    });
    if (!tokenResponse.ok) {
      const body = await tokenResponse.text();
      throw new Error(
        `workspace adapter: token exchange failed (${tokenResponse.status}): ${body.slice(0, 200)}`,
      );
    }
    const tokenJson = (await tokenResponse.json()) as {
      access_token: string;
      expires_in: number;
    };

    cached = {
      accessToken: tokenJson.access_token,
      expiresAtMs: nowMs + tokenJson.expires_in * 1000,
    };
    logger.debug('workspace adapter: refreshed DWD access token');
    return cached.accessToken;
  }

  // Construimos los clientes googleapis con un auth dummy "OAuth2 with
  // dynamic token" — usamos un OAuth2Client cuya getAccessToken se
  // delega a nuestro getDwdAccessToken.
  function buildAuthForGoogleapis(): OAuth2Client {
    const oauth = new google.auth.OAuth2();
    oauth.getAccessToken = async () => ({ token: await getDwdAccessToken() });
    return oauth;
  }

  return {
    async listUsers(domain: string): Promise<{ activeUsers: number; suspendedUsers: number }> {
      const directory = google.admin({ version: 'directory_v1', auth: buildAuthForGoogleapis() });
      let activeUsers = 0;
      let suspendedUsers = 0;
      let pageToken: string | undefined;
      do {
        const params: {
          domain: string;
          maxResults: number;
          projection: string;
          pageToken?: string;
        } = {
          domain,
          maxResults: 500,
          projection: 'basic',
        };
        if (pageToken) {
          params.pageToken = pageToken;
        }
        const response = await directory.users.list(params);
        const users = response.data.users ?? [];
        for (const u of users) {
          if (u.suspended) {
            suspendedUsers += 1;
          } else {
            activeUsers += 1;
          }
        }
        pageToken = response.data.nextPageToken ?? undefined;
      } while (pageToken);

      return { activeUsers, suspendedUsers };
    },

    async listLicenseAssignments(domain: string): Promise<Array<{ skuId: string }>> {
      const licensing = google.licensing({ version: 'v1', auth: buildAuthForGoogleapis() });
      const assignments: Array<{ skuId: string }> = [];
      let pageToken: string | undefined;
      do {
        const params: {
          productId: string;
          customerId: string;
          maxResults: number;
          pageToken?: string;
        } = {
          productId: PRODUCT_ID,
          customerId: domain,
          maxResults: 1000,
        };
        if (pageToken) {
          params.pageToken = pageToken;
        }
        const response = await licensing.licenseAssignments.listForProduct(params);
        const items = response.data.items ?? [];
        for (const item of items) {
          if (item.skuId) {
            assignments.push({ skuId: item.skuId });
          }
        }
        pageToken = response.data.nextPageToken ?? undefined;
      } while (pageToken);

      return assignments;
    },
  };
}
