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
