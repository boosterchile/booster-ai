/**
 * Cobro mensual de suscripciones en UF (ADR-079 §4). Función PURA.
 *
 * - Generador: `generadorUfEmpresaMes` por empresa.
 * - Transportista: por camión activo sobre `camionesSinCobro` (el umbral es
 *   la cantidad de camiones que no se cobran; con ese número o menos, no
 *   paga). Con gestión de flota se usa la tarifa `transportistaGestionFlota…`.
 * - Una empresa con ambos roles recibe una sola factura con las dos líneas.
 *
 * Los precios en UF son netos: `subtotal = round(montoUf × ufValorClp)`,
 * `iva = round(subtotal × ivaRate)`, `total = subtotal + iva`, HALF_UP a CLP
 * entero. Decisión del PO del 2026-10-08 ante la contradicción de ADR-079
 * (Verificación 5 sin IVA vs. práctica tributaria); declarada en la spec.
 */

export interface PreciosSuscripcionUf {
  transportistaUfCamionMes: number;
  transportistaGestionFlotaUfCamionMes: number;
  generadorUfEmpresaMes: number;
  /** Camiones activos que no se cobran (entero ≥ 0). */
  camionesSinCobro: number;
}

export interface CobroSuscripcionUfInput {
  esGeneradorCarga: boolean;
  esTransportista: boolean;
  /** Camiones (vehículos motrices) activos de la empresa. */
  camionesActivos: number;
  gestionFlota: boolean;
  precios: PreciosSuscripcionUf;
  /** Valor UF del día de emisión, en CLP. */
  ufValorClp: number;
  ivaRate: number;
  /** epoch ms de emisión; base del vencimiento. */
  hoyMs: number;
  diasVencimiento?: number;
}

export type ConceptoSuscripcion =
  | 'suscripcion_generador'
  | 'suscripcion_transportista'
  | 'suscripcion_transportista_gestion_flota';

export interface LineaSuscripcion {
  concepto: ConceptoSuscripcion;
  cantidad: number;
  ufUnitario: number;
  montoUf: number;
}

export type CobroSuscripcionUfOutput =
  | { status: 'exenta' }
  | {
      status: 'facturar';
      lineas: LineaSuscripcion[];
      /** Suma de las líneas, a 4 decimales (`facturas_booster_clp.monto_uf`). */
      montoUf: number;
      ufValorClp: number;
      subtotalClp: number;
      ivaClp: number;
      totalClp: number;
      venceEn: Date;
    };

const DIA_MS = 24 * 60 * 60 * 1000;

/** Redondeo a 4 decimales de UF (escala de `monto_uf numeric(12,4)`). */
function uf4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

function validar(input: CobroSuscripcionUfInput): void {
  const fallo = (msg: string): never => {
    throw new Error(`calcularCobroSuscripcionUf: ${msg}`);
  };
  if (!Number.isFinite(input.ufValorClp) || input.ufValorClp <= 0) {
    fallo(`ufValorClp inválido (${input.ufValorClp})`);
  }
  if (!Number.isFinite(input.ivaRate) || input.ivaRate < 0 || input.ivaRate > 1) {
    fallo(`ivaRate fuera de [0, 1] (${input.ivaRate})`);
  }
  if (!Number.isInteger(input.camionesActivos) || input.camionesActivos < 0) {
    fallo(`camionesActivos debe ser entero ≥ 0 (${input.camionesActivos})`);
  }
  if (!Number.isFinite(input.hoyMs) || input.hoyMs <= 0) {
    fallo(`hoyMs inválido (${input.hoyMs})`);
  }
  const { precios } = input;
  for (const [clave, valor] of Object.entries(precios)) {
    if (!Number.isFinite(valor) || valor < 0) {
      fallo(`precio ${clave} inválido (${valor})`);
    }
  }
  if (!Number.isInteger(precios.camionesSinCobro)) {
    fallo(`camionesSinCobro debe ser entero (${precios.camionesSinCobro})`);
  }
}

export function calcularCobroSuscripcionUf(
  input: CobroSuscripcionUfInput,
): CobroSuscripcionUfOutput {
  validar(input);
  const { precios } = input;
  const lineas: LineaSuscripcion[] = [];

  if (input.esGeneradorCarga && precios.generadorUfEmpresaMes > 0) {
    lineas.push({
      concepto: 'suscripcion_generador',
      cantidad: 1,
      ufUnitario: precios.generadorUfEmpresaMes,
      montoUf: uf4(precios.generadorUfEmpresaMes),
    });
  }

  const camionesCobrados = Math.max(0, input.camionesActivos - precios.camionesSinCobro);
  if (input.esTransportista && camionesCobrados > 0) {
    const ufUnitario = input.gestionFlota
      ? precios.transportistaGestionFlotaUfCamionMes
      : precios.transportistaUfCamionMes;
    if (ufUnitario > 0) {
      lineas.push({
        concepto: input.gestionFlota
          ? 'suscripcion_transportista_gestion_flota'
          : 'suscripcion_transportista',
        cantidad: camionesCobrados,
        ufUnitario,
        montoUf: uf4(camionesCobrados * ufUnitario),
      });
    }
  }

  if (lineas.length === 0) {
    return { status: 'exenta' };
  }

  const montoUf = uf4(lineas.reduce((acc, l) => acc + l.montoUf, 0));
  const subtotalClp = Math.round(montoUf * input.ufValorClp);
  const ivaClp = Math.round(subtotalClp * input.ivaRate);
  return {
    status: 'facturar',
    lineas,
    montoUf,
    ufValorClp: input.ufValorClp,
    subtotalClp,
    ivaClp,
    totalClp: subtotalClp + ivaClp,
    venceEn: new Date(input.hoyMs + (input.diasVencimiento ?? 14) * DIA_MS),
  };
}
