/**
 * Lo que imprime un certificado reemitido (`.specs/reemision-certificado/`
 * §8-2): a qué versión reemplaza, de qué fecha es y por qué, en una línea.
 */

/**
 * Lista cerrada de motivos (spec §3.4). La restricción
 * `ck_certificados_viaje_motivo` de la base repite esta lista.
 */
export const MOTIVOS_REEMISION = ['factor_impreso_no_corresponde'] as const;
export type MotivoReemision = (typeof MOTIVOS_REEMISION)[number];

/** Cómo se lee cada motivo en el certificado. */
export const TEXTO_MOTIVO_REEMISION: Readonly<Record<MotivoReemision, string>> = {
  factor_impreso_no_corresponde: 'el factor de emisión impreso no era el usado en el cálculo',
};

/** La versión 1 no reemplaza a nadie; una posterior dice a cuál, de cuándo y por qué. */
export type VersionCertificado =
  | { readonly numero: 1 }
  | {
      readonly numero: number;
      readonly reemplazaA: number;
      readonly reemplazaEmitidoEn: Date;
      readonly motivo: MotivoReemision;
    };

/** Una versión ya validada: la línea de reemplazo es null en la versión 1. */
export interface VersionImpresa {
  readonly numero: number;
  readonly reemplazaA: number | null;
  readonly reemplazaEmitidoEn: Date | null;
  readonly motivo: MotivoReemision | null;
}

const esMotivo = (m: unknown): m is MotivoReemision =>
  (MOTIVOS_REEMISION as readonly unknown[]).includes(m);

/**
 * Valida la versión antes de imprimirla. Un certificado firmado que diga
 * «versión 2» sin decir qué reemplaza no resiste una auditoría: falla en vez
 * de generarse.
 */
export function validarVersion(version: VersionCertificado | undefined): VersionImpresa {
  const v = (version ?? { numero: 1 }) as Partial<{
    numero: unknown;
    reemplazaA: unknown;
    reemplazaEmitidoEn: unknown;
    motivo: unknown;
  }>;
  const numero = v.numero;
  if (typeof numero !== 'number' || !Number.isInteger(numero) || numero < 1) {
    throw new Error(`versión de certificado inválida: ${String(numero)}`);
  }
  if (numero === 1) {
    return { numero, reemplazaA: null, reemplazaEmitidoEn: null, motivo: null };
  }
  const { reemplazaA, reemplazaEmitidoEn, motivo } = v;
  if (reemplazaA === undefined || !(reemplazaEmitidoEn instanceof Date) || motivo === undefined) {
    throw new Error(
      `versión ${numero} sin los datos del reemplazo (versión anterior, su fecha y el motivo)`,
    );
  }
  if (
    typeof reemplazaA !== 'number' ||
    !Number.isInteger(reemplazaA) ||
    reemplazaA < 1 ||
    reemplazaA >= numero
  ) {
    throw new Error(`versión ${numero}: no puede reemplazar a la versión ${String(reemplazaA)}`);
  }
  if (Number.isNaN(reemplazaEmitidoEn.getTime())) {
    throw new Error(`versión ${numero}: la fecha de la versión que reemplaza no es válida`);
  }
  if (!esMotivo(motivo)) {
    throw new Error(`versión ${numero}: motivo de reemisión desconocido: ${String(motivo)}`);
  }
  return { numero, reemplazaA, reemplazaEmitidoEn, motivo };
}

/** «Reemplaza a la versión 1, emitida el 03-11-2026. Motivo: …», o null en la versión 1. */
export function lineaReemplazo(
  v: VersionImpresa,
  formatearFecha: (d: Date) => string,
): string | null {
  if (v.reemplazaA === null || v.reemplazaEmitidoEn === null || v.motivo === null) {
    return null;
  }
  return `Reemplaza a la versión ${v.reemplazaA}, emitida el ${formatearFecha(
    v.reemplazaEmitidoEn,
  )}. Motivo: ${TEXTO_MOTIVO_REEMISION[v.motivo]}.`;
}
