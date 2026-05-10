import type { DesgloseScore, FocoPrincipal } from './tipos.js';

/**
 * Determina el foco principal del feedback a partir del breakdown.
 *
 * Reglas:
 *   - Si no hay eventos relevantes → 'felicitacion' (score alto).
 *   - Si solo hay un tipo de evento → ese tipo es el foco.
 *   - Si hay múltiples tipos → 'multiple' (el coaching debe ser holístico).
 *
 * El "tipo dominante" se calcula por count, NO por penalty: el
 * coaching debe enfocarse en el más frecuente, aunque no sea el de
 * mayor peso de penalización (un transportista con 1 frenado y 5
 * excesos de velocidad debería recibir feedback sobre velocidad,
 * aunque el frenado pese más en el score).
 *
 * `multiple` se considera cuando ≥ 2 tipos tienen al menos un evento.
 */
export function determinarFocoPrincipal(desglose: DesgloseScore): FocoPrincipal {
  const counts = [
    { tipo: 'aceleracion' as const, count: desglose.aceleracionesBruscas },
    { tipo: 'frenado' as const, count: desglose.frenadosBruscos },
    { tipo: 'curvas' as const, count: desglose.curvasBruscas },
    { tipo: 'velocidad' as const, count: desglose.excesosVelocidad },
  ];

  const tiposPresentes = counts.filter((c) => c.count > 0);

  if (tiposPresentes.length === 0) {
    return 'felicitacion';
  }
  if (tiposPresentes.length === 1) {
    return tiposPresentes[0]?.tipo ?? 'multiple';
  }
  return 'multiple';
}
