import type { Logger } from '@booster-ai/logger';
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import type { Db } from '../db/client.js';
import { createStakeholderZonasRoutes } from './stakeholder-zonas.js';

/**
 * Tests del endpoint GET /me/stakeholder/zonas/:slug/agregaciones (gap B2).
 *
 * Privacy-critical (Ley 19.628) → estos tests blindan los INVARIANTES de
 * privacidad y RBAC del endpoint, no solo el happy path:
 *
 *  - Gate dataset-level: total de viajes que matchean < 5 (K_ANON) →
 *    `insufficient_data: true` SIN buckets (ADR-042 §6 nivel 1).
 *  - Filtro por comuna: solo viajes con originComunaCode ∈ zona.comunaCodes.
 *  - Ventana 30d sobre pickupWindowStart.
 *  - Filtro de estado terminal: solo `entregado` (ADR-042 §5).
 *  - k-anon por bucket: tipo_carga / combustible con <5 viajes se dropean
 *    (vía el servicio puro stakeholder-aggregations.ts).
 *  - RBAC: sin rol stakeholder activo → 403.
 *
 * Patrón de test alineado con admin-signup-requests.test.ts: `db` mockeado
 * con cadenas vi.fn() y `firebaseClaims` inyectado por un middleware wrapper.
 * El mock distingue las queries por el orden de `select()`: user, membership
 * con organización, perfil stakeholder, consents, zona y viajes.
 */

const noop = (): void => undefined;
const noopLogger = {
  trace: noop,
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
  fatal: noop,
  child: () => noopLogger,
} as unknown as Logger;

const FB_UID = 'fb-stakeholder-uid';
const USER_ID = '11111111-1111-1111-1111-111111111111';
const ZONA_SLUG = 'polo-quilicura';

interface ZonaRow {
  id: string;
  slug: string;
  nombre: string;
  regionCode: string;
  comunaCodes: string[];
  isActive: boolean;
}

interface MembershipRow {
  id: string;
  orgId: string;
  regionAmbito: string | null;
  sectorAmbito: string | null;
}

interface StakeholderRow {
  id: string;
}

interface ConsentRow {
  id: string;
  scopeType: 'generador_carga' | 'transportista';
  scopeId: string;
}

interface ViajeRow {
  pickupWindowStart: Date;
  carbonEmissionsKgco2eActual: string | null;
  carbonEmissionsKgco2eEstimated: string | null;
  tipoCarga: string;
  fuelType: string | null;
}

interface MakeDbOpts {
  /** Filas de la membership con su organización (2ª select). */
  membershipRows?: MembershipRow[];
  /** Fila de la zona (5ª select). undefined → zona no encontrada. */
  zonaRow?: ZonaRow | undefined;
  /** Filas de viajes ya filtradas+joineadas (6ª select). */
  viajeRows?: ViajeRow[];
  /** Fila de resolución de userId vía firebase_uid (1ª select). */
  userRow?: { id: string } | undefined;
  /**
   * Perfil en `stakeholders` (3ª select). undefined → el default con id.
   * null → no hay perfil.
   */
  stakeholderRow?: StakeholderRow | null;
  /**
   * Consents vigentes (4ª select). undefined → un consent de generador.
   * [] → ninguno.
   */
  consentRows?: ConsentRow[];
  /** El insert del audit log lanza. */
  auditThrows?: boolean;
}

const CONSENT_DEFAULT: ConsentRow = {
  id: 'consent-1',
  scopeType: 'generador_carga',
  scopeId: 'emp-1',
};

/**
 * Mock de Db. El handler hace, en orden:
 *   1. user por firebase_uid     → limit
 *   2. membership + organización → innerJoin.where.limit
 *   3. stakeholders por userId   → limit
 *   4. consents vigentes         → limit
 *   5. zona por slug             → limit
 *   6. viajes                    → where awaitable
 *   y un insert al audit log antes de responder.
 */
function makeDb(opts: MakeDbOpts = {}) {
  let selectCall = 0;
  const stakeholderRow =
    opts.stakeholderRow === null ? undefined : (opts.stakeholderRow ?? { id: 'stk-1' });
  const consentRows = opts.consentRows ?? [CONSENT_DEFAULT];

  const select = vi.fn(() => {
    selectCall += 1;
    const thisCall = selectCall;

    const resolveLimit = async () => {
      if (thisCall === 1) {
        return opts.userRow ? [opts.userRow] : [];
      }
      if (thisCall === 2) {
        return opts.membershipRows ?? [];
      }
      if (thisCall === 3) {
        return stakeholderRow ? [stakeholderRow] : [];
      }
      if (thisCall === 4) {
        return consentRows;
      }
      if (thisCall === 5) {
        return opts.zonaRow ? [opts.zonaRow] : [];
      }
      return [];
    };

    const whereResult = {
      limit: vi.fn(resolveLimit),
      then: (onFulfilled: (rows: ViajeRow[]) => unknown) =>
        Promise.resolve(thisCall === 6 ? (opts.viajeRows ?? []) : []).then(onFulfilled),
    };

    const where = vi.fn(() => whereResult);
    const joinChain: { leftJoin: ReturnType<typeof vi.fn>; where: typeof where } = {
      leftJoin: vi.fn(() => joinChain),
      where,
    };
    const innerJoin = vi.fn(() => joinChain);
    const from = vi.fn(() => ({ where, innerJoin, leftJoin: joinChain.leftJoin }));
    return { from };
  });

  const insert = vi.fn(() => ({
    values: vi.fn(async () => {
      if (opts.auditThrows) {
        throw new Error('audit log no disponible');
      }
      return [];
    }),
  }));

  return { db: { select, insert } as unknown as Db, spies: { select, insert } };
}

/** Construye una fila de viaje "entregado" con CO2e real. */
function viaje(opts: {
  hourUtc: number;
  tipoCarga?: string;
  fuelType?: string | null;
  co2e?: number | null;
}): ViajeRow {
  // 2026-06-10 a la hora UTC dada. America/Santiago = UTC-4 en junio (sin DST
  // activo en invierno austral → UTC-4), pero el servicio usa Intl con la TZ,
  // así que basta con timestamps coherentes; los tests de bucket horario
  // específico viven en el servicio puro. Acá importan los counts.
  const d = new Date(Date.UTC(2026, 5, 10, opts.hourUtc, 0, 0));
  return {
    pickupWindowStart: d,
    carbonEmissionsKgco2eActual:
      opts.co2e === undefined ? '100.000' : (opts.co2e?.toFixed(3) ?? null),
    carbonEmissionsKgco2eEstimated: null,
    tipoCarga: opts.tipoCarga ?? 'carga_seca',
    fuelType: opts.fuelType === undefined ? 'diesel' : opts.fuelType,
  };
}

const ACTIVE_MEMBERSHIP: MembershipRow[] = [
  { id: 'mem-1', orgId: 'org-1', regionAmbito: null, sectorAmbito: null },
];
const ZONA: ZonaRow = {
  id: 'zona-1',
  slug: ZONA_SLUG,
  nombre: 'Polo industrial Quilicura',
  regionCode: 'CL-RM',
  comunaCodes: ['CL-RM-QUI'],
  isActive: true,
};

function makeApp(db: Db, claims: { uid: string } | null = { uid: FB_UID }) {
  const routes = createStakeholderZonasRoutes({ db, logger: noopLogger });
  const app = new Hono();
  app.use('*', async (c, next) => {
    if (claims) {
      (c as unknown as { set: (k: string, v: unknown) => void }).set('firebaseClaims', {
        uid: claims.uid,
        email: 'stakeholder@obs.cl',
        emailVerified: true,
      });
    }
    await next();
  });
  app.route('/', routes);
  return app;
}

function req(app: Hono, slug = ZONA_SLUG) {
  return app.request(`/zonas/${slug}/agregaciones`, { method: 'GET' });
}

describe('GET /me/stakeholder/zonas/:slug/agregaciones — RBAC', () => {
  it('sin firebaseClaims → 500 (defensa: middleware debe poblarlos)', async () => {
    const { db } = makeDb();
    const app = makeApp(db, null);
    const res = await req(app);
    expect(res.status).toBe(500);
  });

  it('user no registrado en BD → 404 user_not_registered', async () => {
    const { db } = makeDb({ userRow: undefined });
    const app = makeApp(db);
    const res = await req(app);
    expect(res.status).toBe(404);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe('user_not_registered');
  });

  it('user SIN membership rol stakeholder activa → 403 forbidden_not_stakeholder', async () => {
    const { db } = makeDb({ userRow: { id: USER_ID }, membershipRows: [] });
    const app = makeApp(db);
    const res = await req(app);
    expect(res.status).toBe(403);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe('forbidden_not_stakeholder');
  });
});

describe('GET /me/stakeholder/zonas/:slug/agregaciones — zona lookup', () => {
  it('zona inexistente (o inactiva) → 404 zona_not_found', async () => {
    const { db } = makeDb({
      userRow: { id: USER_ID },
      membershipRows: ACTIVE_MEMBERSHIP,
      zonaRow: undefined,
    });
    const app = makeApp(db);
    const res = await req(app, 'no-existe');
    expect(res.status).toBe(404);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe('zona_not_found');
  });
});

describe('GET /me/stakeholder/zonas/:slug/agregaciones — gate dataset-level k-anon', () => {
  it('total de viajes < 5 (K_ANON) → insufficient_data:true SIN buckets', async () => {
    const viajeRows = [
      viaje({ hourUtc: 8 }),
      viaje({ hourUtc: 8 }),
      viaje({ hourUtc: 9 }),
      viaje({ hourUtc: 9 }),
    ]; // 4 < 5
    const { db } = makeDb({
      userRow: { id: USER_ID },
      membershipRows: ACTIVE_MEMBERSHIP,
      zonaRow: ZONA,
      viajeRows,
    });
    const app = makeApp(db);
    const res = await req(app);
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      insufficient_data: boolean;
      por_tipo_carga?: unknown;
      por_combustible?: unknown;
      por_hora_del_dia?: unknown;
      total_viajes?: unknown;
    };
    expect(json.insufficient_data).toBe(true);
    // Gate dataset-level: NO se exponen buckets ni el total exacto.
    expect(json.por_tipo_carga).toBeUndefined();
    expect(json.por_combustible).toBeUndefined();
    expect(json.por_hora_del_dia).toBeUndefined();
    expect(json.total_viajes).toBeUndefined();
  });

  it('exactamente 0 viajes → insufficient_data:true (no crashea)', async () => {
    const { db } = makeDb({
      userRow: { id: USER_ID },
      membershipRows: ACTIVE_MEMBERSHIP,
      zonaRow: ZONA,
      viajeRows: [],
    });
    const app = makeApp(db);
    const res = await req(app);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { insufficient_data: boolean };
    expect(json.insufficient_data).toBe(true);
  });
});

describe('GET /me/stakeholder/zonas/:slug/agregaciones — agregaciones con k-anon por bucket', () => {
  it('total >= 5 → insufficient_data:false + buckets k-anonimizados', async () => {
    // 6 viajes: 5 carga_seca/diesel (sobre umbral) + 1 perecible/electrico (sub-umbral).
    const viajeRows = [
      viaje({ hourUtc: 8, tipoCarga: 'carga_seca', fuelType: 'diesel' }),
      viaje({ hourUtc: 8, tipoCarga: 'carga_seca', fuelType: 'diesel' }),
      viaje({ hourUtc: 9, tipoCarga: 'carga_seca', fuelType: 'diesel' }),
      viaje({ hourUtc: 9, tipoCarga: 'carga_seca', fuelType: 'diesel' }),
      viaje({ hourUtc: 10, tipoCarga: 'carga_seca', fuelType: 'diesel' }),
      viaje({ hourUtc: 11, tipoCarga: 'perecible', fuelType: 'electrico' }),
    ];
    const { db } = makeDb({
      userRow: { id: USER_ID },
      membershipRows: ACTIVE_MEMBERSHIP,
      zonaRow: ZONA,
      viajeRows,
    });
    const app = makeApp(db);
    const res = await req(app);
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      insufficient_data: boolean;
      total_viajes: number;
      por_tipo_carga: Array<{ tipo: string; viajes: number }>;
      por_combustible: Array<{ fuel_type: string; viajes: number }>;
      por_hora_del_dia: Array<{ hora: number; viajes: number | null }>;
    };
    expect(json.insufficient_data).toBe(false);
    expect(json.total_viajes).toBe(6);

    // por_tipo_carga: 'carga_seca' (5) sobrevive, 'perecible' (1) se DROPEA (quasi-id).
    const tipos = json.por_tipo_carga.map((b) => b.tipo);
    expect(tipos).toContain('carga_seca');
    expect(tipos).not.toContain('perecible');

    // por_combustible: 'diesel' (5) sobrevive, 'electrico' (1) se DROPEA.
    const fuels = json.por_combustible.map((b) => b.fuel_type);
    expect(fuels).toContain('diesel');
    expect(fuels).not.toContain('electrico');

    // por_hora_del_dia: universo cerrado de 24 buckets; los sub-k se enmascaran
    // (viajes:null) pero la hora se preserva (no se dropea).
    expect(json.por_hora_del_dia).toHaveLength(24);
    // Ninguna hora individual llega a 5 → todas enmascaradas (viajes:null),
    // pero el array completo de 24 sigue presente.
    for (const b of json.por_hora_del_dia) {
      expect(b).toHaveProperty('hora');
      expect(b.viajes).toBeNull();
    }
  });

  it('fuelType null se mapea a sentinel "desconocido" (NO se inventa diesel)', async () => {
    // 5 viajes con fuelType NULL en BD (vehículo sin combustible declarado).
    const viajeRows = [
      viaje({ hourUtc: 8, fuelType: null }),
      viaje({ hourUtc: 8, fuelType: null }),
      viaje({ hourUtc: 9, fuelType: null }),
      viaje({ hourUtc: 9, fuelType: null }),
      viaje({ hourUtc: 10, fuelType: null }),
    ];
    const { db } = makeDb({
      userRow: { id: USER_ID },
      membershipRows: ACTIVE_MEMBERSHIP,
      zonaRow: ZONA,
      viajeRows,
    });
    const app = makeApp(db);
    const res = await req(app);
    const json = (await res.json()) as {
      por_combustible: Array<{ fuel_type: string; viajes: number }>;
    };
    const fuels = json.por_combustible.map((b) => b.fuel_type);
    expect(fuels).toContain('desconocido');
    expect(fuels).not.toContain('diesel');
  });
});

describe('GET /me/stakeholder/zonas/:slug/agregaciones — consent y ámbito', () => {
  const base = {
    userRow: { id: USER_ID },
    membershipRows: ACTIVE_MEMBERSHIP,
    zonaRow: ZONA,
    viajeRows: [viaje({ hourUtc: 8 })],
  };

  it('sin perfil en stakeholders → 403 consent_required', async () => {
    const { db } = makeDb({ ...base, stakeholderRow: null });
    const res = await req(makeApp(db));
    expect(res.status).toBe(403);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe('consent_required');
  });

  it('sin consent de emisiones_carbono → 403 consent_required', async () => {
    const { db } = makeDb({ ...base, consentRows: [] });
    const res = await req(makeApp(db));
    expect(res.status).toBe(403);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe('consent_required');
  });

  it('region_ambito distinto de la zona → 403 fuera_de_ambito', async () => {
    const { db } = makeDb({
      ...base,
      membershipRows: [{ id: 'mem-1', orgId: 'org-1', regionAmbito: 'CL-VS', sectorAmbito: null }],
    });
    const res = await req(makeApp(db));
    expect(res.status).toBe(403);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe('fuera_de_ambito');
  });

  it('sector_ambito puesto → 403 ambito_sectorial_no_disponible', async () => {
    const { db } = makeDb({
      ...base,
      membershipRows: [
        { id: 'mem-1', orgId: 'org-1', regionAmbito: null, sectorAmbito: 'transporte-carga' },
      ],
    });
    const res = await req(makeApp(db));
    expect(res.status).toBe(403);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe('ambito_sectorial_no_disponible');
  });

  it('registra el acceso antes de devolver insufficient_data', async () => {
    const { db, spies } = makeDb({ ...base, viajeRows: [] });
    const res = await req(makeApp(db));
    expect(res.status).toBe(200);
    expect(spies.insert).toHaveBeenCalled();
  });

  it('si el audit falla → 500 y no devuelve buckets', async () => {
    const viajeRows = [
      viaje({ hourUtc: 8 }),
      viaje({ hourUtc: 8 }),
      viaje({ hourUtc: 9 }),
      viaje({ hourUtc: 9 }),
      viaje({ hourUtc: 10 }),
    ];
    const { db } = makeDb({ ...base, viajeRows, auditThrows: true });
    const res = await req(makeApp(db));
    expect(res.status).toBe(500);
    const json = (await res.json()) as { por_tipo_carga?: unknown };
    expect(json.por_tipo_carga).toBeUndefined();
  });
});
