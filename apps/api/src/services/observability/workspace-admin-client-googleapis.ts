import type { Logger } from '@booster-ai/logger';
import { google } from 'googleapis';
import type { WorkspaceAdminClient } from './workspace-service.js';

/**
 * Adapter "real" del `WorkspaceAdminClient` que usa `googleapis` para
 * llamar al Admin SDK Directory v1 + Enterprise License Manager v1
 * via Domain-Wide Delegation (DWD).
 *
 * Pre-condición (manual, PO):
 *   1. SA `observability-workspace-reader@booster-ai-494222...` creada.
 *   2. DWD habilitado en admin.google.com con scopes:
 *      - https://www.googleapis.com/auth/admin.directory.user.readonly
 *      - https://www.googleapis.com/auth/apps.licensing
 *   3. JSON key subido a Secret Manager: `google-workspace-admin-credentials`.
 *   4. Email del admin a impersonar configurado en env var
 *      `GOOGLE_WORKSPACE_IMPERSONATE_EMAIL` (e.g. dev@boosterchile.com).
 *
 * Si cualquiera de los pasos falla, este módulo loggea WARN y el caller
 * pasa `undefined` al `WorkspaceService` — la UI muestra "Workspace
 * unavailable" sin crashear el API.
 *
 * Runbook: docs/runbooks/2026-05-13-workspace-admin-sdk-setup.md
 */

const SCOPES = [
  'https://www.googleapis.com/auth/admin.directory.user.readonly',
  'https://www.googleapis.com/auth/apps.licensing',
];

const PRODUCT_ID = 'Google-Apps';

export interface WorkspaceAdminClientOpts {
  /** JSON parseado de la SA key (formato GoogleServiceAccountKey). */
  serviceAccountKey: {
    client_email: string;
    private_key: string;
  };
  /** Email del admin a impersonar (DWD requires un usuario real). */
  impersonateEmail: string;
  logger: Logger;
}

export function createWorkspaceAdminClientGoogleapis(
  opts: WorkspaceAdminClientOpts,
): WorkspaceAdminClient {
  const jwt = new google.auth.JWT({
    email: opts.serviceAccountKey.client_email,
    key: opts.serviceAccountKey.private_key,
    scopes: SCOPES,
    subject: opts.impersonateEmail,
  });

  const directory = google.admin({ version: 'directory_v1', auth: jwt });
  const licensing = google.licensing({ version: 'v1', auth: jwt });

  return {
    async listUsers(domain: string): Promise<{ activeUsers: number; suspendedUsers: number }> {
      let activeUsers = 0;
      let suspendedUsers = 0;
      let pageToken: string | undefined;
      // Cuotas Admin SDK: 2400 qpm; rangos de 500 users por page son OK.
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
