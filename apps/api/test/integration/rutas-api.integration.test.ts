import { randomUUID } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import * as schema from '../../src/db/schema.js';
import { createRutasRoutes } from '../../src/routes/rutas.js';
import { asignarConductorAAssignment } from '../../src/services/asignar-conductor-a-assignment.js';
import { cancelarCarga } from '../../src/services/cancelar-carga.js';
import { confirmarEntregaViaje } from '../../src/services/confirmar-entrega-viaje.js';
import { confirmarRecogidaViaje } from '../../src/services/confirmar-recogida-viaje.js';
import { acceptOffer } from '../../src/services/offer-actions.js';
import { rutAleatorio } from '../helpers/rut-aleatorio.js';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

/**
 * ruta-parada-servicio parte 5c: la API de rutas del transportista contra
 * Postgres real, por HTTP (criterio 5 de la spec). Agrupar, quitar y
 * reordenar respetan §4.5 con la ruta planificada y en curso; una empresa no
 * opera rutas de otra; apagada, la API responde 404.
 */
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

/** Forma de las respuestas que los tests leen. */
interface RutaJson {
  id: string;
  estado: string;
  paradas: { id: string; tipo: string; servicio: { viaje_id: string; cancelado: boolean } }[];
  tramos: { masa_kg: number }[];
}
interface Cuerpo {
  error: string;
  code: string;
  rutas: RutaJson[];
  ruta: RutaJson;
  ruta_nueva_id: string;
  violaciones: { motivo: string }[];
}

describe('integration: API de rutas', () => {
  let handle: TestDbHandle;
  beforeAll(() => {
    handle = createTestDb();
  });
  afterAll(async () => {
    await handle.pool.end();
  });

  function uno<T>(rows: T[], que: string): T {
    const row = rows[0];
    if (!row) {
      throw new Error(`fixture: ${que} no creado`);
    }
    return row;
  }

  async function flota() {
    const { db } = handle;
    const suffix = randomUUID().slice(0, 8);
    const [plan] = await db
      .insert(schema.plans)
      .values({
        slug: 'gratis',
        name: 'Plan',
        description: 'fixture',
        monthlyPriceClp: 0,
        features: {},
      })
      .onConflictDoNothing({ target: schema.plans.slug })
      .returning({ id: schema.plans.id });
    const planId =
      plan?.id ?? (await db.select({ id: schema.plans.id }).from(schema.plans).limit(1)).at(0)?.id;
    if (!planId) {
      throw new Error('fixture: plan no disponible');
    }
    const usuario = async (nombre: string) =>
      uno(
        await db
          .insert(schema.users)
          .values({
            firebaseUid: `fb-${nombre}-${suffix}`,
            email: `${nombre}-${suffix}@test.invalid`,
            fullName: nombre,
            rut: rutAleatorio(),
          })
          .returning(),
        nombre,
      );
    const oficina = await usuario('oficina');
    const conductor = await usuario('conductor');
    const relevo = await usuario('relevo');
    const empresa = uno(
      await db
        .insert(schema.empresas)
        .values({
          legalName: `Empresa ${suffix}`,
          rut: rutAleatorio(),
          contactEmail: `e-${suffix}@empresa.invalid`,
          contactPhone: '+56911111111',
          addressStreet: 'Calle 1',
          addressCity: 'Santiago',
          addressRegion: 'RM',
          isTransportista: true,
          isGeneradorCarga: true,
          status: 'activa',
          planId,
        })
        .returning(),
      'empresa',
    );
    for (const [i, u] of [conductor, relevo].entries()) {
      await db.insert(schema.conductores).values({
        userId: u.id,
        empresaId: empresa.id,
        licenseClass: 'A4',
        licenseNumber: `L${i}${suffix}`,
        licenseExpiry: '2028-09-22',
      });
    }
    const vehiculo = async (prefijo: string) =>
      uno(
        await db
          .insert(schema.vehicles)
          .values({
            empresaId: empresa.id,
            plate: `${prefijo}${suffix.slice(0, 8).toUpperCase()}`,
            vehicleType: 'camion_mediano',
            capacityKg: 5000,
          })
          .returning(),
        'vehículo',
      );
    return {
      oficina,
      conductor,
      relevo,
      empresa,
      vehiculo: await vehiculo('CA'),
      otro: await vehiculo('CB'),
    };
  }
  type Flota = Awaited<ReturnType<typeof flota>>;

  /** Una carga de la flota con su oferta aceptada: asignación y ruta propia. */
  async function aceptada(f: Flota, pesoKg: number) {
    const { db } = handle;
    const viaje = uno(
      await db
        .insert(schema.trips)
        .values({
          trackingCode: randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase(),
          generadorCargaEmpresaId: f.empresa.id,
          createdByUserId: f.oficina.id,
          originAddressRaw: 'Origen',
          destinationAddressRaw: 'Destino',
          cargoType: 'carga_seca',
          cargoWeightKg: pesoKg,
          pickupDateRaw: '2026-11-20',
          status: 'ofertas_enviadas',
        })
        .returning(),
      'viaje',
    );
    const oferta = uno(
      await db
        .insert(schema.offers)
        .values({
          tripId: viaje.id,
          empresaId: f.empresa.id,
          suggestedVehicleId: f.vehiculo.id,
          score: 80,
          proposedPriceClp: 100_000,
          expiresAt: new Date(Date.now() + 3_600_000),
        })
        .returning(),
      'oferta',
    );
    const r = await acceptOffer({
      db: handle.db,
      logger,
      offerId: oferta.id,
      empresaId: f.empresa.id,
      userId: f.oficina.id,
    });
    return { viaje, assignment: r.assignment };
  }
  type Servicio = Awaited<ReturnType<typeof aceptada>>;

  const asignacion = async (s: Servicio) =>
    uno(
      await handle.db
        .select()
        .from(schema.assignments)
        .where(eq(schema.assignments.id, s.assignment.id)),
      'asignación',
    );

  const asignarConductor = (
    f: Flota,
    s: Servicio,
    driverUserId = f.conductor.id,
    vehiculoId?: string,
  ) =>
    asignarConductorAAssignment({
      db: handle.db,
      logger,
      assignmentId: s.assignment.id,
      driverUserId,
      empresaId: f.empresa.id,
      actingUserId: f.oficina.id,
      ...(vehiculoId ? { vehiculoId } : {}),
    });
  const recoger = (f: Flota, s: Servicio) =>
    confirmarRecogidaViaje({
      db: handle.db,
      logger,
      assignmentId: s.assignment.id,
      actor: {
        userId: f.oficina.id,
        empresaId: f.empresa.id,
        esConductorAsignado: false,
        esCarrierConEscritura: true,
      },
    });
  const entregar = (f: Flota, s: Servicio) =>
    confirmarEntregaViaje({
      db: handle.db,
      logger,
      tripId: s.viaje.id,
      source: 'carrier',
      actor: { empresaId: f.empresa.id, userId: f.oficina.id },
      config: {},
    });
  const cancelar = (f: Flota, s: Servicio) =>
    cancelarCarga(
      { db: handle.db, logger },
      { tripId: s.viaje.id, empresaId: f.empresa.id, userId: f.oficina.id, reason: 'ya no va' },
    );

  /** La API montada como en el server, con el usuario y su empresa ya resueltos. */
  function api(f: Flota, cfg: { rol?: string; activada?: boolean; userId?: string } = {}) {
    const app = new Hono();
    app.use('*', async (c, next) => {
      (c as unknown as { set: (k: string, v: unknown) => void }).set('userContext', {
        user: { id: cfg.userId ?? f.oficina.id },
        activeMembership: {
          membership: { id: 'm', empresaId: f.empresa.id, role: cfg.rol ?? 'despachador' },
          empresa: {
            id: f.empresa.id,
            isTransportista: true,
            isGeneradorCarga: true,
            status: 'activa',
          },
        },
      });
      await next();
    });
    app.route(
      '/rutas',
      createRutasRoutes({ db: handle.db, logger, activada: cfg.activada ?? true }),
    );
    const pedir = async (method: string, path: string, body?: unknown) => {
      const res = await app.request(path, {
        method,
        ...(body === undefined
          ? {}
          : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
      });
      return { status: res.status, body: (await res.json()) as Cuerpo };
    };
    return {
      get: (path: string) => pedir('GET', path),
      post: (path: string, body: unknown) => pedir('POST', path, body),
      put: (path: string, body: unknown) => pedir('PUT', path, body),
      del: (path: string) => pedir('DELETE', path),
    };
  }

  const rutaDe = async (s: Servicio) => (await asignacion(s)).rutaId ?? '';
  const estadoDe = async (rutaId: string) =>
    uno(await handle.db.select().from(schema.rutas).where(eq(schema.rutas.id, rutaId)), 'ruta');
  const eventosDe = async (rutaId: string) =>
    (
      await handle.db
        .select({ tipo: schema.eventosRuta.tipo })
        .from(schema.eventosRuta)
        .where(eq(schema.eventosRuta.rutaId, rutaId))
        .orderBy(asc(schema.eventosRuta.createdAt), asc(schema.eventosRuta.tipo))
    ).map((e) => e.tipo);
  const secuencia = (ruta: RutaJson) => ruta.paradas.map((p) => `${p.tipo}:${p.servicio.viaje_id}`);

  /** Flota con conductor declarado y dos cargas aceptadas, cada una en su ruta. */
  async function dosCargas(pesoA = 1000, pesoB = 2000) {
    const f = await flota();
    const a = await aceptada(f, pesoA);
    const b = await aceptada(f, pesoB);
    await asignarConductor(f, a);
    await asignarConductor(f, b);
    return { f, a, b, rutaA: await rutaDe(a), rutaB: await rutaDe(b) };
  }
  const agrupar = (f: Flota, rutaId: string, s: Servicio, recogida = 1, entrega = 2) =>
    api(f).post(`/rutas/${rutaId}/servicios`, {
      asignacion_id: s.assignment.id,
      posicion: { recogida, entrega },
    });

  const agruparComo = (f: Flota, rutaId: string, s: Servicio) =>
    api(f).post(`/rutas/${rutaId}/servicios`, {
      asignacion_id: s.assignment.id,
      posicion: { recogida: 0, entrega: 1 },
    });

  test('apagada, la API responde 404 a todo', async () => {
    const { f, rutaA } = await dosCargas();
    const off = api(f, { activada: false });
    expect(await off.get('/rutas')).toEqual({ status: 404, body: { error: 'not_found' } });
    expect((await off.get(`/rutas/${rutaA}`)).status).toBe(404);
    expect((await off.put(`/rutas/${rutaA}/paradas`, { paradas: [] })).status).toBe(404);
  });

  test('listar y ver: la ruta con sus paradas, tramos y capacidad', async () => {
    const { f, a, rutaA, rutaB } = await dosCargas();
    const lista = await api(f).get('/rutas');
    expect(lista.status).toBe(200);
    expect(lista.body.rutas.map((r: { id: string }) => r.id).sort()).toEqual([rutaA, rutaB].sort());
    expect(lista.body.rutas[0]).toMatchObject({
      estado: 'planificada',
      vehiculo: { id: f.vehiculo.id, patente: f.vehiculo.plate },
      conductor: { id: f.conductor.id, nombre: 'conductor' },
      servicios: 1,
      paradas_pendientes: 2,
    });

    const ver = await api(f).get(`/rutas/${rutaA}`);
    expect(ver.status).toBe(200);
    expect(ver.body.ruta).toMatchObject({
      id: rutaA,
      estado: 'planificada',
      unidad_arrastre: null,
      capacidad: { kg: 5000, m3: null },
      tramos: [{ desde: 0, hasta: 1, masa_kg: 1000, volumen_m3: null, vacio: false }],
      avisos: [],
    });
    expect(ver.body.ruta.paradas).toEqual([
      {
        id: expect.any(String),
        orden: 0,
        tipo: 'recogida',
        resuelta_en: null,
        servicio: {
          asignacion_id: a.assignment.id,
          viaje_id: a.viaje.id,
          codigo_seguimiento: a.viaje.trackingCode,
          cancelado: false,
          direccion: 'Origen',
          ventana: { desde: null, hasta: null },
          peso_kg: 1000,
          volumen_m3: null,
        },
      },
      expect.objectContaining({
        orden: 1,
        tipo: 'entrega',
        servicio: expect.objectContaining({ direccion: 'Destino', ventana: null }),
      }),
    ]);
    expect((await api(f).get('/rutas?estado=cerrada')).body.rutas).toEqual([]);
    expect((await api(f).get('/rutas?estado=volando')).status).toBe(400);
  });

  test('agrupar mueve el servicio, cancela la ruta que queda vacía y deja los eventos', async () => {
    const { f, a, b, rutaA, rutaB } = await dosCargas();
    const r = await agrupar(f, rutaA, b);

    expect(r.status).toBe(200);
    expect(secuencia(r.body.ruta)).toEqual([
      `recogida:${a.viaje.id}`,
      `recogida:${b.viaje.id}`,
      `entrega:${b.viaje.id}`,
      `entrega:${a.viaje.id}`,
    ]);
    expect(r.body.ruta.tramos.map((t: { masa_kg: number }) => t.masa_kg)).toEqual([
      1000, 3000, 1000,
    ]);
    expect((await asignacion(b)).rutaId).toBe(rutaA);
    expect(await estadoDe(rutaB)).toMatchObject({ status: 'cancelada' });
    expect((await estadoDe(rutaB)).cancelledAt).toBeInstanceOf(Date);
    expect(await eventosDe(rutaA)).toContain('servicio_agregado');
    expect((await eventosDe(rutaB)).slice(-2).sort()).toEqual([
      'estado_cambiado',
      'servicio_quitado',
    ]);
    // La ruta cancelada ya no aparece en la lista por defecto.
    expect((await api(f).get('/rutas')).body.rutas.map((x: { id: string }) => x.id)).toEqual([
      rutaA,
    ]);
  });

  test('agrupar rechaza con 422 y las cifras del tramo cuando no cabe', async () => {
    const { f, b, rutaA, rutaB } = await dosCargas(4000, 2000);
    const r = await agrupar(f, rutaA, b);
    expect(r).toEqual({
      status: 422,
      body: {
        error: 'ruta_invalida',
        code: 'ruta_invalida',
        violaciones: [
          { motivo: 'capacidad_peso_excedida', tramo: 1, masa_kg: 6000, capacidad_kg: 5000 },
        ],
      },
    });
    // Nada cambió.
    expect((await asignacion(b)).rutaId).toBe(rutaB);
    expect(await estadoDe(rutaB)).toMatchObject({ status: 'planificada' });
  });

  test('agrupar en una ruta en curso: solo después de la última parada resuelta (§4.5)', async () => {
    const { f, a, b, rutaA } = await dosCargas();
    await recoger(f, a);
    const antes = await agrupar(f, rutaA, b, 0, 1);
    expect(antes.status).toBe(422);
    expect(antes.body.violaciones).toEqual([
      { motivo: 'recogida_antes_de_parada_resuelta', viaje_id: b.viaje.id },
    ]);
    const despues = await agrupar(f, rutaA, b, 1, 2);
    expect(despues.status).toBe(200);
    expect(despues.body.ruta.estado).toBe('en_curso');
  });

  test('un servicio ya recogido no se agrupa en otra ruta', async () => {
    const { f, b, rutaA } = await dosCargas();
    await recoger(f, b);
    const r = await agrupar(f, rutaA, b);
    expect(r.status).toBe(422);
    expect(r.body.violaciones).toEqual([{ motivo: 'servicio_ya_recogido', viaje_id: b.viaje.id }]);
  });

  test('quitar devuelve el servicio a una ruta propia, con el camión y el conductor de la ruta', async () => {
    const { f, a, b, rutaA } = await dosCargas();
    await agrupar(f, rutaA, b);
    const r = await api(f).del(`/rutas/${rutaA}/servicios/${b.assignment.id}`);

    expect(r.status).toBe(200);
    expect(secuencia(r.body.ruta)).toEqual([`recogida:${a.viaje.id}`, `entrega:${a.viaje.id}`]);
    const nueva = r.body.ruta_nueva_id;
    expect((await asignacion(b)).rutaId).toBe(nueva);
    expect(await estadoDe(nueva)).toMatchObject({
      status: 'planificada',
      vehicleId: f.vehiculo.id,
      driverUserId: f.conductor.id,
    });
    const ver = await api(f).get(`/rutas/${nueva}`);
    expect(secuencia(ver.body.ruta)).toEqual([`recogida:${b.viaje.id}`, `entrega:${b.viaje.id}`]);
    expect(await eventosDe(nueva)).toEqual(['ruta_creada']);
  });

  test('quitar: no el único servicio, ni uno ya recogido (§4.5)', async () => {
    const { f, a, b, rutaA } = await dosCargas();
    const unico = await api(f).del(`/rutas/${rutaA}/servicios/${a.assignment.id}`);
    expect(unico.status).toBe(422);
    expect(unico.body.violaciones[0].motivo).toBe('servicio_unico_de_la_ruta');

    await agrupar(f, rutaA, b);
    await recoger(f, b);
    const recogido = await api(f).del(`/rutas/${rutaA}/servicios/${b.assignment.id}`);
    expect(recogido.status).toBe(422);
    expect(recogido.body.violaciones[0].motivo).toBe('servicio_ya_recogido');
    // El que no se ha recogido sí se puede quitar con la ruta en curso.
    expect((await api(f).del(`/rutas/${rutaA}/servicios/${a.assignment.id}`)).status).toBe(200);
  });

  test('reordenar por ids; las paradas resueltas no se mueven (§4.5)', async () => {
    const { f, a, b, rutaA } = await dosCargas();
    const agrupada = (await agrupar(f, rutaA, b)).body.ruta;
    const ids: string[] = agrupada.paradas.map((p: { id: string }) => p.id);
    const [ra, rb, eb, ea] = ids as [string, string, string, string];

    const r = await api(f).put(`/rutas/${rutaA}/paradas`, { paradas: [rb, ra, ea, eb] });
    expect(r.status).toBe(200);
    expect(secuencia(r.body.ruta)).toEqual([
      `recogida:${b.viaje.id}`,
      `recogida:${a.viaje.id}`,
      `entrega:${a.viaje.id}`,
      `entrega:${b.viaje.id}`,
    ]);
    expect(await eventosDe(rutaA)).toContain('paradas_reordenadas');

    const entregaAntes = await api(f).put(`/rutas/${rutaA}/paradas`, { paradas: [eb, rb, ra, ea] });
    expect(entregaAntes.status).toBe(422);
    expect(entregaAntes.body.violaciones[0].motivo).toBe('entrega_antes_de_recogida');
    const ajena = await api(f).put(`/rutas/${rutaA}/paradas`, {
      paradas: [rb, ra, ea, randomUUID()],
    });
    expect(ajena.body.violaciones).toEqual([{ motivo: 'orden_invalido' }]);

    await recoger(f, b);
    const mueveResuelta = await api(f).put(`/rutas/${rutaA}/paradas`, {
      paradas: [ra, rb, ea, eb],
    });
    expect(mueveResuelta.status).toBe(422);
    expect(mueveResuelta.body.violaciones).toEqual([{ motivo: 'parada_resuelta_movida' }]);
    expect(
      (await api(f).put(`/rutas/${rutaA}/paradas`, { paradas: [rb, ra, eb, ea] })).status,
    ).toBe(200);
  });

  test('declarar: cambia camión y conductor en la ruta y en sus asignaciones', async () => {
    const { f, a, b, rutaA } = await dosCargas();
    await agrupar(f, rutaA, b);
    const r = await api(f).put(`/rutas/${rutaA}/configuracion`, {
      vehiculo_id: f.otro.id,
      unidad_arrastre_id: null,
      conductor_id: f.relevo.id,
    });
    expect(r.status).toBe(200);
    expect(r.body.ruta).toMatchObject({
      vehiculo: { id: f.otro.id },
      conductor: { id: f.relevo.id, nombre: 'relevo' },
    });
    for (const s of [a, b]) {
      expect(await asignacion(s)).toMatchObject({
        vehicleId: f.otro.id,
        driverUserId: f.relevo.id,
      });
    }
    expect((await eventosDe(rutaA)).at(-1)).toBe('configuracion_declarada');
  });

  test('declarar con carga recogida: el conductor se releva, el camión no (D1)', async () => {
    const { f, a, rutaA } = await dosCargas();
    await recoger(f, a);
    const camion = await api(f).put(`/rutas/${rutaA}/configuracion`, {
      vehiculo_id: f.otro.id,
      unidad_arrastre_id: null,
      conductor_id: f.conductor.id,
    });
    expect(camion.status).toBe(422);
    expect(camion.body.violaciones).toEqual([{ motivo: 'vehiculo_con_carga_recogida' }]);

    const relevo = await api(f).put(`/rutas/${rutaA}/configuracion`, {
      vehiculo_id: f.vehiculo.id,
      unidad_arrastre_id: null,
      conductor_id: f.relevo.id,
    });
    expect(relevo.status).toBe(200);
    expect(await estadoDe(rutaA)).toMatchObject({ status: 'en_curso', driverUserId: f.relevo.id });

    const sin = await api(f).put(`/rutas/${rutaA}/configuracion`, {
      vehiculo_id: f.vehiculo.id,
      unidad_arrastre_id: null,
      conductor_id: null,
    });
    expect(sin.body.violaciones).toEqual([{ motivo: 'en_curso_sin_conductor' }]);
  });

  test('declarar rechaza un camión que no alcanza, ajeno o que no es motriz, y un conductor ajeno', async () => {
    const { f, b, rutaA } = await dosCargas();
    await agrupar(f, rutaA, b);
    const otra = await flota();
    const declarar = (cuerpo: Record<string, unknown>) =>
      api(f).put(`/rutas/${rutaA}/configuracion`, {
        vehiculo_id: f.vehiculo.id,
        unidad_arrastre_id: null,
        conductor_id: f.conductor.id,
        ...cuerpo,
      });

    const chico = uno(
      await handle.db
        .insert(schema.vehicles)
        .values({
          empresaId: f.empresa.id,
          plate: `CH${randomUUID().slice(0, 4).toUpperCase()}`,
          vehicleType: 'camion_mediano',
          capacityKg: 2500,
        })
        .returning(),
      'vehículo chico',
    );
    const noAlcanza = await declarar({ vehiculo_id: chico.id });
    expect(noAlcanza.status).toBe(422);
    expect(noAlcanza.body.violaciones).toEqual([
      { motivo: 'capacidad_peso_excedida', tramo: 1, masa_kg: 3000, capacidad_kg: 2500 },
    ]);

    expect(await declarar({ vehiculo_id: otra.vehiculo.id })).toEqual({
      status: 422,
      body: {
        error: 'vehiculo_no_asignable',
        code: 'vehiculo_no_asignable',
        unidad: 'vehiculo',
        motivo: 'no_es_de_la_flota',
      },
    });
    expect((await declarar({ unidad_arrastre_id: f.otro.id })).body).toMatchObject({
      code: 'vehiculo_no_asignable',
      unidad: 'unidad_arrastre',
      motivo: 'no_es_arrastre',
    });
    expect(await declarar({ conductor_id: otra.conductor.id })).toEqual({
      status: 422,
      body: { error: 'conductor_no_asignable', code: 'conductor_no_asignable' },
    });
    expect((await declarar({ vehiculo_id: 'no-es-uuid' })).status).toBe(400);
    expect(await estadoDe(rutaA)).toMatchObject({
      vehicleId: f.vehiculo.id,
      driverUserId: f.conductor.id,
    });
  });

  test('una empresa no ve ni opera las rutas de otra', async () => {
    const { a, b, rutaA } = await dosCargas();
    const intrusa = await flota();
    const ajena = await aceptada(intrusa, 500);
    const x = api(intrusa);

    expect((await x.get('/rutas')).body.rutas.map((r: { id: string }) => r.id)).toEqual([
      await rutaDe(ajena),
    ]);
    const noExiste = { status: 404, body: { error: 'ruta_not_found', code: 'ruta_not_found' } };
    expect(await x.get(`/rutas/${rutaA}`)).toEqual(noExiste);
    expect(
      await x.put(`/rutas/${rutaA}/paradas`, { paradas: [randomUUID(), randomUUID()] }),
    ).toEqual(noExiste);
    expect(
      await x.put(`/rutas/${rutaA}/configuracion`, {
        vehiculo_id: intrusa.vehiculo.id,
        unidad_arrastre_id: null,
        conductor_id: null,
      }),
    ).toEqual(noExiste);
    expect(await x.del(`/rutas/${rutaA}/servicios/${a.assignment.id}`)).toEqual(noExiste);
    // Ni mete una carga suya en la ruta ajena, ni se lleva una ajena a la suya.
    expect(await agruparComo(intrusa, rutaA, ajena)).toEqual(noExiste);
    expect((await agruparComo(intrusa, await rutaDe(ajena), b)).body.code).toBe(
      'asignacion_not_found',
    );
    expect(await x.get('/rutas/no-es-uuid')).toEqual(noExiste);
    expect((await asignacion(b)).rutaId).not.toBe(await rutaDe(ajena));
    expect((await asignacion(ajena)).rutaId).not.toBe(rutaA);
  });
  test('roles: el visualizador lee y no escribe; el conductor no usa /rutas', async () => {
    const { f, b, rutaA } = await dosCargas();
    const lector = api(f, { rol: 'visualizador' });
    expect((await lector.get(`/rutas/${rutaA}`)).status).toBe(200);
    const escribir = await lector.post(`/rutas/${rutaA}/servicios`, {
      asignacion_id: b.assignment.id,
      posicion: { recogida: 1, entrega: 2 },
    });
    expect(escribir).toEqual({
      status: 403,
      body: { error: 'forbidden', code: 'capability_denied', capability: 'puedeAsignarViaje' },
    });
    expect((await api(f, { rol: 'conductor' }).get('/rutas')).status).toBe(403);
    expect((await api(f, { rol: 'dueno' }).get('/rutas')).status).toBe(200);
  });

  test('una carga cancelada sigue en la ruta, marcada, y no se puede quitar ni mover', async () => {
    const { f, b, rutaA } = await dosCargas();
    await agrupar(f, rutaA, b);
    await cancelar(f, b);
    const ver = await api(f).get(`/rutas/${rutaA}`);
    expect(ver.body.ruta.paradas.map((p) => p.servicio.cancelado)).toEqual([
      false,
      true,
      true,
      false,
    ]);
    expect(ver.body.ruta.tramos.map((t: { masa_kg: number }) => t.masa_kg)).toEqual([
      1000, 1000, 1000,
    ]);
    const quitar = await api(f).del(`/rutas/${rutaA}/servicios/${b.assignment.id}`);
    expect(quitar.body.violaciones).toEqual([
      { motivo: 'servicio_cancelado', viaje_id: b.viaje.id },
    ]);
  });

  test('el flujo completo: agrupar, recoger y entregar cierra la ruta', async () => {
    const { f, a, b, rutaA } = await dosCargas();
    await agrupar(f, rutaA, b);
    for (const s of [a, b]) {
      expect((await recoger(f, s)).ok).toBe(true);
    }
    for (const s of [b, a]) {
      expect((await entregar(f, s)).ok).toBe(true);
    }
    expect((await api(f).get(`/rutas/${rutaA}`)).body.ruta.estado).toBe('cerrada');
    expect(
      (await api(f).get('/rutas?estado=cerrada')).body.rutas.map((r: { id: string }) => r.id),
    ).toEqual([rutaA]);
  });
});
