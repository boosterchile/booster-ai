import type { Logger } from '@booster-ai/logger';
import { ESTADOS_RUTA, type EstadoRuta } from '@booster-ai/route-planner';
import { puedeAsignarViaje, veSoloSuViaje } from '@booster-ai/shared-schemas';
import { type Context, Hono } from 'hono';
import { z } from 'zod';
import { ctxDeUserContext } from '../auth/capacidades.js';
import type { Db } from '../db/client.js';
import { zValidator } from '../lib/validation.js';
import { getBusinessCounter } from '../observability/business-metrics.js';
import { setResultAttributes, withBusinessSpan } from '../observability/business-span.js';
import { estimarHuellaDeRuta } from '../services/estimar-huella-de-ruta.js';
import {
  type FalloDeRuta,
  agruparServicio,
  declararConfiguracionDeRuta,
  listarRutas,
  quitarServicioDeRuta,
  reordenarParadasDeRuta,
  verRuta,
} from '../services/operar-ruta.js';

/**
 * API de rutas del transportista (spec ruta-parada-servicio §5; contrato en
 * `.specs/ruta-parada-servicio/plan.md` §3, aprobado por el PO).
 *
 *   GET    /rutas                                  listar
 *   GET    /rutas/:id                              ver
 *   POST   /rutas/:id/servicios                    agrupar
 *   DELETE /rutas/:id/servicios/:asignacion_id     quitar
 *   PUT    /rutas/:id/paradas                      reordenar
 *   PUT    /rutas/:id/configuracion                vehículo, arrastre y conductor
 *
 * Detrás de `RUTAS_API_ACTIVADA`: apagada, todo responde 404. Se enciende con
 * la web (parte 6), el seguimiento (parte 7) y el reparto de huella.
 */

const operaciones = getBusinessCounter('rutas_operaciones_total');

type Operacion = 'listar' | 'ver' | 'agrupar' | 'quitar' | 'reordenar' | 'declarar';

const ESTADOS_POR_DEFECTO: readonly EstadoRuta[] = ['planificada', 'en_curso'];

const listarQuerySchema = z.object({
  estado: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').map((e) => e.trim()) : [...ESTADOS_POR_DEFECTO]))
    .pipe(z.array(z.enum(ESTADOS_RUTA)).min(1)),
});

const agruparBodySchema = z.object({
  asignacion_id: z.string().uuid(),
  posicion: z.object({
    recogida: z.number().int().min(0),
    entrega: z.number().int().min(1),
  }),
});

const reordenarBodySchema = z.object({ paradas: z.array(z.string().uuid()).min(2).max(200) });

const configuracionBodySchema = z.object({
  vehiculo_id: z.string().uuid(),
  unidad_arrastre_id: z.string().uuid().nullable(),
  conductor_id: z.string().uuid().nullable(),
});

const idSchema = z.object({ id: z.string().uuid() });
const idsQuitarSchema = idSchema.extend({ asignacion_id: z.string().uuid() });

export function createRutasRoutes(opts: {
  db: Db;
  logger: Logger;
  activada: boolean;
  /** Proyecto de Routes para la distancia entre paradas; sin él se usa la tabla por región. */
  routesProjectId?: string | undefined;
}) {
  const app = new Hono();

  // Apagada, la API no existe: ni siquiera dice que hay algo detrás.
  app.use('*', async (c, next) => {
    if (!opts.activada) {
      return c.json({ error: 'not_found' }, 404);
    }
    return next();
  });

  /** Un id que no es uuid es una ruta que no existe. */
  const idInvalido = (result: { success: boolean }, c: Context) =>
    result.success ? undefined : c.json({ error: 'ruta_not_found', code: 'ruta_not_found' }, 404);

  function autorizar(c: Context, operacion: Operacion, escribe: boolean) {
    const negar = (response: Response) => {
      operaciones.add(1, { operacion, resultado: 'forbidden' });
      return { ok: false as const, response };
    };
    const userContext = c.get('userContext');
    if (!userContext) {
      opts.logger.error({ path: c.req.path }, '/rutas without userContext');
      return negar(c.json({ error: 'unauthorized' }, 401));
    }
    const active = userContext.activeMembership;
    if (!active) {
      return negar(c.json({ error: 'no_active_empresa', code: 'no_active_empresa' }, 403));
    }
    if (!active.empresa.isTransportista) {
      return negar(c.json({ error: 'not_a_carrier', code: 'not_a_carrier' }, 403));
    }
    if (active.empresa.status !== 'activa') {
      return negar(c.json({ error: 'empresa_not_active', code: 'empresa_not_active' }, 403));
    }
    const ctx = ctxDeUserContext(userContext);
    // El conductor no usa /rutas: su hoja de ruta va por /me (parte 6).
    const puede = ctx !== null && (escribe ? puedeAsignarViaje(ctx) : !veSoloSuViaje(ctx));
    if (!puede) {
      return negar(
        c.json(
          {
            error: 'forbidden',
            code: 'capability_denied',
            capability: escribe ? 'puedeAsignarViaje' : 'verRutas',
          },
          403,
        ),
      );
    }
    return { ok: true as const, empresaId: active.empresa.id, userId: userContext.user.id };
  }

  function responderFallo(c: Context, fallo: FalloDeRuta) {
    switch (fallo.code) {
      case 'ruta_not_found':
      case 'asignacion_not_found':
        return c.json({ error: fallo.code, code: fallo.code }, 404);
      case 'ruta_invalida':
        return c.json(
          {
            error: fallo.code,
            code: fallo.code,
            violaciones: fallo.violaciones.map((v) => ({
              motivo: v.motivo,
              ...(v.servicioId !== undefined ? { viaje_id: v.servicioId } : {}),
              ...(v.tramo !== undefined ? { tramo: v.tramo } : {}),
              ...(v.masaKg !== undefined ? { masa_kg: v.masaKg } : {}),
              ...(v.capacidadKg !== undefined ? { capacidad_kg: v.capacidadKg } : {}),
            })),
          },
          422,
        );
      case 'vehiculo_no_asignable':
        return c.json(
          { error: fallo.code, code: fallo.code, unidad: fallo.unidad, motivo: fallo.motivo },
          422,
        );
      case 'conductor_no_asignable':
        return c.json({ error: fallo.code, code: fallo.code }, 422);
    }
  }

  /** Span, métrica y respuesta comunes a las operaciones sobre una ruta. */
  async function operar<T extends { ok: true }>(
    c: Context,
    operacion: Operacion,
    ids: { empresaId: string; rutaId: string },
    ejecutar: () => Promise<T | FalloDeRuta>,
    responder: (r: T) => Response,
    /** Las rutas cuya huella estimada cambia con la operación. */
    afectadas: (r: T) => readonly string[] = () => [],
  ) {
    return withBusinessSpan(
      {
        name: `rutas.${operacion}`,
        attributes: { 'booster.empresa_id': ids.empresaId, 'booster.ruta_id': ids.rutaId },
      },
      async (span) => {
        const r = await ejecutar();
        const resultado = r.ok ? 'ok' : r.code;
        setResultAttributes(span, { 'booster.outcome': resultado });
        operaciones.add(1, { operacion, resultado });
        if (!r.ok) {
          return responderFallo(c, r);
        }
        if (operacion !== 'ver') {
          opts.logger.info({ ...ids, operacion }, 'ruta modificada por la API');
        }
        // Después del commit: la estimación de cada carga sigue a su ruta
        // (huella-consolidada §3.9). Si falla, la operación ya quedó hecha y
        // la próxima vuelve a intentarlo.
        for (const rutaId of new Set(afectadas(r))) {
          try {
            await estimarHuellaDeRuta({
              db: opts.db,
              logger: opts.logger,
              rutaId,
              routesProjectId: opts.routesProjectId,
            });
          } catch (err) {
            opts.logger.error({ err, rutaId, operacion }, 'la estimación de la ruta falló');
          }
        }
        return responder(r);
      },
    );
  }

  app.get('/', zValidator('query', listarQuerySchema), async (c) => {
    const auth = autorizar(c, 'listar', false);
    if (!auth.ok) {
      return auth.response;
    }
    const { estado } = c.req.valid('query');
    return withBusinessSpan(
      { name: 'rutas.listar', attributes: { 'booster.empresa_id': auth.empresaId } },
      async (span) => {
        const lista = await listarRutas(opts.db, { empresaId: auth.empresaId, estados: estado });
        setResultAttributes(span, { 'booster.outcome': 'ok', 'booster.rutas': lista.length });
        operaciones.add(1, { operacion: 'listar', resultado: 'ok' });
        return c.json({ rutas: lista });
      },
    );
  });

  app.get('/:id', zValidator('param', idSchema, idInvalido), async (c) => {
    const auth = autorizar(c, 'ver', false);
    if (!auth.ok) {
      return auth.response;
    }
    const ids = { empresaId: auth.empresaId, rutaId: c.req.valid('param').id };
    return operar(
      c,
      'ver',
      ids,
      () => verRuta(opts.db, ids),
      (r) => c.json({ ruta: r.ruta }),
    );
  });

  app.post(
    '/:id/servicios',
    zValidator('param', idSchema, idInvalido),
    zValidator('json', agruparBodySchema),
    async (c) => {
      const auth = autorizar(c, 'agrupar', true);
      if (!auth.ok) {
        return auth.response;
      }
      const ids = { empresaId: auth.empresaId, rutaId: c.req.valid('param').id };
      const body = c.req.valid('json');
      return operar(
        c,
        'agrupar',
        ids,
        () =>
          agruparServicio(opts.db, {
            ...ids,
            asignacionId: body.asignacion_id,
            posicion: body.posicion,
            userId: auth.userId,
          }),
        (r) => c.json({ ruta: r.ruta }),
        (r) => [r.ruta.id, r.rutaOrigenId],
      );
    },
  );

  app.delete(
    '/:id/servicios/:asignacion_id',
    zValidator('param', idsQuitarSchema, idInvalido),
    async (c) => {
      const auth = autorizar(c, 'quitar', true);
      if (!auth.ok) {
        return auth.response;
      }
      const param = c.req.valid('param');
      const ids = { empresaId: auth.empresaId, rutaId: param.id };
      return operar(
        c,
        'quitar',
        ids,
        () =>
          quitarServicioDeRuta(opts.db, {
            ...ids,
            asignacionId: param.asignacion_id,
            userId: auth.userId,
          }),
        (r) => c.json({ ruta: r.ruta, ruta_nueva_id: r.rutaNuevaId }),
        (r) => [r.ruta.id, r.rutaNuevaId],
      );
    },
  );

  app.put(
    '/:id/paradas',
    zValidator('param', idSchema, idInvalido),
    zValidator('json', reordenarBodySchema),
    async (c) => {
      const auth = autorizar(c, 'reordenar', true);
      if (!auth.ok) {
        return auth.response;
      }
      const ids = { empresaId: auth.empresaId, rutaId: c.req.valid('param').id };
      return operar(
        c,
        'reordenar',
        ids,
        () =>
          reordenarParadasDeRuta(opts.db, {
            ...ids,
            paradaIds: c.req.valid('json').paradas,
            userId: auth.userId,
          }),
        (r) => c.json({ ruta: r.ruta }),
        (r) => [r.ruta.id],
      );
    },
  );

  app.put(
    '/:id/configuracion',
    zValidator('param', idSchema, idInvalido),
    zValidator('json', configuracionBodySchema),
    async (c) => {
      const auth = autorizar(c, 'declarar', true);
      if (!auth.ok) {
        return auth.response;
      }
      const ids = { empresaId: auth.empresaId, rutaId: c.req.valid('param').id };
      const body = c.req.valid('json');
      return operar(
        c,
        'declarar',
        ids,
        () =>
          declararConfiguracionDeRuta(opts.db, {
            ...ids,
            vehiculoId: body.vehiculo_id,
            unidadArrastreId: body.unidad_arrastre_id,
            conductorId: body.conductor_id,
            userId: auth.userId,
          }),
        (r) => c.json({ ruta: r.ruta }),
        (r) => [r.ruta.id],
      );
    },
  );

  return app;
}
