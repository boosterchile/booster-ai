import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import * as schema from '../../src/db/schema.js';
import type { UserContext } from '../../src/services/user-context.js';
import { rutAleatorio } from '../helpers/rut-aleatorio.js';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

/**
 * Prueba madre de aislamiento multi-tenant en runtime
 * (`.specs/aislamiento-hallazgos-tenant/plan.md` §1 criterio 1, §2 bloque C).
 *
 * Dos empresas A y B con una fila en cada tabla tenant-scoped del censo
 * (`.specs/censo-multi-tenant-2026-07-14/informe.md` §2). Con sesión de A:
 *   - las listas no traen ningún id de B;
 *   - detalle y escritura sobre un id de B responden 403 o 404, nunca 2xx
 *     ni 5xx;
 *   - las filas de B quedan exactamente como estaban (ninguna escritura
 *     cruzada, responda lo que responda la ruta).
 *
 * El control estático (`pnpm lint:rls`) acepta anotaciones; este test no.
 * Excepciones cross-tenant por diseño, fuera de este archivo a propósito:
 * matching (lee todas las empresas dentro del request del generador), chat
 * bilateral (las dos partes del assignment), agregados k-anon de zonas
 * stakeholder, tracking público por token y rutas platform-admin.
 */
async function cargarRutas() {
  // Las rutas de factoring responden 503 `feature_disabled` con el flag
  // apagado y la sonda sería vacía. `config.ts` lee env al importarse, por
  // eso el flag se fija antes de importar (cada archivo tiene su propio
  // registro de módulos en vitest).
  process.env.FACTORING_V1_ACTIVATED = 'true';
  process.env.PRICING_V2_ACTIVATED = 'true';
  const m = await Promise.all([
    import('../../src/routes/admin-dispositivos.js'),
    import('../../src/routes/assignments.js'),
    import('../../src/routes/cobra-hoy.js'),
    import('../../src/routes/conductores.js'),
    import('../../src/routes/documentos.js'),
    import('../../src/routes/me-empresa-miembros.js'),
    import('../../src/routes/me-liquidaciones.js'),
    import('../../src/routes/offers.js'),
    import('../../src/routes/sucursales.js'),
    import('../../src/routes/transport-documents.js'),
    import('../../src/routes/trip-requests-v2.js'),
    import('../../src/routes/vehiculos.js'),
  ]);
  return {
    createAdminDispositivosRoutes: m[0].createAdminDispositivosRoutes,
    createAssignmentsRoutes: m[1].createAssignmentsRoutes,
    createCobraHoyAssignmentsRoutes: m[2].createCobraHoyAssignmentsRoutes,
    createCobraHoyMeRoutes: m[2].createCobraHoyMeRoutes,
    createConductoresRoutes: m[3].createConductoresRoutes,
    createDocumentosRoutes: m[4].createDocumentosRoutes,
    createCumplimientoRoutes: m[4].createCumplimientoRoutes,
    createMeEmpresaMiembrosRoutes: m[5].createMeEmpresaMiembrosRoutes,
    createMeLiquidacionesRoutes: m[6].createMeLiquidacionesRoutes,
    createOfferRoutes: m[7].createOfferRoutes,
    createSucursalesRoutes: m[8].createSucursalesRoutes,
    createTransportDocumentsRoutes: m[9].createTransportDocumentsRoutes,
    createTripRequestsV2Routes: m[10].createTripRequestsV2Routes,
    createVehiculosRoutes: m[11].createVehiculosRoutes,
  };
}
let rutas: Awaited<ReturnType<typeof cargarRutas>>;

describe('integration: aislamiento entre dos empresas', () => {
  let handle: TestDbHandle;
  const noop = (): void => undefined;
  const logger = {
    trace: noop,
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    fatal: noop,
    child: () => logger,
  } as never;

  let A: Empresa;
  let B: Empresa;
  beforeAll(async () => {
    handle = createTestDb();
    rutas = await cargarRutas();
    A = await crearEmpresa('A');
    B = await crearEmpresa('B');
  });
  afterAll(async () => {
    await handle.pool.end();
  });

  async function planId(): Promise<string> {
    const { db } = handle;
    const [plan] = await db
      .insert(schema.plans)
      .values({
        slug: 'gratis',
        name: 'Plan aislamiento',
        description: 'fixture',
        monthlyPriceClp: 0,
        features: {},
      })
      .onConflictDoNothing({ target: schema.plans.slug })
      .returning({ id: schema.plans.id });
    const id =
      plan?.id ?? (await db.select({ id: schema.plans.id }).from(schema.plans).limit(1)).at(0)?.id;
    if (!id) {
      throw new Error('fixture: plan no disponible');
    }
    return id;
  }

  function uno<T>(rows: T[], que: string): T {
    const row = rows[0];
    if (!row) {
      throw new Error(`fixture: ${que} no creado`);
    }
    return row;
  }

  /** Una empresa completa: dueño, membresía, vehículo, conductor, sucursal, viaje, oferta, asignación, documentos, liquidación. */
  async function crearEmpresa(tag: 'A' | 'B') {
    const { db } = handle;
    const suffix = randomUUID().slice(0, 8);
    const plan = await planId();
    const dueno = uno(
      await db
        .insert(schema.users)
        .values({
          firebaseUid: `fb-${tag}-${suffix}`,
          email: `${tag}-dueno-${suffix}@test.invalid`,
          fullName: `Dueño ${tag}`,
          rut: rutAleatorio(),
        })
        .returning(),
      'dueño',
    );
    const empresa = uno(
      await db
        .insert(schema.empresas)
        .values({
          legalName: `Empresa ${tag} ${suffix}`,
          rut: rutAleatorio(),
          contactEmail: `${tag}-${suffix}@empresa.invalid`,
          contactPhone: '+56911111111',
          addressStreet: 'Calle Falsa 123',
          addressCity: 'Santiago',
          addressRegion: 'RM',
          isTransportista: true,
          isGeneradorCarga: true,
          status: 'activa',
          planId: plan,
        })
        .returning(),
      'empresa',
    );
    const membresia = uno(
      await db
        .insert(schema.memberships)
        .values({
          userId: dueno.id,
          empresaId: empresa.id,
          role: 'dueno',
          status: 'activa',
          joinedAt: new Date(),
        })
        .returning(),
      'membresía',
    );
    const vehiculo = uno(
      await db
        .insert(schema.vehicles)
        .values({
          empresaId: empresa.id,
          plate: `${tag}${tag}${suffix.slice(0, 4).toUpperCase()}`,
          vehicleType: 'camion_mediano',
          capacityKg: 5000,
        })
        .returning(),
      'vehículo',
    );
    const conductorUser = uno(
      await db
        .insert(schema.users)
        .values({
          firebaseUid: `pending-rut:${tag}-${suffix}`,
          email: `${tag}-conductor-${suffix}@test.invalid`,
          fullName: `Conductor ${tag}`,
          rut: rutAleatorio(),
        })
        .returning(),
      'usuario conductor',
    );
    const conductor = uno(
      await db
        .insert(schema.conductores)
        .values({
          userId: conductorUser.id,
          empresaId: empresa.id,
          licenseClass: 'A4',
          licenseNumber: `L${suffix}`,
          licenseExpiry: '2028-09-22',
        })
        .returning(),
      'conductor',
    );
    const sucursal = uno(
      await db
        .insert(schema.sucursalesEmpresa)
        .values({
          empresaId: empresa.id,
          nombre: `Sucursal ${tag}`,
          addressStreet: 'Av. Siempre Viva 742',
          addressCity: 'Santiago',
          addressRegion: 'RM',
        })
        .returning(),
      'sucursal',
    );
    const viaje = uno(
      await db
        .insert(schema.trips)
        .values({
          trackingCode: randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase(),
          generadorCargaEmpresaId: empresa.id,
          createdByUserId: dueno.id,
          originAddressRaw: 'Av. Apoquindo 4500, Las Condes',
          destinationAddressRaw: 'Av. Libertad 100, Viña del Mar',
          cargoType: 'carga_seca',
          cargoWeightKg: 1000,
          pickupDateRaw: '2026-10-10',
          status: 'asignado',
        })
        .returning(),
      'viaje',
    );
    const oferta = uno(
      await db
        .insert(schema.offers)
        .values({
          tripId: viaje.id,
          empresaId: empresa.id,
          score: 80,
          proposedPriceClp: 100_000,
          expiresAt: new Date(Date.now() + 86_400_000),
        })
        .returning(),
      'oferta',
    );
    const asignacion = uno(
      await db
        .insert(schema.assignments)
        .values({
          tripId: viaje.id,
          offerId: oferta.id,
          empresaId: empresa.id,
          vehicleId: vehiculo.id,
          driverUserId: conductorUser.id,
          agreedPriceClp: 100_000,
          status: 'asignado',
          acceptedAt: new Date(),
        })
        .returning(),
      'asignación',
    );
    const docVehiculo = uno(
      await db
        .insert(schema.documentosVehiculo)
        .values({ vehicleId: vehiculo.id, tipo: 'revision_tecnica', notas: `original ${tag}` })
        .returning(),
      'documento vehículo',
    );
    const docConductor = uno(
      await db
        .insert(schema.documentosConductor)
        .values({ conductorId: conductor.id, tipo: 'licencia_conducir', notas: `original ${tag}` })
        .returning(),
      'documento conductor',
    );
    const docTransporte = uno(
      await db
        .insert(schema.transportDocuments)
        .values({
          viajeId: viaje.id,
          filePath: `docs/${suffix}.pdf`,
          fileMime: 'application/pdf',
          docType: 'other',
          source: 'pdf_upload',
          uploadedBy: dueno.id,
        })
        .returning(),
      'documento transporte',
    );
    const liquidacion = uno(
      await db
        .insert(schema.liquidaciones)
        .values({
          asignacionId: asignacion.id,
          empresaCarrierId: empresa.id,
          // NOT NULL en la BD (migración 0015) aunque schema.ts no lo declare notNull.
          tierSlugAplicado: 'free',
          montoBrutoClp: 100_000,
          comisionPct: '10.00',
          comisionClp: 10_000,
          montoNetoCarrierClp: 90_000,
          ivaComisionClp: 1_900,
          totalFacturaBoosterClp: 11_900,
          pricingMethodologyVersion: 'test',
          status: 'pending_consent',
        })
        .returning(),
      'liquidación',
    );
    return {
      tag,
      empresa,
      dueno,
      membresia,
      vehiculo,
      conductorUser,
      conductor,
      sucursal,
      viaje,
      oferta,
      asignacion,
      docVehiculo,
      docConductor,
      docTransporte,
      liquidacion,
    };
  }
  type Empresa = Awaited<ReturnType<typeof crearEmpresa>>;

  /** Ids de B que jamás pueden aparecer en una respuesta de A. */
  function idsDe(e: Empresa): string[] {
    return [
      e.empresa.id,
      e.dueno.id,
      e.membresia.id,
      e.vehiculo.id,
      e.vehiculo.plate,
      e.conductorUser.id,
      e.conductor.id,
      e.sucursal.id,
      e.viaje.id,
      e.viaje.trackingCode,
      e.oferta.id,
      e.asignacion.id,
      e.docVehiculo.id,
      e.docConductor.id,
      e.docTransporte.id,
      e.liquidacion.id,
    ];
  }

  function contexto(activa: Empresa, otras: Empresa[] = []): UserContext {
    const memberships = [activa, ...otras].map((e) => ({
      membership: e.membresia,
      empresa: e.empresa,
    }));
    return {
      user: activa.dueno,
      memberships,
      activeMembership: memberships[0] ?? null,
      impersonatedBy: null,
    };
  }

  function appPara(ctx: UserContext) {
    const { db } = handle;
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('userContext', ctx);
      await next();
    });
    app.route('/vehiculos', rutas.createVehiculosRoutes({ db, logger }));
    app.route('/conductores', rutas.createConductoresRoutes({ db, logger }));
    app.route('/sucursales', rutas.createSucursalesRoutes({ db, logger }));
    app.route('/trip-requests-v2', rutas.createTripRequestsV2Routes({ db, logger }));
    const assignmentsRouter = rutas.createAssignmentsRoutes({ db, logger, geofenceRadiusM: 150 });
    assignmentsRouter.route('/', rutas.createCobraHoyAssignmentsRoutes({ db, logger }));
    app.route('/assignments', assignmentsRouter);
    app.route('/offers', rutas.createOfferRoutes({ db, logger }));
    app.route('/documentos', rutas.createDocumentosRoutes({ db, logger }));
    app.route('/cumplimiento', rutas.createCumplimientoRoutes({ db, logger }));
    app.route('/', rutas.createTransportDocumentsRoutes({ db, logger }));
    const meRouter = new Hono();
    meRouter.route('/', rutas.createMeLiquidacionesRoutes({ db, logger }));
    meRouter.route('/', rutas.createCobraHoyMeRoutes({ db, logger }));
    meRouter.route('/empresa/miembros', rutas.createMeEmpresaMiembrosRoutes({ db, logger }));
    app.route('/me', meRouter);
    app.route(
      '/admin/dispositivos-pendientes',
      rutas.createAdminDispositivosRoutes({ db, logger }),
    );
    return app;
  }

  function json(method: string, body: unknown): RequestInit {
    return {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    };
  }

  /** Lecturas de lista con sesión de A: 200 y ningún id de B en el cuerpo. */
  const LISTAS: Array<[string, (b: Empresa) => string]> = [
    ['GET /vehiculos', () => '/vehiculos'],
    ['GET /vehiculos/flota', () => '/vehiculos/flota'],
    ['GET /conductores', () => '/conductores'],
    ['GET /sucursales', () => '/sucursales'],
    ['GET /trip-requests-v2', () => '/trip-requests-v2'],
    ['GET /assignments', () => '/assignments'],
    ['GET /offers/mine', () => '/offers/mine'],
    ['GET /cumplimiento', () => '/cumplimiento'],
    ['GET /me/liquidaciones', () => '/me/liquidaciones'],
    ['GET /me/empresa/miembros', () => '/me/empresa/miembros'],
    ['GET /me/cobra-hoy/historial', () => '/me/cobra-hoy/historial'],
  ];

  /** Detalle y escritura sobre un recurso de B con sesión de A: 403 o 404. */
  const SONDAS: Array<[string, (b: Empresa) => [string, RequestInit?]]> = [
    ['GET /vehiculos/:id', (b) => [`/vehiculos/${b.vehiculo.id}`]],
    [
      'PATCH /vehiculos/:id',
      (b) => [`/vehiculos/${b.vehiculo.id}`, json('PATCH', { capacity_kg: 9000 })],
    ],
    ['GET /vehiculos/:id/telemetria', (b) => [`/vehiculos/${b.vehiculo.id}/telemetria`]],
    ['GET /vehiculos/:id/ubicacion', (b) => [`/vehiculos/${b.vehiculo.id}/ubicacion`]],
    [
      'GET /vehiculos/:id/traza',
      (b) => [
        `/vehiculos/${b.vehiculo.id}/traza?desde=2026-10-01T00:00:00Z&hasta=2026-10-02T00:00:00Z`,
      ],
    ],
    ['GET /conductores/:id', (b) => [`/conductores/${b.conductor.id}`]],
    [
      'PATCH /conductores/:id',
      (b) => [`/conductores/${b.conductor.id}`, json('PATCH', { license_number: 'HACK' })],
    ],
    ['GET /sucursales/:id', (b) => [`/sucursales/${b.sucursal.id}`]],
    [
      'PATCH /sucursales/:id',
      (b) => [`/sucursales/${b.sucursal.id}`, json('PATCH', { nombre: 'HACK' })],
    ],
    ['GET /trip-requests-v2/:id', (b) => [`/trip-requests-v2/${b.viaje.id}`]],
    [
      'PATCH /trip-requests-v2/:id/cancelar',
      (b) => [`/trip-requests-v2/${b.viaje.id}/cancelar`, json('PATCH', {})],
    ],
    ['GET /assignments/:id', (b) => [`/assignments/${b.asignacion.id}`]],
    ['GET /assignments/:id/resultado', (b) => [`/assignments/${b.asignacion.id}/resultado`]],
    ['GET /assignments/:id/traza', (b) => [`/assignments/${b.asignacion.id}/traza`]],
    ['GET /assignments/:id/eco-route', (b) => [`/assignments/${b.asignacion.id}/eco-route`]],
    [
      'GET /assignments/:id/behavior-score',
      (b) => [`/assignments/${b.asignacion.id}/behavior-score`],
    ],
    ['GET /assignments/:id/coaching', (b) => [`/assignments/${b.asignacion.id}/coaching`]],
    [
      'PATCH /assignments/:id/confirmar-entrega',
      (b) => [`/assignments/${b.asignacion.id}/confirmar-entrega`, json('PATCH', {})],
    ],
    [
      'GET /assignments/:id/cobra-hoy/cotizacion',
      (b) => [`/assignments/${b.asignacion.id}/cobra-hoy/cotizacion`],
    ],
    ['POST /offers/:id/accept', (b) => [`/offers/${b.oferta.id}/accept`, json('POST', {})]],
    ['POST /offers/:id/reject', (b) => [`/offers/${b.oferta.id}/reject`, json('POST', {})]],
    ['GET /offers/:id/eco-preview', (b) => [`/offers/${b.oferta.id}/eco-preview`]],
    ['GET /documentos/vehiculo/:vehiculoId', (b) => [`/documentos/vehiculo/${b.vehiculo.id}`]],
    ['GET /documentos/conductor/:conductorId', (b) => [`/documentos/conductor/${b.conductor.id}`]],
    [
      'PATCH /documentos/vehiculo-doc/:id',
      (b) => [`/documentos/vehiculo-doc/${b.docVehiculo.id}`, json('PATCH', { notas: 'HACK' })],
    ],
    [
      'PATCH /documentos/conductor-doc/:id',
      (b) => [`/documentos/conductor-doc/${b.docConductor.id}`, json('PATCH', { notas: 'HACK' })],
    ],
    ['GET /transport-orders/:id/documents', (b) => [`/transport-orders/${b.viaje.id}/documents`]],
    ['GET /documents/:id', (b) => [`/documents/${b.docTransporte.id}`]],
  ];

  describe('listas con sesión de A', () => {
    test.each(LISTAS)('%s → 200 y sin ids de B', async (_nombre, path) => {
      const res = await appPara(contexto(A)).request(path(B));
      const cuerpo = await res.text();
      expect(res.status, cuerpo).toBe(200);
      for (const id of idsDe(B)) {
        expect(cuerpo, `la respuesta de A contiene ${id} de B`).not.toContain(id);
      }
    });
  });

  describe('detalle y escritura sobre recursos de B con sesión de A', () => {
    test.each(SONDAS)('%s → 403 o 404, nunca 2xx ni 5xx', async (_nombre, build) => {
      const [path, init] = build(B);
      const res = await appPara(contexto(A)).request(path, init);
      const cuerpo = await res.text();
      expect([403, 404], `status ${res.status}: ${cuerpo}`).toContain(res.status);
      for (const id of idsDe(B)) {
        expect(cuerpo, `la respuesta a A revela ${id} de B`).not.toContain(id);
      }
    });

    test('las filas de B quedan intactas después de todas las sondas', async () => {
      const { db } = handle;
      const [vehiculo] = await db
        .select()
        .from(schema.vehicles)
        .where(eq(schema.vehicles.id, B.vehiculo.id));
      const [conductor] = await db
        .select()
        .from(schema.conductores)
        .where(eq(schema.conductores.id, B.conductor.id));
      const [sucursal] = await db
        .select()
        .from(schema.sucursalesEmpresa)
        .where(eq(schema.sucursalesEmpresa.id, B.sucursal.id));
      const [viaje] = await db.select().from(schema.trips).where(eq(schema.trips.id, B.viaje.id));
      const [asignacion] = await db
        .select()
        .from(schema.assignments)
        .where(eq(schema.assignments.id, B.asignacion.id));
      const [oferta] = await db
        .select()
        .from(schema.offers)
        .where(eq(schema.offers.id, B.oferta.id));
      const [docV] = await db
        .select()
        .from(schema.documentosVehiculo)
        .where(eq(schema.documentosVehiculo.id, B.docVehiculo.id));
      const [docC] = await db
        .select()
        .from(schema.documentosConductor)
        .where(eq(schema.documentosConductor.id, B.docConductor.id));
      expect(vehiculo?.capacityKg).toBe(B.vehiculo.capacityKg);
      expect(conductor?.licenseNumber).toBe(B.conductor.licenseNumber);
      expect(sucursal?.nombre).toBe(B.sucursal.nombre);
      expect(viaje?.status).toBe(B.viaje.status);
      expect(asignacion?.status).toBe(B.asignacion.status);
      expect(oferta?.status).toBe(B.oferta.status);
      expect(docV?.notas).toBe(B.docVehiculo.notas);
      expect(docC?.notas).toBe(B.docConductor.notas);
    });
  });

  /**
   * Control positivo: los mismos recursos, con la sesión de su dueña, responden
   * 200. Sin esto, una ruta rota que siempre devuelve 404 pasaría por aislada.
   */
  const CONTROLES: Array<[string, (b: Empresa) => string, (b: Empresa) => string]> = [
    ['GET /vehiculos/:id', (b) => `/vehiculos/${b.vehiculo.id}`, (b) => b.vehiculo.id],
    ['GET /conductores/:id', (b) => `/conductores/${b.conductor.id}`, (b) => b.conductor.id],
    ['GET /sucursales/:id', (b) => `/sucursales/${b.sucursal.id}`, (b) => b.sucursal.id],
    ['GET /trip-requests-v2/:id', (b) => `/trip-requests-v2/${b.viaje.id}`, (b) => b.viaje.id],
    ['GET /assignments/:id', (b) => `/assignments/${b.asignacion.id}`, (b) => b.asignacion.id],
    [
      'GET /documentos/vehiculo/:vehiculoId',
      (b) => `/documentos/vehiculo/${b.vehiculo.id}`,
      (b) => b.docVehiculo.id,
    ],
    [
      'GET /documentos/conductor/:conductorId',
      (b) => `/documentos/conductor/${b.conductor.id}`,
      (b) => b.docConductor.id,
    ],
    [
      'GET /transport-orders/:id/documents',
      (b) => `/transport-orders/${b.viaje.id}/documents`,
      (b) => b.docTransporte.id,
    ],
  ];

  describe('control positivo: con sesión de B, los recursos de B responden 200', () => {
    test.each(CONTROLES)('%s → 200 y trae el id propio', async (_nombre, path, idPropio) => {
      const res = await appPara(contexto(B)).request(path(B));
      const cuerpo = await res.text();
      expect(res.status, cuerpo).toBe(200);
      expect(cuerpo).toContain(idPropio(B));
    });
  });

  describe('usuario con membresía en A y en B', () => {
    test('con A activa no ve B; con B activa no ve A', async () => {
      const comoA = await appPara(contexto(A, [B])).request('/vehiculos');
      const cuerpoA = await comoA.text();
      expect(comoA.status).toBe(200);
      expect(cuerpoA).toContain(A.vehiculo.id);
      expect(cuerpoA).not.toContain(B.vehiculo.id);

      const comoB = await appPara(contexto(B, [A])).request('/vehiculos');
      const cuerpoB = await comoB.text();
      expect(comoB.status).toBe(200);
      expect(cuerpoB).toContain(B.vehiculo.id);
      expect(cuerpoB).not.toContain(A.vehiculo.id);
    });
  });
});
