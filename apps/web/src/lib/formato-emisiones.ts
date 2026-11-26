/**
 * Formateador único de cifras de emisiones (`.specs/una-sola-verdad-por-dato`,
 * frente 1 del rediseño). Es el único archivo de `apps/web` que escribe una
 * cifra de emisiones o el texto «CO₂e»: `sin-cifras-de-emisiones-sueltas.test.ts`
 * falla si otro lo hace.
 */

/** Así se escribe en toda la aplicación. */
export const CO2E = 'CO₂e';

export const SIN_DATO = 'Sin dato';

type Cifra = number | string | null | undefined;

function aNumero(valor: Cifra): number | null {
  if (valor == null || valor === '') {
    return null;
  }
  const n = typeof valor === 'number' ? valor : Number(valor);
  return Number.isFinite(n) ? n : null;
}

function redondear(valor: number, decimales: number): number {
  const factor = 10 ** decimales;
  return Math.round(valor * factor) / factor;
}

/** Coma decimal, punto de miles y signo menos tipográfico. */
function cifra(valor: number, decimales: number): string {
  const texto = new Intl.NumberFormat('es-CL', {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
    useGrouping: 'always',
  }).format(Math.abs(valor));
  return valor < 0 ? `−${texto}` : texto;
}

/**
 * Emisiones a partir de kilogramos de CO₂e. Bajo 1 kg van tres decimales,
 * hasta 1.000 kg uno, y desde ahí toneladas con dos. El tramo se elige con el
 * valor ya redondeado, para que 999,96 kg no salga como «1.000,0 kg».
 */
export function formatoEmisiones(kg: Cifra): string {
  const n = aNumero(kg);
  if (n === null) {
    return SIN_DATO;
  }
  const absoluto = Math.abs(n);
  if (redondear(absoluto, 3) === 0) {
    return `0 kg ${CO2E}`;
  }
  if (redondear(absoluto, 3) < 1) {
    return `${cifra(n, 3)} kg ${CO2E}`;
  }
  if (redondear(absoluto, 1) < 1000) {
    return `${cifra(n, 1)} kg ${CO2E}`;
  }
  return `${cifra(n / 1000, 2)} t ${CO2E}`;
}

/** Intensidad en gramos de CO₂e por tonelada-kilómetro. */
export function formatoIntensidad(gramosPorTonKm: Cifra): string {
  const n = aNumero(gramosPorTonKm);
  if (n === null) {
    return SIN_DATO;
  }
  return `${cifra(n, 0)} g ${CO2E}/t·km`;
}

/** Factor de emisión de un combustible, en kilogramos de CO₂e por litro. */
export function formatoFactorEmision(kgPorLitro: Cifra): string {
  const n = aNumero(kgPorLitro);
  if (n === null) {
    return SIN_DATO;
  }
  return `${cifra(n, 2)} kg ${CO2E}/L`;
}
