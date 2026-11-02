import { haversineKm } from '../services/calcular-cobertura-telemetria.js';
import type { Resumen83 } from './decidir-fuente-huella.js';
import { consumoAcumuladoDe, nivelPctDe } from './segmentar-trayectos-teltonika.js';

export interface LecturaSegmentoCan {
  tMs: number;
  lat: number;
  lng: number;
  io: Record<string, number>;
}

/** Solo filas con un 83 válido como contador: las solo-89 no densifican la cobertura del 83. */
export const soloLecturas83 = (lecturas: readonly LecturaSegmentoCan[]) =>
  lecturas.filter((l) => consumoAcumuladoDe(l.io) != null);

export function distanciaRecorrida(lecturas: readonly LecturaSegmentoCan[]): number {
  let km = 0;
  for (let i = 1; i < lecturas.length; i++) {
    const a = lecturas[i - 1];
    const b = lecturas[i];
    if (a && b) {
      km += haversineKm(a.lat, a.lng, b.lat, b.lng);
    }
  }
  return km;
}

/**
 * HC-001 parte 2 — resume el contador 83 y el nivel 89 de la ventana para
 * `decidirFuenteHuella`. Función PURA. HC-005: es la ÚNICA lectura del 83; los
 * litros que valida la decisión son los que emite el certificado. El 83 se elige por datos, no por la
 * config `fuente_combustible_can` (datos-can.md §4.2); los guardrails viven en
 * la decisión, acá solo se miden.
 */
export const NIVEL_RECARGA_PCT = 10;

export interface ResumenCan {
  can83: Resumen83 | null;
  litrosNivelSinRecarga: number | null;
}

export function resumirCanSegmento(
  lecturas: readonly LecturaSegmentoCan[],
  distanciaKm: number,
  capacidadEstanqueL: number | null,
): ResumenCan {
  const ord = [...lecturas].sort((a, b) => a.tMs - b.tMs);
  const c: { idx: number; litros: number }[] = [];
  ord.forEach((l, idx) => {
    const litros = consumoAcumuladoDe(l.io);
    if (litros != null) {
      c.push({ idx, litros });
    }
  });
  const pri = c[0];
  const ult = c[c.length - 1];
  let can83: Resumen83 | null = null;
  if (pri && ult) {
    let pasosNegativos = 0;
    let saltoMaxPorPasoL = 0;
    for (let i = 1; i < c.length; i++) {
      const d = (c[i]?.litros ?? 0) - (c[i - 1]?.litros ?? 0);
      if (d < 0) {
        pasosNegativos++;
      } else {
        saltoMaxPorPasoL = Math.max(saltoMaxPorPasoL, d);
      }
    }
    const cubiertaKm = distanciaRecorrida(soloLecturas83(ord.slice(pri.idx, ult.idx + 1)));
    can83 = {
      lecturas: c.length,
      coberturaKmPct: distanciaKm > 0 ? Math.min(100, (cubiertaKm / distanciaKm) * 100) : 0,
      pasosNegativos,
      saltoMaxPorPasoL,
      litros: ult.litros - pri.litros,
    };
  }
  return { can83, litrosNivelSinRecarga: nivelSinRecarga(ord, capacidadEstanqueL) };
}

/**
 * Consumo por nivel (89 × capacidad declarada), solo como chequeo cruzado
 * (datos-can.md §4.4): mediana móvil de 3 (filtra el glitch de 1 muestra y
 * suaviza oleaje); una subida ≥ 10 puntos es recarga → null.
 */
function nivelSinRecarga(ord: readonly LecturaSegmentoCan[], cap: number | null): number | null {
  if (cap === null || !(Number.isFinite(cap) && cap > 0)) {
    return null;
  }
  const pct = ord.map((l) => nivelPctDe(l.io)).filter((p): p is number => p != null);
  if (pct.length < 3) {
    return null;
  }
  const suave = pct
    .slice(1, -1)
    .map((_, i) => [pct[i], pct[i + 1], pct[i + 2]].sort((a, b) => (a ?? 0) - (b ?? 0))[1] ?? 0);
  for (let i = 1; i < suave.length; i++) {
    if ((suave[i] ?? 0) - (suave[i - 1] ?? 0) >= NIVEL_RECARGA_PCT) {
      return null;
    }
  }
  const caidaPct = (suave[0] ?? 0) - (suave[suave.length - 1] ?? 0);
  return caidaPct > 0 ? (caidaPct / 100) * cap : null;
}
