/**
 * Campos del listado de viajes para el Inicio del generador.
 * Una fila por viaje (la asignación es 1:1). El avance es un hito
 * operativo, no la posición GPS: el seguimiento vivo sigue en el detalle.
 */

export type PipelineGenerador = 'buscando' | 'asignada' | 'en_camino' | 'entregada' | 'fuera';

const BUSCANDO = new Set(['esperando_match', 'emparejando', 'ofertas_enviadas']);

export function pipelineDe(status: string): PipelineGenerador {
  if (BUSCANDO.has(status)) {
    return 'buscando';
  }
  if (status === 'asignado') {
    return 'asignada';
  }
  if (status === 'en_proceso') {
    return 'en_camino';
  }
  if (status === 'entregado') {
    return 'entregada';
  }
  return 'fuera';
}

/** 50 asignada, 75 en ruta, 100 entregada. null si todavía no hay match medible. */
export function avanceHito(status: string, assignmentStatus: string | null): number | null {
  if (status === 'entregado' || assignmentStatus === 'entregado') {
    return 100;
  }
  if (status === 'en_proceso' || assignmentStatus === 'recogido') {
    return 75;
  }
  if (status === 'asignado' || assignmentStatus === 'asignado') {
    return 50;
  }
  return null;
}

/** Una fila por viaje. Si un join repite el id, se queda la primera. */
export function filasListaUnicas<T extends { id?: unknown }>(rows: readonly T[]): T[] {
  const vistos = new Set<string>();
  const unicos: T[] = [];
  for (const row of rows) {
    if (typeof row.id !== 'string' || row.id.length === 0) {
      unicos.push(row);
      continue;
    }
    if (vistos.has(row.id)) {
      continue;
    }
    vistos.add(row.id);
    unicos.push(row);
  }
  return unicos;
}

export function serializarFilaLista<T extends object>(
  row: T & {
    status?: unknown;
    assignment_status?: unknown;
    transportista_nombre?: unknown;
    ofertas_pendientes?: unknown;
  },
): Omit<T, 'ofertas_pendientes'> & {
  transportista_nombre: string | null;
  assignment_status: string | null;
  avance_pct: number | null;
} {
  const status = typeof row.status === 'string' ? row.status : '';
  const assignment =
    typeof row.assignment_status === 'string' && row.assignment_status !== 'cancelado'
      ? row.assignment_status
      : null;
  const nombre =
    assignment && typeof row.transportista_nombre === 'string' ? row.transportista_nombre : null;
  const { ofertas_pendientes: _ocultas, ...resto } = row;
  return {
    ...resto,
    transportista_nombre: nombre,
    assignment_status: assignment,
    avance_pct: avanceHito(status, assignment),
  };
}
