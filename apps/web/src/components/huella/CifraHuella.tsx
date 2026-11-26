import { type FootprintPresentation, FootprintSeal, cn } from '@booster-ai/ui-components';
import type { HTMLAttributes } from 'react';
import { SIN_DATO, formatoEmisiones, formatoIntensidad } from '../../lib/formato-emisiones.js';

/**
 * Cifra de huella con su sello (`.specs/sello-huella-toda-la-web`, frente 2
 * del rediseño). Junto con el formateador, es el único archivo de `apps/web`
 * que escribe una cifra de emisiones: `sin-cifras-de-emisiones-sueltas.test.ts`
 * falla si otro llama a `formatoEmisiones` o `formatoIntensidad`.
 *
 * La presentación es obligatoria y sale del API (ADR-091, la misma función que
 * el certificado). Sin dato no hay cifra, y por tanto tampoco sello.
 */
export type Presentacion = FootprintPresentation;

/** Orden en que se listan las clases de un total. */
export const PRESENTACIONES: readonly Presentacion[] = ['primario', 'medido_teltonika', 'estimado'];

type Atributos = Omit<HTMLAttributes<HTMLSpanElement>, 'children'> & {
  'data-testid'?: string;
};

export interface CifraHuellaProps extends Atributos {
  valor: number | string | null | undefined;
  presentacion: Presentacion;
  /** `emisiones` en kg CO₂e (por defecto) o `intensidad` en g CO₂e/t·km. */
  tipo?: 'emisiones' | 'intensidad';
  /**
   * `en-linea` (por defecto): el sello al lado de la cifra, para textos y celdas.
   * `apilada`: la cifra arriba y el sello debajo, alineados a la izquierda; las
   * tres presentaciones quedan con el mismo ritmo aunque el sello intermedio sea
   * largo.
   */
  disposicion?: 'en-linea' | 'apilada';
}

export function CifraHuella({
  valor,
  presentacion,
  tipo = 'emisiones',
  disposicion = 'en-linea',
  className,
  ...rest
}: CifraHuellaProps) {
  const texto = tipo === 'intensidad' ? formatoIntensidad(valor) : formatoEmisiones(valor);
  // Un valor fuera del contrato no afirma lo medido.
  const sello: Presentacion = PRESENTACIONES.includes(presentacion) ? presentacion : 'estimado';
  if (texto === SIN_DATO) {
    return (
      <span className={className} {...rest}>
        {SIN_DATO}
      </span>
    );
  }
  return (
    <span
      data-cifra-huella=""
      data-presentacion={sello}
      className={cn(
        disposicion === 'apilada'
          ? 'flex flex-col items-start gap-1'
          : 'inline-flex flex-wrap items-center gap-x-2 gap-y-1',
        className,
      )}
      {...rest}
    >
      <span className="whitespace-nowrap">{texto}</span>
      <FootprintSeal presentacion={sello} />
    </span>
  );
}

export interface TotalHuellaProps extends Atributos {
  /** Kilogramos por presentación. Una clase en cero no se lista. */
  porPresentacion: Partial<Record<Presentacion, number>>;
  /** Texto cuando ninguna clase tiene valor. */
  vacio?: string;
}

/** Un total separado por clase: ninguna cifra mezcla medido con estimado. */
export function TotalHuella({
  porPresentacion,
  vacio = 'Sin emisiones registradas',
  className,
  ...rest
}: TotalHuellaProps) {
  const lineas = PRESENTACIONES.filter((p) => (porPresentacion[p] ?? 0) !== 0);
  if (lineas.length === 0) {
    return (
      <span className={className} {...rest}>
        {vacio}
      </span>
    );
  }
  return (
    <span
      data-total-huella=""
      className={cn('flex flex-col divide-y divide-neutral-100', className)}
      {...rest}
    >
      {lineas.map((p) => (
        <CifraHuella
          key={p}
          valor={porPresentacion[p]}
          presentacion={p}
          disposicion="apilada"
          className="py-2 first:pt-0 last:pb-0"
        />
      ))}
    </span>
  );
}
