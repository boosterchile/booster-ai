import { getTableName } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { confirmarRecogidaViaje } from './confirmar-recogida-viaje.js';

/**
 * Confirmar recogida — el paso que la máquina de estados modelaba y nadie
 * escribía (`asignaciones.recogido` / `viajes.en_proceso`).
 *
 * Las columnas (`recogido_en`, `evidencia_recogida_url`), el tipo de evento
 * (`recogida_confirmada`) y ambos estados existían desde 2026-06; faltaba
 * únicamente la escritura. Sin ella, Servicios mostraba «Por recoger» para un
 * camión en ruta y el tracking público nunca arrancaba.
 */

const noop = (): void => undefined;
const logger = {
  trace: noop,
  debug: noop,
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: noop,
  child: () => logger,
} as never;

const ASSIGNMENT_ID = 'as-1';
const TRIP_ID = 'tr-1';
const EMPRESA_ID = 'emp-1';
const DRIVER_ID = 'drv-1';

interface Estado {
  assignmentStatus: string;
  tripStatus: string;
  driverUserId: string | null;
  pickedUpAt: Date | null;
  /** Aceptación de la oferta: cota inferior del `pickedUpAt` provisto (T9). */
  acceptedAt?: Date;
}

const ACCEPTED_AT = new Date('2026-08-01T12:00:00Z');

/**
 * DB falsa que modela lo que importa: el CAS por estado en el WHERE. Un update
 * cuyo estado ya cambió NO devuelve fila — igual que Postgres.
 */
function makeDb(estado: Estado, opts: { assignmentExists?: boolean } = {}) {
  const inserts: Array<Record<string, unknown>> = [];
  const updates: Array<{ tabla: string; set: Record<string, unknown> }> = [];
  const exists = opts.assignmentExists ?? true;

  const tx = {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({
            limit: async () =>
              exists
                ? [
                    {
                      assignmentId: ASSIGNMENT_ID,
                      assignmentStatus: estado.assignmentStatus,
                      driverUserId: estado.driverUserId,
                      pickedUpAt: estado.pickedUpAt,
                      acceptedAt: estado.acceptedAt ?? ACCEPTED_AT,
                      empresaId: EMPRESA_ID,
                      tripId: TRIP_ID,
                      tripStatus: estado.tripStatus,
                    },
                  ]
                : [],
            for: () => ({ limit: async () => (exists ? [{}] : []) }),
          }),
        }),
      }),
    }),
    update: (tabla: unknown) => ({
      set: (set: Record<string, unknown>) => ({
        where: () => ({
          returning: async () => {
            // `getTableName` es el helper oficial de Drizzle: leer `._.name`
            // a mano devuelve undefined y el test terminaba verificando nada.
            const nombre = getTableName(tabla as never);
            // CAS: solo "afecta filas" si el estado de partida sigue siendo el
            // esperado. Modelamos el caso viaje: asignado → en_proceso.
            if (nombre === 'viajes' && estado.tripStatus !== 'asignado') {
              return [];
            }
            updates.push({ tabla: nombre, set });
            return [{ id: 'x' }];
          },
        }),
      }),
    }),
    insert: () => ({
      values: async (v: Record<string, unknown>) => {
        inserts.push(v);
      },
    }),
  };

  return {
    db: { transaction: async (fn: (t: unknown) => unknown) => fn(tx) } as never,
    inserts,
    updates,
  };
}

const actor = { userId: DRIVER_ID, empresaId: EMPRESA_ID, esConductorAsignado: true };

beforeEach(() => vi.clearAllMocks());

describe('confirmarRecogidaViaje', () => {
  it('marca la asignación recogida Y el viaje en proceso, en una sola pasada', async () => {
    const { db, updates, inserts } = makeDb({
      assignmentStatus: 'asignado',
      tripStatus: 'asignado',
      driverUserId: DRIVER_ID,
      pickedUpAt: null,
    });

    const r = await confirmarRecogidaViaje({ db, logger, assignmentId: ASSIGNMENT_ID, actor });

    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    expect(r.alreadyPickedUp).toBe(false);
    expect(r.pickedUpAt).toBeInstanceOf(Date);

    // Las dos capas: sin la del viaje, el tracking público sigue sin mostrar
    // la posición (POSITION_VISIBLE_STATUSES exige asignado|en_proceso).
    const viaje = updates.find((u) => u.tabla === 'viajes');
    const asig = updates.find((u) => u.tabla === 'asignaciones');
    expect(viaje?.set.status).toBe('en_proceso');
    expect(asig?.set.status).toBe('recogido');
    expect(asig?.set.pickedUpAt).toBeInstanceOf(Date);

    expect(inserts).toHaveLength(1);
    expect(inserts[0]?.eventType).toBe('recogida_confirmada');
    expect(inserts[0]?.tripId).toBe(TRIP_ID);
  });

  it('confirmar dos veces es idempotente y NO duplica el evento', async () => {
    const { db, inserts, updates } = makeDb({
      assignmentStatus: 'recogido',
      tripStatus: 'en_proceso',
      driverUserId: DRIVER_ID,
      pickedUpAt: new Date('2026-08-03T05:00:00Z'),
    });

    const r = await confirmarRecogidaViaje({ db, logger, assignmentId: ASSIGNMENT_ID, actor });

    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    // Un conductor con señal intermitente toca el botón dos veces. Eso no
    // puede ser un error ni ensuciar la auditoría.
    expect(r.alreadyPickedUp).toBe(true);
    expect(r.pickedUpAt).toEqual(new Date('2026-08-03T05:00:00Z'));
    expect(inserts).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });

  it('un viaje ya entregado no vuelve a recogido', async () => {
    const { db } = makeDb({
      assignmentStatus: 'entregado',
      tripStatus: 'entregado',
      driverUserId: DRIVER_ID,
      pickedUpAt: null,
    });
    const r = await confirmarRecogidaViaje({ db, logger, assignmentId: ASSIGNMENT_ID, actor });
    expect(r.ok).toBe(false);
    if (r.ok) {
      return;
    }
    expect(r.code).toBe('invalid_status');
  });

  it('un viaje cancelado tampoco', async () => {
    const { db } = makeDb({
      assignmentStatus: 'cancelado',
      tripStatus: 'cancelado',
      driverUserId: DRIVER_ID,
      pickedUpAt: null,
    });
    const r = await confirmarRecogidaViaje({ db, logger, assignmentId: ASSIGNMENT_ID, actor });
    expect(r.ok).toBe(false);
  });

  it('assignment inexistente → not_found', async () => {
    const { db } = makeDb(
      {
        assignmentStatus: 'asignado',
        tripStatus: 'asignado',
        driverUserId: DRIVER_ID,
        pickedUpAt: null,
      },
      { assignmentExists: false },
    );
    const r = await confirmarRecogidaViaje({ db, logger, assignmentId: ASSIGNMENT_ID, actor });
    expect(r.ok).toBe(false);
    if (r.ok) {
      return;
    }
    expect(r.code).toBe('assignment_not_found');
  });

  it('un conductor que NO es el asignado no puede confirmar', async () => {
    const { db, updates } = makeDb({
      assignmentStatus: 'asignado',
      tripStatus: 'asignado',
      driverUserId: 'otro-conductor',
      pickedUpAt: null,
    });
    const r = await confirmarRecogidaViaje({
      db,
      logger,
      assignmentId: ASSIGNMENT_ID,
      actor: { userId: DRIVER_ID, empresaId: EMPRESA_ID, esConductorAsignado: false },
    });
    expect(r.ok).toBe(false);
    if (r.ok) {
      return;
    }
    expect(r.code).toBe('forbidden');
    expect(updates).toHaveLength(0);
  });

  it('el transportista dueño del servicio SÍ puede confirmar (respaldo de oficina)', async () => {
    // Un conductor sin smartphone o sin señal en un patio no puede dejar la
    // operación congelada.
    const { db, updates } = makeDb({
      assignmentStatus: 'asignado',
      tripStatus: 'asignado',
      driverUserId: 'otro-conductor',
      pickedUpAt: null,
    });
    const r = await confirmarRecogidaViaje({
      db,
      logger,
      assignmentId: ASSIGNMENT_ID,
      actor: {
        userId: 'jefa-1',
        empresaId: EMPRESA_ID,
        esConductorAsignado: false,
        esCarrierConEscritura: true,
      },
    });
    expect(r.ok).toBe(true);
    expect(updates.find((u) => u.tabla === 'asignaciones')?.set.status).toBe('recogido');
  });

  it('un transportista de OTRA empresa no puede confirmar', async () => {
    const { db } = makeDb({
      assignmentStatus: 'asignado',
      tripStatus: 'asignado',
      driverUserId: DRIVER_ID,
      pickedUpAt: null,
    });
    const r = await confirmarRecogidaViaje({
      db,
      logger,
      assignmentId: ASSIGNMENT_ID,
      actor: {
        userId: 'jefa-2',
        empresaId: 'OTRA-empresa',
        esConductorAsignado: false,
        esCarrierConEscritura: true,
      },
    });
    expect(r.ok).toBe(false);
    if (r.ok) {
      return;
    }
    expect(r.code).toBe('forbidden');
  });

  it('si el viaje ya avanzó entre el read y el update, el CAS lo frena', async () => {
    // Carrera real: dos toques concurrentes. El WHERE por estado es el
    // invariante; sin él, el segundo pisaría el lifecycle.
    const { db } = makeDb({
      assignmentStatus: 'asignado',
      tripStatus: 'en_proceso',
      driverUserId: DRIVER_ID,
      pickedUpAt: null,
    });
    const r = await confirmarRecogidaViaje({ db, logger, assignmentId: ASSIGNMENT_ID, actor });
    expect(r.ok).toBe(false);
    if (r.ok) {
      return;
    }
    expect(r.code).toBe('invalid_status');
  });

  // -------------------------------------------------------------------------
  // T9 (medicion-huella-segmento): `pickedUpAt` opcional = instante del cruce
  // del geofence, provisto por el cliente. Ancla la ventana de medición GLEC,
  // así que se acota en el servidor: ni futuro (más allá del skew de reloj)
  // ni anterior a la aceptación del servicio. Sin él → now (tap manual).
  // -------------------------------------------------------------------------
  describe('pickedUpAt provisto (instante del cruce del geofence)', () => {
    const CRUCE = new Date('2026-08-02T09:30:00Z');

    it('dentro de cotas → se persiste ESE instante y el evento lo declara de fuente cliente', async () => {
      const { db, updates, inserts } = makeDb({
        assignmentStatus: 'asignado',
        tripStatus: 'asignado',
        driverUserId: DRIVER_ID,
        pickedUpAt: null,
      });

      const r = await confirmarRecogidaViaje({
        db,
        logger,
        assignmentId: ASSIGNMENT_ID,
        actor,
        pickedUpAt: CRUCE,
      });

      expect(r.ok).toBe(true);
      if (!r.ok) {
        return;
      }
      expect(r.pickedUpAt).toEqual(CRUCE);
      const asig = updates.find((u) => u.tabla === 'asignaciones');
      expect(asig?.set.pickedUpAt).toEqual(CRUCE);
      const payload = inserts[0]?.payload as Record<string, unknown>;
      expect(payload.picked_up_at).toBe(CRUCE.toISOString());
      expect(payload.picked_up_at_source).toBe('cliente');
    });

    it('sin pickedUpAt → now, y el evento lo declara de fuente servidor', async () => {
      const { db, inserts } = makeDb({
        assignmentStatus: 'asignado',
        tripStatus: 'asignado',
        driverUserId: DRIVER_ID,
        pickedUpAt: null,
      });

      const r = await confirmarRecogidaViaje({ db, logger, assignmentId: ASSIGNMENT_ID, actor });

      expect(r.ok).toBe(true);
      const payload = inserts[0]?.payload as Record<string, unknown>;
      expect(payload.picked_up_at_source).toBe('servidor');
    });

    it('en el futuro (más allá de 2 min de skew) → invalid_picked_up_at y NO escribe nada', async () => {
      const { db, updates, inserts } = makeDb({
        assignmentStatus: 'asignado',
        tripStatus: 'asignado',
        driverUserId: DRIVER_ID,
        pickedUpAt: null,
      });

      const r = await confirmarRecogidaViaje({
        db,
        logger,
        assignmentId: ASSIGNMENT_ID,
        actor,
        pickedUpAt: new Date(Date.now() + 10 * 60_000),
      });

      expect(r.ok).toBe(false);
      if (r.ok) {
        return;
      }
      expect(r.code).toBe('invalid_picked_up_at');
      expect(updates).toHaveLength(0);
      expect(inserts).toHaveLength(0);
    });

    it('anterior a la aceptación del servicio → invalid_picked_up_at y NO escribe nada', async () => {
      const { db, updates, inserts } = makeDb({
        assignmentStatus: 'asignado',
        tripStatus: 'asignado',
        driverUserId: DRIVER_ID,
        pickedUpAt: null,
        acceptedAt: ACCEPTED_AT,
      });

      const r = await confirmarRecogidaViaje({
        db,
        logger,
        assignmentId: ASSIGNMENT_ID,
        actor,
        pickedUpAt: new Date(ACCEPTED_AT.getTime() - 60_000),
      });

      expect(r.ok).toBe(false);
      if (r.ok) {
        return;
      }
      expect(r.code).toBe('invalid_picked_up_at');
      expect(updates).toHaveLength(0);
      expect(inserts).toHaveLength(0);
    });

    it('un skew de reloj pequeño (≤ 2 min hacia el futuro) se acepta', async () => {
      const { db } = makeDb({
        assignmentStatus: 'asignado',
        tripStatus: 'asignado',
        driverUserId: DRIVER_ID,
        pickedUpAt: null,
      });

      const r = await confirmarRecogidaViaje({
        db,
        logger,
        assignmentId: ASSIGNMENT_ID,
        actor,
        pickedUpAt: new Date(Date.now() + 60_000),
      });

      expect(r.ok).toBe(true);
    });
  });
});
