import {
  type NivelCertificacion,
  THRESHOLD_PRIMARIO_PCT,
  THRESHOLD_SECUNDARIO_MODELED_PCT,
  derivarNivelCertificacion,
} from '@booster-ai/carbon-calculator';

/**
 * HC-001 PR1 — decisión de fuente de la huella. Función PURA.
 * Reglas: historia.md R1–R3/R5 y datos-can.md §4 (prevalece sobre R2/AC4).
 * El opt-in no es input (R4, historia.md rev. 3: siempre se emite).
 */
export const DECISION_VERSION = 2; // v2 (HC-005): gobierna la emisión + nivel_no_evaluado

/** Fallback de fuente: por qué la distancia o la energía no son medidas. */
export const MOTIVOS_FALLBACK = [
  'sin_dispositivo',
  'sin_pings_en_ventana',
  'sin_observacion_continua',
  'imei_sin_puntos_por_vehiculo', // reservado: requiere contar por IMEI
  'cap_huecos',
  'routes_error',
  'cobertura_bajo_umbral',
  'distancia_invalida', // reconstrucción ok pero km ≤0 o no finito
  'peso_ausente',
  'can_sin_lecturas',
  'can_cobertura_insuficiente',
  'can_no_monotono',
  'can_fuera_de_banda',
  'can_combustible_no_soportado',
  'telemetria_pendiente', // reservado: firma provisional (PR3)
  'ventana_excede_tope', // el resumidor CAN no lee ventanas más largas que el tope
] as const;
export type MotivoFallback = (typeof MOTIVOS_FALLBACK)[number];

/** Anotaciones de auditoría: no son fallback ni cambian fuente o nivel. */
// nivel_no_evaluado (HC-005): can_83 sin nivel 89 comparable (capacidad NULL, recarga o
// sin 89). Distinto de «sin alerta»: el chequeo cruzado no se hizo.
export const ALERTAS_DECISION = ['discrepancia_can', 'nivel_no_evaluado'] as const;
export type AlertaDecision = (typeof ALERTAS_DECISION)[number];

export const FUENTES_DISTANCIA = ['teltonika_gps', 'movil_gps', 'routes_estimada'] as const;
export type FuenteDistancia = (typeof FUENTES_DISTANCIA)[number];
export const FUENTES_ENERGIA = ['can_83', 'modelo_perfil', 'por_defecto'] as const;
export type FuenteEnergia = (typeof FUENTES_ENERGIA)[number];

/** Guardrails del contador 83 (datos-can.md §4.3 y §4.5). */
export const CAN_BANDA_L_100KM = { min: 15, max: 70 } as const;
export const CAN_BANDA_VS_BASE = { min: 0.5, max: 2 } as const;
export const CAN_SALTO_MAX_L_POR_PASO = 50;
export const CAN_DISCREPANCIA_NIVEL = 0.25;
const COMBUSTIBLES_83 = new Set(['diesel', 'gasolina']);

/** Resumen del contador 83 en la ventana (Δ × 0,1 L). Se elige por datos, no por config. */
export interface Resumen83 {
  lecturas: number;
  /** km del segmento cubiertos entre lecturas, [0..100]. */
  coberturaKmPct: number;
  /** Pasos con Δ < 0 (reset o glitch). */
  pasosNegativos: number;
  saltoMaxPorPasoL: number;
  litros: number;
}

/** Reconstrucción de la distancia en la ventana con una fuente GPS. */
export type Reconstruccion =
  | { estado: 'ok'; coberturaPct: number; distanciaKm: number }
  | { estado: 'abort'; motivo: 'routes_error' | 'cap_exceeded' | 'sin_observacion' };

export interface EntradaDecisionFuente {
  /** null = el vehículo no tiene Teltonika. */
  gpsTeltonika: Reconstruccion | null;
  /** GPS del móvil del conductor; null = sin posiciones del móvil. */
  gpsMovil: Reconstruccion | null;
  /** Pings del Teltonika en la ventana. */
  pingsEnVentana: number;
  combustible: string | null;
  /** null = no llegó ninguna lectura del 83 en la ventana. */
  can83: Resumen83 | null;
  /** Por qué no se leyó el 83 aunque pudo haber lecturas (motivo en vez de can_sin_lecturas). */
  can83Omitido?: 'ventana_excede_tope' | null;
  /** Consumo por nivel (84/89) suavizado; solo chequeo cruzado. null si no hay o hubo recarga. */
  litrosNivelSinRecarga: number | null;
  consumoBasePor100km: number | null;
  perfilEnergetico: 'consumo_base' | 'tipo_vehiculo' | 'ninguno';
  pesoDeclarado: boolean;
}

export interface DecisionFuente {
  fuenteDistancia: FuenteDistancia;
  fuenteEnergia: FuenteEnergia;
  /** Litros medidos por el 83; null si la energía es modelada. */
  litrosCan: number | null;
  motivoFallback: MotivoFallback | null;
  alertas: AlertaDecision[];
  completitud: 'final' | 'provisional';
  nivel: NivelCertificacion;
  decisionVersion: typeof DECISION_VERSION;
}

type Distancia = {
  fuente: FuenteDistancia;
  coberturaPct: number;
  km: number;
  motivo: MotivoFallback | null;
};

const fin = (x: number) => Number.isFinite(x);

/** Usable para R1: ok, cobertura en [80, 100] y km > 0, todo finito (entrada inválida no lanza). */
function usable(r: Reconstruccion | null): r is Extract<Reconstruccion, { estado: 'ok' }> {
  return (
    r?.estado === 'ok' &&
    fin(r.coberturaPct) &&
    r.coberturaPct >= THRESHOLD_SECUNDARIO_MODELED_PCT &&
    r.coberturaPct <= 100 &&
    fin(r.distanciaKm) &&
    r.distanciaKm > 0
  );
}

function motivoNoUsable(r: Reconstruccion, pings: number): MotivoFallback {
  if (r.estado === 'ok') {
    return fin(r.distanciaKm) && r.distanciaKm > 0 ? 'cobertura_bajo_umbral' : 'distancia_invalida';
  }
  if (r.motivo === 'routes_error') {
    return 'routes_error';
  }
  if (r.motivo === 'cap_exceeded') {
    return 'cap_huecos';
  }
  return pings === 0 ? 'sin_pings_en_ventana' : 'sin_observacion_continua';
}

/** R1: Teltonika ≥80 %, si no móvil ≥80 %, si no Routes con motivo. */
function distancia(e: EntradaDecisionFuente): Distancia {
  const t = e.gpsTeltonika;
  const m = e.gpsMovil;
  const motivo = t === null ? 'sin_dispositivo' : motivoNoUsable(t, e.pingsEnVentana);
  if (usable(t)) {
    return {
      fuente: 'teltonika_gps',
      coberturaPct: t.coberturaPct,
      km: t.distanciaKm,
      motivo: null,
    };
  }
  if (usable(m)) {
    return { fuente: 'movil_gps', coberturaPct: m.coberturaPct, km: m.distanciaKm, motivo };
  }
  return { fuente: 'routes_estimada', coberturaPct: 0, km: 0, motivo };
}

/** null si el 83 es usable; si no, el guardrail que lo descarta. */
function guardrail83(e: EntradaDecisionFuente, c: Resumen83, km: number): MotivoFallback | null {
  // N3: 'Diesel' o ' diesel ' valen igual que 'diesel'.
  if (!COMBUSTIBLES_83.has(e.combustible?.trim().toLowerCase() ?? '')) {
    return 'can_combustible_no_soportado';
  }
  // Guardrails en forma positiva: NaN/Infinity nunca pasan (QA F1).
  if (!(fin(c.lecturas) && c.lecturas >= 2)) {
    return 'can_sin_lecturas';
  }
  if (!(c.coberturaKmPct >= THRESHOLD_PRIMARIO_PCT && c.coberturaKmPct <= 100)) {
    return 'can_cobertura_insuficiente';
  }
  if (
    !(
      c.pasosNegativos === 0 &&
      fin(c.saltoMaxPorPasoL) &&
      c.saltoMaxPorPasoL >= 0 &&
      c.saltoMaxPorPasoL <= CAN_SALTO_MAX_L_POR_PASO
    )
  ) {
    return 'can_no_monotono';
  }
  const l100 = (c.litros / km) * 100;
  const base = e.consumoBasePor100km;
  const enBase =
    base === null || (l100 >= base * CAN_BANDA_VS_BASE.min && l100 <= base * CAN_BANDA_VS_BASE.max);
  if (
    !(fin(c.litros) && l100 >= CAN_BANDA_L_100KM.min && l100 <= CAN_BANDA_L_100KM.max && enBase)
  ) {
    return 'can_fuera_de_banda';
  }
  return null;
}

export function decidirFuenteHuella(e: EntradaDecisionFuente): DecisionFuente {
  const d = distancia(e);
  const modelada: FuenteEnergia =
    e.perfilEnergetico === 'ninguno' ? 'por_defecto' : 'modelo_perfil';
  let energia: FuenteEnergia = modelada;
  let motivoCan: MotivoFallback | null = null;
  let litrosCan: number | null = null;
  const alertas: AlertaDecision[] = [];
  // El 83 solo mide sobre la distancia GPS del propio Teltonika (el 107 nunca es fuente).
  if (d.fuente === 'teltonika_gps') {
    motivoCan =
      e.can83 === null ? (e.can83Omitido ?? 'can_sin_lecturas') : guardrail83(e, e.can83, d.km);
    if (e.can83 !== null && motivoCan === null) {
      energia = 'can_83';
      litrosCan = e.can83.litros;
      const nivel = e.litrosNivelSinRecarga;
      if (nivel === null) {
        alertas.push('nivel_no_evaluado');
      } else if (Math.abs(nivel - litrosCan) / litrosCan > CAN_DISCREPANCIA_NIVEL) {
        alertas.push('discrepancia_can');
      }
    }
  }
  return {
    fuenteDistancia: d.fuente,
    fuenteEnergia: energia,
    litrosCan,
    // R5: peso_ausente solo se registra; no baja nivel ni bloquea can_83.
    motivoFallback: d.motivo ?? motivoCan ?? (e.pesoDeclarado ? null : 'peso_ausente'),
    alertas,
    // QA F2: provisional si alguna fuente GPS falló por Routes y no se midió con Teltonika.
    completitud:
      d.fuente !== 'teltonika_gps' &&
      [e.gpsTeltonika, e.gpsMovil].some((r) => r?.estado === 'abort' && r.motivo === 'routes_error')
        ? 'provisional'
        : 'final',
    nivel: derivarNivelCertificacion({
      precisionMethod:
        energia === 'can_83'
          ? 'exacto_canbus'
          : energia === 'modelo_perfil'
            ? 'modelado'
            : 'por_defecto',
      routeDataSource: d.fuente === 'routes_estimada' ? 'maps_directions' : d.fuente,
      coveragePct: d.coberturaPct,
    }),
    decisionVersion: DECISION_VERSION,
  };
}
