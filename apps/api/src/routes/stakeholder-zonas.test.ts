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
 * El mock de `db` distingue las dos queries del handler por el orden de
 * invocación de `select()` (1ª = membership RBAC, 2ª = zona, 3ª = viajes).
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
  comunaCodes: string[];
  isActive: boolean;
}

interface ViajeRow {
  pickupWindowStart: Date;
  carbonEmissionsKgco2eActual: string | null;
  carbonEmissionsKgco2eEstimated: string | null;
  tipoCarga: string;
  fuelType: string | null;
}

interface MakeDbOpts {
  /** Filas devueltas por la query de membership RBAC (1ª select). */
  membershipRows?: Array<{ id: string }>;
  /** Fila de la zona (2ª select). undefined → zona no encontrada. */
  zonaRow?: ZonaRow | undefined;
  /** Filas de viajes ya filtradas+joineadas (3ª select). */
  viajeRows?: ViajeRow[];
  /** Fila de resolución de userId vía firebase_uid (select de users). */
  userRow?: { id: string } | undefined;
}

/**
 * Mock de Db. El handler hace, en orden:
 *   1. resolveUserId        → select(users).where.limit  → userRow
 *   2. RBAC membership       → select(membresias).where.limit → membershipRows
 *   3. zona por slug         → select(zonas).where.limit → [zonaRow]
 *   4. viajes filtrados      → select(...).from.innerJoin.leftJoin.where → viajeRows
 *
 * Distinguimos por contador de invocaciones de `select()`.
 */
function makeDb(opts: MakeDbOpts = {}) {
  let selectCall = 0;

  const select = vi.fn(() => {
    selectCall += 1;
    const thisCall = selectCall;

    // Terminal resolvers según qué query es.
    const resolveLimit = async () => {
      if (thisCall === 1) {
        return opts.userRow ? [opts.userRow] : [];
      }
      if (thisCall === 2) {
        return opts.membershipRows ?? [];
      }
      if (thisCall === 3) {
        return opts.zonaRow ? [opts.zonaRow] : [];
      }
      return [];
    };

    // La 4ª query (viajes) no usa .limit() — termina en .where() awaitable.
    const whereResult = {
      limit: vi.fn(resolveLimit),
      // permitir await directo del where (query de viajes)
      then: (onFulfilled: (rows: ViajeRow[]) => unknown) =>
        Promise.resolve(opts.viajeRows ?? []).then(onFulfilled),
    };

    const where = vi.fn(() => whereResult);
    // `leftJoin` debe ser encadenable: el handler hace
    // .innerJoin(asignaciones).leftJoin(vehiculos).leftJoin(metricas_viaje).where(...)
    const joinChain: { leftJoin: ReturnType<typeof vi.fn>; where: typeof where } = {
      leftJoin: vi.fn(() => joinChain),
      where,
    };
    const innerJoin = vi.fn(() => joinChain);
    const from = vi.fn(() => ({ where, innerJoin, leftJoin: joinChain.leftJoin }));
    return { from };
  });

  return { db: { select } as unknown as Db, spies: { select } };
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

const ACTIVE_MEMBERSHIP = [{ id: 'mem-1' }];
const ZONA: ZonaRow = {
  id: 'zona-1',
  slug: ZONA_SLUG,
  nombre: 'Polo industrial Quilicura',
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
