/**
 * Estimador de distancia simple entre regiones chilenas.
 *
 * Diseño:
 *   - Tabla hardcoded de distancias por carretera entre capitales
 *     regionales (centroides aproximados). Datos de Google Maps /
 *     MOP — usar como referencia, no como verdad geo precisa.
 *   - Cuando origen y destino están en la MISMA región: asumimos
 *     30 km (transporte intra-regional típico urbano).
 *   - El TODO es reemplazar con Google Maps Routes API que dará
 *     distancia real por carretera + tiempo + altimetría. Por ahora
 *     este placeholder permite que el carbon-calculator funcione
 *     desde el día 1 sin depender de un servicio externo.
 *
 * Códigos de región Chile (15 oficiales actualizadas 2024):
 *   XV  - Arica y Parinacota
 *   I   - Tarapacá
 *   II  - Antofagasta
 *   III - Atacama
 *   IV  - Coquimbo
 *   V   - Valparaíso
 *   RM  - Metropolitana
 *   VI  - O'Higgins
 *   VII - Maule
 *   XVI - Ñuble
 *   VIII - Biobío
 *   IX  - La Araucanía
 *   XIV - Los Ríos
 *   X   - Los Lagos
 *   XI  - Aysén
 *   XII - Magallanes
 */

const DISTANCIA_INTRA_REGIONAL_KM = 30;
const DISTANCIA_DEFAULT_KM = 500; // fallback cuando hay códigos no mapeados

/**
 * Distancia por carretera estimada en km entre capitales regionales.
 * Símetrica (a→b == b→a). Usar `getDistanciaRegional(a, b)` para acceder.
 */
const DISTANCIAS_REGIONALES_KM: Record<string, Record<string, number>> = {
  // De Norte a Sur. Cada celda es la distancia desde la región-fila a la región-columna.
  // Solo registro la triangular superior; el lookup hace el flip simétrico.
  XV: {
    I: 308,
    II: 712,
    III: 1280,
    IV: 1745,
    V: 2057,
    RM: 2061,
    VI: 2197,
    VII: 2301,
    XVI: 2421,
    VIII: 2540,
    IX: 2860,
    XIV: 3036,
    X: 3140,
    XI: 3635,
    XII: 5077,
  },
  I: {
    II: 404,
    III: 972,
    IV: 1437,
    V: 1749,
    RM: 1753,
    VI: 1889,
    VII: 1993,
    XVI: 2113,
    VIII: 2232,
    IX: 2552,
    XIV: 2728,
    X: 2832,
    XI: 3327,
    XII: 4769,
  },
  II: {
    III: 568,
    IV: 1033,
    V: 1345,
    RM: 1349,
    VI: 1485,
    VII: 1589,
    XVI: 1709,
    VIII: 1828,
    IX: 2148,
    XIV: 2324,
    X: 2428,
    XI: 2923,
    XII: 4365,
  },
  III: {
    IV: 465,
    V: 777,
    RM: 781,
    VI: 917,
    VII: 1021,
    XVI: 1141,
    VIII: 1260,
    IX: 1580,
    XIV: 1756,
    X: 1860,
    XI: 2355,
    XII: 3797,
  },
  IV: {
    V: 312,
    RM: 316,
    VI: 452,
    VII: 556,
    XVI: 676,
    VIII: 795,
    IX: 1115,
    XIV: 1291,
    X: 1395,
    XI: 1890,
    XII: 3332,
  },
  V: {
    RM: 116,
    VI: 252,
    VII: 356,
    XVI: 476,
    VIII: 595,
    IX: 915,
    XIV: 1091,
    X: 1195,
    XI: 1690,
    XII: 3132,
  },
  RM: { VI: 136, VII: 240, XVI: 360, VIII: 479, IX: 799, XIV: 975, X: 1079, XI: 1574, XII: 3016 },
  VI: { VII: 104, XVI: 224, VIII: 343, IX: 663, XIV: 839, X: 943, XI: 1438, XII: 2880 },
  VII: { XVI: 120, VIII: 239, IX: 559, XIV: 735, X: 839, XI: 1334, XII: 2776 },
  XVI: { VIII: 119, IX: 439, XIV: 615, X: 719, XI: 1214, XII: 2656 },
  VIII: { IX: 320, XIV: 496, X: 600, XI: 1095, XII: 2537 },
  IX: { XIV: 176, X: 280, XI: 775, XII: 2217 },
  XIV: { X: 104, XI: 599, XII: 2041 },
  X: { XI: 495, XII: 1937 },
  XI: { XII: 1442 },
};

/**
 * Devuelve distancia estimada por carretera entre dos códigos de región.
 *
 * - Si origen == destino → DISTANCIA_INTRA_REGIONAL_KM (30 km).
 * - Si algún código no está en la tabla → DISTANCIA_DEFAULT_KM (500 km).
 * - Caso normal → busca en la tabla, símetricamente.
 */
export function estimarDistanciaKm(origen: string | null, destino: string | null): number {
  if (!origen || !destino) {
    return DISTANCIA_DEFAULT_KM;
  }
  const o = origen.toUpperCase();
  const d = destino.toUpperCase();
  if (o === d) {
    return DISTANCIA_INTRA_REGIONAL_KM;
  }

  const fila = DISTANCIAS_REGIONALES_KM[o];
  if (fila && fila[d] != null) {
    return fila[d];
  }
  const filaInversa = DISTANCIAS_REGIONALES_KM[d];
  if (filaInversa && filaInversa[o] != null) {
    return filaInversa[o];
  }
  return DISTANCIA_DEFAULT_KM;
}
