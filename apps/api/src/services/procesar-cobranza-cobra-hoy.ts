import type { Logger } from '@booster-ai/logger';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { adelantosCarrier } from '../db/schema.js';

/**
 * ADR-029 v1 / ADR-032 — Job de cobranza al shipper para "Booster Cobra Hoy".
 *
 * Disparado por Cloud Scheduler (1×/día). Detecta adelantos
 * `desembolsado` cuyo plazo declarado del shipper ya venció y aún no
 * fueron cobrados, y los transiciona a `mora` registrando
 * `mora_desde = now()`.
 *
 * Modelo de tiempo:
 *   fecha_vencimiento = desembolsado_en + plazo_dias_shipper × 1 día
 *
 * Si fecha_vencimiento ≤ now() y status sigue siendo `desembolsado`:
 *   - status → `mora`
 *   - mora_desde → now()
 *   - notas_admin += "[ISO cron@boosterchile.com] auto-mora: shipper no
 *     pagó en plazo (X días)"
 *
 * **Por qué `desembolsado` → `mora` (no → `cobrado_a_shipper`):**
 *
 * La transición a `cobrado_a_shipper` requiere evidencia del pago real.
 * Sin un partner financiero conectado que reporte el cobro, el cron NO
 * puede asumir que el shipper pagó. La transición correcta automática
 * es a `mora` para que un admin la revise.
 *
 * Cuando el admin reciba evidencia de pago real (transferencia,
 * webhook del partner, etc.), transicionará manualmente
 * `mora → cobrado_a_shipper` desde la UI admin.
 *
 * **Idempotente**: re-correr el job es seguro. Los adelantos ya en
 * `mora` no vuelven a procesarse (filtro por status='desembolsado').
 *
 * **No-op si el flag está off**: el caller (routes/admin-jobs) chequea
 * `FACTORING_V1_ACTIVATED` antes de invocar. Acá no hay flag check para
 * que el service sea testeable sin tocar config global.
 */

export interface ProcesarCobranzaInput {
  db: Db;
  logger: Logger;
  /** Tag prefix para `notas_admin`. Default: 'cron@boosterchile.com'. */
  actorEmail?: string;
}

export interface AdelantoMora {
  adelantoId: string;
  empresaCarrierId: string;
  empresaShipperId: string;
  diasVencidos: number;
}

export interface ProcesarCobranzaResult {
  /** Total de adelantos procesados que pasaron a mora en este tick. */
  morasCreadas: number;
  /** Detalle de cada adelanto transicionado (para logging y debugging). */
  adelantos: AdelantoMora[];
}

/**
 * Construye la línea de `notas_admin` que se append al adelanto cuando
 * el cron lo marca como `mora`. Exportado puro para que los tests
 * puedan auditar el contenido sin lidiar con SQL templates.
 */
export function buildAutoMoraNota(opts: {
  actorEmail: string;
  ahora: Date;
  plazoDiasShipper: number;
  diasVencidos: number;
}): string {
  const tag = `[${opts.ahora.toISOString()} ${opts.actorEmail}]`;
  return `${tag} auto-mora: shipper no pagó en plazo (${opts.diasVencidos} días vencidos sobre ${opts.plazoDiasShipper}).`;
}

export async function procesarCobranzaCobraHoy(
  input: ProcesarCobranzaInput,
): Promise<ProcesarCobranzaResult> {
  const { db, logger, actorEmail = 'cron@boosterchile.com' } = input;

  // SELECT: adelantos en `desembolsado` con fecha_vencimiento ≤ now() y
  // sin `mora_desde` (defensa en profundidad contra races con un admin
  // que ya marcó mora manualmente).
  //
  // El cálculo de fecha_vencimiento se hace SQL-side con interval para
  // evitar leer todos los adelantos y filtrar en memoria. Postgres
  // optimiza con el índice por status (idx_adelantos_carrier_empresa_status)
  // ya que el WHERE empieza con eq(status, 'desembolsado').
  // rls-allowlist: cron platform-wide — sin tenant filter por diseño.
  const candidates = await db
    .select({
      id: adelantosCarrier.id,
      empresaCarrierId: adelantosCarrier.empresaCarrierId,
      empresaShipperId: adelantosCarrier.empresaShipperId,
      plazoDiasShipper: adelantosCarrier.plazoDiasShipper,
      desembolsadoEn: adelantosCarrier.desembolsadoEn,
    })
    .from(adelantosCarrier)
    .where(
      and(
        eq(adelantosCarrier.status, 'desembolsado'),
        isNull(adelantosCarrier.moraDesde),
        sql`${adelantosCarrier.desembolsadoEn} + (${adelantosCarrier.plazoDiasShipper} || ' days')::interval <= now()`,
      ),
    )
    .limit(500);

  if (candidates.length === 0) {
    logger.debug('procesarCobranzaCobraHoy: no hay candidatos a mora');
    return { morasCreadas: 0, adelantos: [] };
  }

  const ahora = new Date();
  const adelantos: AdelantoMora[] = [];

  // Procesamos uno por uno (no en bulk) para tener log + nota individual
  // por adelanto. Volumen esperado: <50 al día en steady state. Si crece,
  // podemos pasar a un UPDATE bulk con CASE WHEN para las notas.
  for (const cand of candidates) {
    if (!cand.desembolsadoEn) {
      continue;
    }
    const msDiff = ahora.getTime() - cand.desembolsadoEn.getTime();
    const diasVencidos = Math.max(
      0,
      Math.floor(msDiff / (24 * 60 * 60 * 1000)) - cand.plazoDiasShipper,
    );

    const nota = buildAutoMoraNota({
      actorEmail,
      ahora,
      plazoDiasShipper: cand.plazoDiasShipper,
      diasVencidos,
    });

    // rls-allowlist: cron platform-wide — sin tenant filter por diseño.
    await db
      .update(adelantosCarrier)
      .set({
        status: 'mora',
        moraDesde: ahora,
        notasAdmin: sql`coalesce(${adelantosCarrier.notasAdmin} || E'\n', '') || ${nota}`,
        updatedAt: ahora,
      })
      .where(
        and(
          eq(adelantosCarrier.id, cand.id),
          // Race safety: si en el ínterin alguien transicionó el adelanto
          // a otro status (vía admin UI), no lo pisamos.
          eq(adelantosCarrier.status, 'desembolsado'),
        ),
      );

    adelantos.push({
      adelantoId: cand.id,
      empresaCarrierId: cand.empresaCarrierId,
      empresaShipperId: cand.empresaShipperId,
      diasVencidos,
    });

    logger.info(
      {
        adelantoId: cand.id,
        empresaCarrierId: cand.empresaCarrierId,
        empresaShipperId: cand.empresaShipperId,
        plazoDiasShipper: cand.plazoDiasShipper,
        diasVencidos,
      },
      'procesarCobranzaCobraHoy: adelanto a mora',
    );
  }

  logger.info({ morasCreadas: adelantos.length }, 'procesarCobranzaCobraHoy: tick completado');

  return { morasCreadas: adelantos.length, adelantos };
}
