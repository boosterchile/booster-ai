import type { Logger } from '@booster-ai/logger';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Tests del adapter zero-key.
 *
 * Mockeamos `googleapis` para que las llamadas `directory.users.list` y
 * `licensing.licenseAssignments.listForProduct` retornen data fake y NO
 * intenten autenticarse por sí mismas. El flow signJwt + token exchange
 * lo testamos por separado interceptando `fetch`.
 */

const fakeLogger: Logger = {
  trace: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
  child: () => fakeLogger,
} as unknown as Logger;

const mockListUsers = vi.fn();
const mockListLicenseAssignments = vi.fn();

vi.mock('googleapis', () => ({
  google: {
    admin: () => ({
      users: { list: mockListUsers },
    }),
    licensing: () => ({
      licenseAssignments: { listForProduct: mockListLicenseAssignments },
    }),
    auth: {
      OAuth2: class {
        getAccessToken = async () => ({ token: 'mocked' });
      },
    },
  },
}));

const { createWorkspaceAdminClientGoogleapis } = await import(
  '../../../src/services/observability/workspace-admin-client-googleapis.js'
);

beforeEach(() => {
  vi.clearAllMocks();
});

function makeFetchImpl(handler: (url: string) => Response | Promise<Response>): typeof fetch {
  return vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input.toString();
    return handler(url);
  }) as unknown as typeof fetch;
}

describe('workspace-admin-client-googleapis', () => {
  it('listUsers: cuenta active + suspended correctamente', async () => {
    mockListUsers.mockResolvedValue({
      data: {
        users: [
          { primaryEmail: 'a@x.com', suspended: false },
          { primaryEmail: 'b@x.com', suspended: true },
          { primaryEmail: 'c@x.com', suspended: false },
        ],
        nextPageToken: undefined,
      },
    });
    const fetchImpl = makeFetchImpl(
      async (url) =>
        ({
          ok: true,
          status: 200,
          text: async () => '',
          json: async () =>
            url.includes(':signJwt')
              ? { signedJwt: 'fake.jwt' }
              : { access_token: 'fake-token', expires_in: 3600 },
        }) as Response,
    );

    const client = createWorkspaceAdminClientGoogleapis({
      readerSaEmail: 'reader@booster-ai.iam.gserviceaccount.com',
      impersonateEmail: 'admin@boosterchile.com',
      logger: fakeLogger,
      fetchImpl,
    });

    const result = await client.listUsers('boosterchile.com');
    expect(result).toEqual({ activeUsers: 2, suspendedUsers: 1 });
    expect(mockListUsers).toHaveBeenCalledWith(
      expect.objectContaining({ domain: 'boosterchile.com', maxResults: 500, projection: 'basic' }),
    );
  });

  it('listUsers: paginación con nextPageToken', async () => {
    mockListUsers
      .mockResolvedValueOnce({
        data: { users: [{ suspended: false }, { suspended: false }], nextPageToken: 'page2' },
      })
      .mockResolvedValueOnce({
        data: { users: [{ suspended: true }] },
      });
    const fetchImpl = makeFetchImpl(
      async (url) =>
        ({
          ok: true,
          status: 200,
          text: async () => '',
          json: async () =>
            url.includes(':signJwt')
              ? { signedJwt: 'fake.jwt' }
              : { access_token: 'fake-token', expires_in: 3600 },
        }) as Response,
    );

    const client = createWorkspaceAdminClientGoogleapis({
      readerSaEmail: 'reader@booster-ai.iam.gserviceaccount.com',
      impersonateEmail: 'admin@boosterchile.com',
      logger: fakeLogger,
      fetchImpl,
    });
    const result = await client.listUsers('boosterchile.com');
    expect(result.activeUsers).toBe(2);
    expect(result.suspendedUsers).toBe(1);
    expect(mockListUsers).toHaveBeenCalledTimes(2);
    expect(mockListUsers).toHaveBeenLastCalledWith(expect.objectContaining({ pageToken: 'page2' }));
  });

  it('listLicenseAssignments: agrupa skuIds', async () => {
    mockListLicenseAssignments.mockResolvedValue({
      data: {
        items: [{ skuId: '1010020028' }, { skuId: '1010020028' }, { skuId: '1010020025' }],
      },
    });
    const fetchImpl = makeFetchImpl(
      async (url) =>
        ({
          ok: true,
          status: 200,
          text: async () => '',
          json: async () =>
            url.includes(':signJwt')
              ? { signedJwt: 'fake.jwt' }
              : { access_token: 'fake-token', expires_in: 3600 },
        }) as Response,
    );

    const client = createWorkspaceAdminClientGoogleapis({
      readerSaEmail: 'reader@booster-ai.iam.gserviceaccount.com',
      impersonateEmail: 'admin@boosterchile.com',
      logger: fakeLogger,
      fetchImpl,
    });
    const result = await client.listLicenseAssignments('boosterchile.com');
    expect(result).toHaveLength(3);
    expect(result).toContainEqual({ skuId: '1010020028' });
    expect(result).toContainEqual({ skuId: '1010020025' });
  });

  it('listLicenseAssignments: maneja respuesta sin items', async () => {
    mockListLicenseAssignments.mockResolvedValue({ data: {} });
    const fetchImpl = makeFetchImpl(
      async (url) =>
        ({
          ok: true,
          status: 200,
          text: async () => '',
          json: async () =>
            url.includes(':signJwt')
              ? { signedJwt: 'fake.jwt' }
              : { access_token: 'fake-token', expires_in: 3600 },
        }) as Response,
    );

    const client = createWorkspaceAdminClientGoogleapis({
      readerSaEmail: 'reader@booster-ai.iam.gserviceaccount.com',
      impersonateEmail: 'admin@boosterchile.com',
      logger: fakeLogger,
      fetchImpl,
    });
    const result = await client.listLicenseAssignments('boosterchile.com');
    expect(result).toEqual([]);
  });

  it('listLicenseAssignments: paginación + filtra items sin skuId', async () => {
    mockListLicenseAssignments
      .mockResolvedValueOnce({
        data: {
          items: [{ skuId: '1010020028' }, { skuId: null }, { skuId: '1010020025' }],
          nextPageToken: 'p2',
        },
      })
      .mockResolvedValueOnce({
        data: { items: [{ skuId: '1010020027' }] },
      });
    const fetchImpl = makeFetchImpl(
      async (url) =>
        ({
          ok: true,
          status: 200,
          text: async () => '',
          json: async () =>
            url.includes(':signJwt')
              ? { signedJwt: 'fake.jwt' }
              : { access_token: 'fake-token', expires_in: 3600 },
        }) as Response,
    );

    const client = createWorkspaceAdminClientGoogleapis({
      readerSaEmail: 'reader@booster-ai.iam.gserviceaccount.com',
      impersonateEmail: 'admin@boosterchile.com',
      logger: fakeLogger,
      fetchImpl,
    });
    const result = await client.listLicenseAssignments('boosterchile.com');
    // 3 con skuId real (el null se filtra) + 1 de página 2
    expect(result).toHaveLength(3);
    expect(mockListLicenseAssignments).toHaveBeenCalledTimes(2);
  });

  // NOTA: error paths del flow signJwt + token exchange se validan E2E
  // via gcloud impersonate-service-account (sesión 2026-05-13). Mockear
  // googleapis al nivel de poder simular fallos del Bearer token requeriría
  // exponer `getDwdAccessToken` como helper público — el costo de testing
  // surface vs valor no compensa para este path.
});
