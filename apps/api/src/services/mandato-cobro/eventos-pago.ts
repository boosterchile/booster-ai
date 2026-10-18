import {
  type CodigoRechazoPago,
  type EventoPago,
  type PagoViaje,
  type PlazosMandato,
  type TipoEventoPago,
  calcularFloat,
  diasEntre,
  montosEsperados,
  reducirPagoViaje,
  revisarVencimientos,
  validarEvento,
  vencimientos,
  verificarTopeFloat,
} from '@booster-ai/factoring-engine';
import type { Logger } from '@booster-ai/logger';
import { configuracionComercialSchema } from '@booster-ai/shared-schemas';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import type { Db } from '../../db/client.js';
import {
  adelantosCarrier,
  assignments,
  configuracionComercial,
  empresas,
  eventosPagoViaje,
  liquidaciones,
  transportDocuments,
  trips,
} from '../../db/schema.js';
import {
  getBusinessCounter,
  getBusinessGauge,
  getBusinessHistogram,
} from '../../observability/business-metrics.js';
import { setResultAttributes, withBusinessSpan } from '../../observability/business-span.js';

/**
 * Mandato de cobro (ADR-080) — registro de eventos de pago con su evidencia.
 *
 * Cada evento pasa por `validarEvento` (máquina de estados pura de
 * @booster-ai/factoring-engine) dentro de una transacción que bloquea la
 * liquidación del viaje; las liberaciones de Booster además toman un lock
 * global para que dos liberaciones concurrentes no superen juntas el tope
 * del float. La tabla es append-only (trigger de 0061).
 *
 * El sistema **registra** cobros y transferencias con su evidencia: no
 * mueve dinero.
 */

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type DbOTx = Db | Tx;

export interface DepsMandato {
  db: Db;
  logger: Logger;
  /** `MANDATO_COBRO_FLOAT_MAXIMO_CLP` (0 = Booster no adelanta caja propia). */
  topeFloatClp: number;
}

/** Evidencia fija por tipo de evento (spec §Tabla de eventos). */
const EVIDENCIA_POR_TIPO: Record<TipoEventoPago, string> = {
  recepcion_conforme: 'confirmacion_generador',
  cobro_registrado: 'abono_bancario',
  mora_registrada: 'vencimiento_plazo',
  liberacion_booster: 'transferencia_bancaria',
  anticipo_operador: 'adelanto_carrier',
  disputa_abierta: 'objecion_generador',
  disputa_resuelta: 'resolucion_admin',
};

/** Estados de `adelantos_carrier` en que el operador ya desembolsó. */
const ADELANTO_DESEMBOLSADO = ['desembolsado', 'cobrado_a_shipper', 'mora'];

export type CodigoRegistroPago =
  | CodigoRechazoPago
  | 'liquidacion_no_encontrada'
  | 'no_es_mandato'
  | 'adelanto_invalido'
  | 'tope_float_excedido';

export interface LineaVista {
  estado: string;
  en: string | null;
  monto_clp: number | null;
  vence_en: string | null;
}

export interface EventoVista {
  tipo: TipoEventoPago;
  monto_clp: number | null;
  evidencia_tipo: string;
  evidencia_ref: string;
  detalle: string | null;
  ocurrido_en: string;
  registrado_por: string;
}

export interface PagoViajeVista {
  asignacion_id: string;
  modo_flujo: 'conector' | 'mandato_cobro';
  recepcion_conforme_en: string | null;
  cobro: LineaVista;
  liberacion: LineaVista;
  montos_esperados: { cobro_clp: number; liberacion_clp: number };
  eventos: EventoVista[];
}

export type ResultadoRegistro =
  | { ok: true; pago: PagoViajeVista }
  | { ok: false; code: CodigoRegistroPago; disponibleClp?: number };

interface ContextoViaje {
  asignacionId: string;
  modoFlujo: 'conector' | 'mandato_cobro';
  montos: { cobroClp: number; liberacionClp: number };
  plazos: PlazosMandato;
  eventos: Array<EventoPago & Omit<EventoVista, 'tipo' | 'monto_clp' | 'ocurrido_en'>>;
}

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

async function cargarContexto(db: DbOTx, asignacionId: string): Promise<ContextoViaje | null> {
  // rls-allowlist: el caller ya autorizó la asignación (admin allowlist o generador dueño del viaje).
  const filas = await db
    .select({
      modoFlujo: liquidaciones.modoFlujo,
      precioTransportistaClp: liquidaciones.precioTransportistaClp,
      totalFacturaGeneradorClp: liquidaciones.totalFacturaGeneradorClp,
      configFila: configuracionComercial.config,
    })
    .from(liquidaciones)
    .leftJoin(
      configuracionComercial,
      eq(configuracionComercial.id, liquidaciones.configuracionComercialId),
    )
    .where(eq(liquidaciones.asignacionId, asignacionId))
    .limit(1);
  const liq = filas[0];
  if (!liq) {
    return null;
  }
  // rls-allowlist: eventos de la asignación ya autorizada.
  const eventos = await db
    .select()
    .from(eventosPagoViaje)
    .where(eq(eventosPagoViaje.asignacionId, asignacionId))
    .orderBy(asc(eventosPagoViaje.secuencia));
  const financiamiento = liq.configFila
    ? configuracionComercialSchema.parse(liq.configFila).financiamiento
    : null;
  return {
    asignacionId,
    modoFlujo: liq.modoFlujo,
    // Una liquidación v2 (sin precios v3) nunca es mandato: montos en 0.
    montos:
      liq.precioTransportistaClp !== null && liq.totalFacturaGeneradorClp !== null
        ? montosEsperados({
            precioTransportistaClp: liq.precioTransportistaClp,
            totalFacturaGeneradorClp: liq.totalFacturaGeneradorClp,
          })
        : { cobroClp: 0, liberacionClp: 0 },
    plazos: {
      pagoGeneradorDias: financiamiento?.plazo_pago_generador_dias ?? 30,
      liberacionTransportistaDias: financiamiento?.plazo_liberacion_transportista_dias ?? 5,
    },
    eventos: eventos.map((e) => ({
      tipo: e.tipo,
      montoClp: e.montoClp,
      ocurridoEn: e.ocurridoEn,
      evidencia_tipo: e.evidenciaTipo,
      evidencia_ref: e.evidenciaRef,
      detalle: e.detalle,
      registrado_por: e.registradoPor,
    })),
  };
}

function construirVista(ctx: ContextoViaje): PagoViajeVista {
  const pago = reducirPagoViaje(ctx.eventos);
  const v = pago.recepcionConformeEn ? vencimientos(pago.recepcionConformeEn, ctx.plazos) : null;
  return {
    asignacion_id: ctx.asignacionId,
    modo_flujo: ctx.modoFlujo,
    recepcion_conforme_en: iso(pago.recepcionConformeEn),
    cobro: {
      estado: pago.cobro.estado,
      en: iso(pago.cobro.en),
      monto_clp: pago.cobro.montoClp,
      vence_en: iso(v?.cobroVenceEn ?? null),
    },
    liberacion: {
      estado: pago.liberacion.estado,
      en: iso(pago.liberacion.en),
      monto_clp: pago.liberacion.montoClp,
      vence_en: iso(v?.liberacionVenceEn ?? null),
    },
    montos_esperados: { cobro_clp: ctx.montos.cobroClp, liberacion_clp: ctx.montos.liberacionClp },
    eventos: ctx.eventos.map((e) => ({
      tipo: e.tipo,
      monto_clp: e.montoClp,
      evidencia_tipo: e.evidencia_tipo,
      evidencia_ref: e.evidencia_ref,
      detalle: e.detalle,
      ocurrido_en: e.ocurridoEn.toISOString(),
      registrado_por: e.registrado_por,
    })),
  };
}

export async function leerPagoViaje(db: Db, asignacionId: string): Promise<PagoViajeVista | null> {
  const ctx = await cargarContexto(db, asignacionId);
  return ctx ? construirVista(ctx) : null;
}

/** Todos los viajes en mandato con su estado reducido (volumen: miles de filas). */
async function pagosMandato(db: DbOTx): Promise<Map<string, PagoViaje>> {
  // rls-allowlist: agregado global de plataforma (float, conciliación); sin datos por tenant hacia afuera.
  const filas = await db
    .select({
      asignacionId: eventosPagoViaje.asignacionId,
      tipo: eventosPagoViaje.tipo,
      montoClp: eventosPagoViaje.montoClp,
      ocurridoEn: eventosPagoViaje.ocurridoEn,
    })
    .from(eventosPagoViaje)
    .innerJoin(liquidaciones, eq(liquidaciones.asignacionId, eventosPagoViaje.asignacionId))
    .where(eq(liquidaciones.modoFlujo, 'mandato_cobro'))
    .orderBy(asc(eventosPagoViaje.asignacionId), asc(eventosPagoViaje.secuencia));
  const porViaje = new Map<string, EventoPago[]>();
  for (const f of filas) {
    const lista = porViaje.get(f.asignacionId) ?? [];
    lista.push({ tipo: f.tipo, montoClp: f.montoClp, ocurridoEn: f.ocurridoEn });
    porViaje.set(f.asignacionId, lista);
  }
  const pagos = new Map<string, PagoViaje>();
  for (const [id, eventos] of porViaje) {
    pagos.set(id, reducirPagoViaje(eventos));
  }
  return pagos;
}

/** Float de terceros vigente (ADR-080 §2): Σ liberado por Booster sin cobro. */
export async function calcularFloatActual(db: DbOTx): Promise<number> {
  return calcularFloat([...(await pagosMandato(db)).values()]);
}

const uuidSchema = z.string().uuid();

export interface RegistrarEventoInput {
  asignacionId: string;
  tipo: TipoEventoPago;
  montoClp: number | null;
  evidenciaRef: string;
  detalle?: string | null;
  ocurridoEn: Date;
  registradoPor: string;
}

export async function registrarEventoPago(
  deps: DepsMandato,
  input: RegistrarEventoInput,
): Promise<ResultadoRegistro> {
  return await withBusinessSpan(
    {
      name: 'mandato_cobro.registrar_evento',
      attributes: {
        'booster.assignment_id': input.asignacionId,
        'booster.mandato.tipo_evento': input.tipo,
      },
    },
    async (span) => {
      const r = await registrarEnTransaccion(deps, input);
      setResultAttributes(span, {
        'booster.mandato.resultado': r.ok ? 'ok' : r.code,
      });
      getBusinessCounter('caja.eventos_pago').add(1, {
        tipo: input.tipo,
        resultado: r.ok ? 'ok' : r.code,
      });
      if (!r.ok) {
        if (r.code === 'tope_float_excedido') {
          getBusinessCounter('caja.liberaciones_rechazadas_tope').add(1);
        }
        deps.logger.warn(
          { asignacionId: input.asignacionId, tipo: input.tipo, code: r.code },
          'mandato de cobro: evento rechazado',
        );
        return r;
      }
      registrarMetricasEvento(input, r.pago);
      if (input.tipo === 'liberacion_booster' || input.tipo === 'cobro_registrado') {
        getBusinessGauge('caja.float_terceros_clp', { unit: 'CLP' }).record(
          await calcularFloatActual(deps.db),
        );
      }
      return r;
    },
  );
}

async function registrarEnTransaccion(
  deps: DepsMandato,
  input: RegistrarEventoInput,
): Promise<ResultadoRegistro> {
  return await deps.db.transaction(async (tx) => {
    // Serializa los eventos de un mismo viaje.
    // rls-allowlist: lock de la liquidación de una asignación ya autorizada por el caller.
    await tx
      .select({ id: liquidaciones.id })
      .from(liquidaciones)
      .where(eq(liquidaciones.asignacionId, input.asignacionId))
      .for('update');
    if (input.tipo === 'liberacion_booster') {
      // El tope del float es global: dos liberaciones concurrentes de viajes
      // distintos no deben superarlo juntas.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('mandato_cobro_float'))`);
    }
    const ctx = await cargarContexto(tx, input.asignacionId);
    if (!ctx) {
      return { ok: false, code: 'liquidacion_no_encontrada' };
    }
    if (ctx.modoFlujo !== 'mandato_cobro') {
      return { ok: false, code: 'no_es_mandato' };
    }
    const estado = reducirPagoViaje(ctx.eventos);

    let montoEsperadoClp: number | undefined;
    if (input.tipo === 'cobro_registrado') {
      montoEsperadoClp = ctx.montos.cobroClp;
    } else if (input.tipo === 'liberacion_booster') {
      montoEsperadoClp = ctx.montos.liberacionClp;
    } else if (input.tipo === 'anticipo_operador') {
      const adelanto = await adelantoDesembolsado(tx, input.asignacionId, input.evidenciaRef);
      if (!adelanto) {
        return { ok: false, code: 'adelanto_invalido' };
      }
      montoEsperadoClp = adelanto.montoAdelantadoClp;
    }

    const evento: EventoPago = {
      tipo: input.tipo,
      montoClp: input.montoClp,
      ocurridoEn: input.ocurridoEn,
    };
    const validacion = validarEvento(estado, evento, {
      ...(montoEsperadoClp === undefined ? {} : { montoEsperadoClp }),
      ...(estado.recepcionConformeEn
        ? { cobroVenceEn: vencimientos(estado.recepcionConformeEn, ctx.plazos).cobroVenceEn }
        : {}),
    });
    if (!validacion.ok) {
      return { ok: false, code: validacion.code };
    }

    if (input.tipo === 'liberacion_booster') {
      const tope = verificarTopeFloat({
        floatActualClp: await calcularFloatActual(tx),
        montoClp: input.montoClp ?? 0,
        topeClp: deps.topeFloatClp,
        cobroYaCobrado: estado.cobro.estado === 'cobrado',
      });
      if (!tope.ok) {
        return { ok: false, code: tope.code, disponibleClp: tope.disponibleClp };
      }
    }

    await tx.insert(eventosPagoViaje).values({
      asignacionId: input.asignacionId,
      tipo: input.tipo,
      montoClp: input.montoClp,
      evidenciaTipo: EVIDENCIA_POR_TIPO[input.tipo],
      evidenciaRef: input.evidenciaRef,
      detalle: input.detalle ?? null,
      ocurridoEn: input.ocurridoEn,
      registradoPor: input.registradoPor,
    });
    const actualizado = await cargarContexto(tx, input.asignacionId);
    if (!actualizado) {
      throw new Error('mandato de cobro: liquidación desapareció dentro de la transacción');
    }
    return { ok: true, pago: construirVista(actualizado) };
  });
}

async function adelantoDesembolsado(
  tx: Tx,
  asignacionId: string,
  ref: string,
): Promise<{ montoAdelantadoClp: number } | null> {
  if (!uuidSchema.safeParse(ref).success) {
    return null;
  }
  // rls-allowlist: el adelanto se busca dentro de la asignación ya autorizada.
  const filas = await tx
    .select({ montoAdelantadoClp: adelantosCarrier.montoAdelantadoClp })
    .from(adelantosCarrier)
    .where(
      and(
        eq(adelantosCarrier.id, ref),
        eq(adelantosCarrier.asignacionId, asignacionId),
        inArray(adelantosCarrier.status, ADELANTO_DESEMBOLSADO),
      ),
    )
    .limit(1);
  return filas[0] ?? null;
}

/** Histogramas de días desde la recepción conforme (ADR-080 acción 5). */
function registrarMetricasEvento(input: RegistrarEventoInput, pago: PagoViajeVista): void {
  if (!pago.recepcion_conforme_en) {
    return;
  }
  const desde = new Date(pago.recepcion_conforme_en);
  if (input.tipo === 'cobro_registrado') {
    getBusinessHistogram('caja.dias_cobro_generador', { unit: 'd' }).record(
      diasEntre(desde, input.ocurridoEn),
    );
  } else if (input.tipo === 'liberacion_booster' || input.tipo === 'anticipo_operador') {
    getBusinessHistogram('caja.dias_liberacion_transportista', { unit: 'd' }).record(
      diasEntre(desde, input.ocurridoEn),
      { medio: input.tipo },
    );
  }
}

export type CodigoRecepcion =
  | 'viaje_no_encontrado'
  | 'viaje_no_entregado'
  | 'sin_asignacion'
  | 'sin_documento'
  | CodigoRegistroPago;

/** Viaje del generador con su asignación; null si no es suyo o no existe. */
async function viajeDelGenerador(
  db: Db,
  tripId: string,
  generadorEmpresaId: string,
): Promise<{ status: string; asignacionId: string | null } | null> {
  const filas = await db
    .select({ status: trips.status, asignacionId: assignments.id })
    .from(trips)
    .leftJoin(assignments, eq(assignments.tripId, trips.id))
    .where(and(eq(trips.id, tripId), eq(trips.generadorCargaEmpresaId, generadorEmpresaId)))
    .limit(1);
  return filas[0] ?? null;
}

/**
 * ADR-080 §1: la recepción conforme es la confirmación del generador con el
 * documento del viaje archivado (ADR-070). La evidencia es el documento más
 * reciente. Idempotente: confirmar de nuevo devuelve el estado vigente.
 *
 * `asegurarLiquidacion` (liquidarTrip, idempotente) evita la carrera con la
 * liquidación asíncrona que dispara la entrega.
 */
export async function registrarRecepcionConforme(
  deps: DepsMandato,
  input: {
    tripId: string;
    generadorEmpresaId: string;
    registradoPor: string;
    asegurarLiquidacion: (asignacionId: string) => Promise<unknown>;
  },
): Promise<{ ok: true; pago: PagoViajeVista } | { ok: false; code: CodigoRecepcion }> {
  const viaje = await viajeDelGenerador(deps.db, input.tripId, input.generadorEmpresaId);
  if (!viaje) {
    return { ok: false, code: 'viaje_no_encontrado' };
  }
  if (!viaje.asignacionId) {
    return { ok: false, code: 'sin_asignacion' };
  }
  if (viaje.status !== 'entregado') {
    return { ok: false, code: 'viaje_no_entregado' };
  }
  await input.asegurarLiquidacion(viaje.asignacionId);
  const actual = await leerPagoViaje(deps.db, viaje.asignacionId);
  if (!actual) {
    return { ok: false, code: 'liquidacion_no_encontrada' };
  }
  if (actual.modo_flujo !== 'mandato_cobro') {
    return { ok: false, code: 'no_es_mandato' };
  }
  if (actual.recepcion_conforme_en) {
    return { ok: true, pago: actual };
  }
  // rls-allowlist: documentos del viaje cuya propiedad ya verificó viajeDelGenerador.
  const documento = await deps.db
    .select({ id: transportDocuments.id })
    .from(transportDocuments)
    .where(eq(transportDocuments.viajeId, input.tripId))
    .orderBy(desc(transportDocuments.createdAt))
    .limit(1);
  const doc = documento[0];
  if (!doc) {
    return { ok: false, code: 'sin_documento' };
  }
  const r = await registrarEventoPago(deps, {
    asignacionId: viaje.asignacionId,
    tipo: 'recepcion_conforme',
    montoClp: null,
    evidenciaRef: doc.id,
    ocurridoEn: new Date(),
    registradoPor: input.registradoPor,
  });
  if (!r.ok && r.code === 'recepcion_duplicada') {
    // Otra confirmación ganó la carrera: el estado vigente ya la tiene.
    const vigente = await leerPagoViaje(deps.db, viaje.asignacionId);
    return vigente ? { ok: true, pago: vigente } : { ok: false, code: 'liquidacion_no_encontrada' };
  }
  return r;
}

/** Pago del viaje visto por su generador; null si el viaje no es suyo o no tiene liquidación. */
export async function leerPagoDelGenerador(
  db: Db,
  tripId: string,
  generadorEmpresaId: string,
): Promise<PagoViajeVista | null> {
  const viaje = await viajeDelGenerador(db, tripId, generadorEmpresaId);
  if (!viaje?.asignacionId) {
    return null;
  }
  return await leerPagoViaje(db, viaje.asignacionId);
}

/** ADR-080 §2: el generador objeta la recepción; congela la liberación, no el cobro. */
export async function abrirDisputa(
  deps: DepsMandato,
  input: { tripId: string; generadorEmpresaId: string; userId: string; motivo: string },
): Promise<{ ok: true; pago: PagoViajeVista } | { ok: false; code: CodigoRecepcion }> {
  const viaje = await viajeDelGenerador(deps.db, input.tripId, input.generadorEmpresaId);
  if (!viaje) {
    return { ok: false, code: 'viaje_no_encontrado' };
  }
  if (!viaje.asignacionId) {
    return { ok: false, code: 'sin_asignacion' };
  }
  return await registrarEventoPago(deps, {
    asignacionId: viaje.asignacionId,
    tipo: 'disputa_abierta',
    montoClp: null,
    evidenciaRef: input.userId,
    detalle: input.motivo,
    ocurridoEn: new Date(),
    registradoPor: input.userId,
  });
}

export interface FilaConciliacion extends PagoViajeVista {
  tracking_code: string;
  generador: string;
  transportista: string;
}

/** Vista de conciliación del platform-admin: viajes en mandato, más recientes primero. */
export async function listarPagosMandato(db: Db, limite = 500): Promise<FilaConciliacion[]> {
  const gen = alias(empresas, 'gen');
  const tra = alias(empresas, 'tra');
  // rls-allowlist: vista del platform-admin (allowlist ADR-076) sobre todos los viajes en mandato.
  const filas = await db
    .select({
      asignacionId: liquidaciones.asignacionId,
      trackingCode: trips.trackingCode,
      generador: gen.legalName,
      transportista: tra.legalName,
    })
    .from(liquidaciones)
    .innerJoin(assignments, eq(assignments.id, liquidaciones.asignacionId))
    .innerJoin(trips, eq(trips.id, assignments.tripId))
    .innerJoin(gen, eq(gen.id, trips.generadorCargaEmpresaId))
    .innerJoin(tra, eq(tra.id, assignments.empresaId))
    .where(eq(liquidaciones.modoFlujo, 'mandato_cobro'))
    .orderBy(desc(liquidaciones.createdAt))
    .limit(limite);
  const resultado: FilaConciliacion[] = [];
  for (const f of filas) {
    const pago = await leerPagoViaje(db, f.asignacionId);
    if (pago) {
      resultado.push({
        ...pago,
        tracking_code: f.trackingCode,
        generador: f.generador,
        transportista: f.transportista,
      });
    }
  }
  return resultado;
}

export interface ResumenConciliacion {
  morasRegistradas: number;
  liberacionesVencidas: number;
  floatClp: number;
  moraPctMes: number;
  anticiposPctMes: number;
  viajesEnMandato: number;
}

const mismoMes = (a: Date, b: Date) =>
  a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth();

/**
 * Job diario (ADR-080 acción 5): registra `mora_registrada` sobre cobros
 * vencidos y publica los gauges de caja. Idempotente: un cobro ya en mora no
 * vuelve a marcarse (la máquina de estados lo rechaza).
 */
export async function conciliarMandatoCobro(
  deps: DepsMandato & { ahora?: () => Date },
): Promise<ResumenConciliacion> {
  return await withBusinessSpan({ name: 'mandato_cobro.conciliar' }, async (span) => {
    const ahora = deps.ahora?.() ?? new Date();
    // rls-allowlist: job de plataforma (Cloud Scheduler, OIDC) sobre todos los viajes en mandato.
    const asignaciones = await deps.db
      .select({ asignacionId: liquidaciones.asignacionId })
      .from(liquidaciones)
      .where(eq(liquidaciones.modoFlujo, 'mandato_cobro'));

    let morasRegistradas = 0;
    let liberacionesVencidas = 0;
    let cobrosQueVencieronEsteMes = 0;
    let enMoraEsteMes = 0;
    let recepcionesEsteMes = 0;
    let anticiposEsteMes = 0;

    for (const { asignacionId } of asignaciones) {
      const ctx = await cargarContexto(deps.db, asignacionId);
      if (!ctx) {
        continue;
      }
      let pago = reducirPagoViaje(ctx.eventos);
      const revision = revisarVencimientos(pago, ctx.plazos, ahora);
      if (revision.requiereMora && pago.recepcionConformeEn) {
        const vence = vencimientos(pago.recepcionConformeEn, ctx.plazos).cobroVenceEn;
        const r = await registrarEventoPago(deps, {
          asignacionId,
          tipo: 'mora_registrada',
          montoClp: null,
          evidenciaRef: vence.toISOString(),
          ocurridoEn: ahora,
          registradoPor: 'sistema',
        });
        if (r.ok) {
          morasRegistradas += 1;
          pago = { ...pago, cobro: { estado: 'mora', en: ahora, montoClp: null } };
        }
      }
      if (revision.liberacionVencida) {
        liberacionesVencidas += 1;
      }
      if (pago.recepcionConformeEn) {
        const vence = vencimientos(pago.recepcionConformeEn, ctx.plazos).cobroVenceEn;
        if (mismoMes(vence, ahora) && vence.getTime() <= ahora.getTime()) {
          cobrosQueVencieronEsteMes += 1;
          if (pago.cobro.estado === 'mora') {
            enMoraEsteMes += 1;
          }
        }
        if (mismoMes(pago.recepcionConformeEn, ahora)) {
          recepcionesEsteMes += 1;
          if (pago.liberacion.estado === 'anticipado_por_operador') {
            anticiposEsteMes += 1;
          }
        }
      }
    }

    const pct = (n: number, d: number) => (d === 0 ? 0 : Math.round((n / d) * 10_000) / 100);
    const resumen: ResumenConciliacion = {
      morasRegistradas,
      liberacionesVencidas,
      floatClp: await calcularFloatActual(deps.db),
      moraPctMes: pct(enMoraEsteMes, cobrosQueVencieronEsteMes),
      anticiposPctMes: pct(anticiposEsteMes, recepcionesEsteMes),
      viajesEnMandato: asignaciones.length,
    };
    getBusinessGauge('caja.float_terceros_clp', { unit: 'CLP' }).record(resumen.floatClp);
    getBusinessGauge('caja.mora_generador_pct_mes', { unit: '%' }).record(resumen.moraPctMes);
    getBusinessGauge('factoring.anticipos_pct_viajes_mes', { unit: '%' }).record(
      resumen.anticiposPctMes,
    );
    getBusinessGauge('caja.liberaciones_vencidas').record(resumen.liberacionesVencidas);
    setResultAttributes(span, {
      'booster.mandato.moras_registradas': morasRegistradas,
      'booster.mandato.liberaciones_vencidas': liberacionesVencidas,
      'booster.mandato.float_clp': resumen.floatClp,
    });
    deps.logger.info({ ...resumen }, 'mandato de cobro: conciliación diaria');
    return resumen;
  });
}
