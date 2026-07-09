/**
 * Registro y densidad — dimensiones CSS-driven del registro "producto".
 *
 * DESIGN.md §4.2: *"El sistema da simplicidad al conductor y potencia-sin-fricción
 * al operador con los mismos componentes base, configurados distinto."* El
 * registro fija la escala base (conductor = grande, para guantes/movimiento/sol,
 * §4.1/§6; operador = sobrio/denso). La densidad la modula (`comoda`/`compacta`).
 *
 * Mecanismo (codegen en `css.ts`): cada bloque `[data-register]` emite
 * `--pad-y|--pad-x|--gap: calc(<base> * var(--density-scale))` con el literal
 * del registro inlineado, y `--touch-min` como piso fijo (la densidad NUNCA lo
 * escala — es a11y). Los bloques `[data-density]` solo fijan `--density-scale`.
 *
 * Invariante del que depende el `calc`: `data-register` y `data-density` van en
 * el MISMO ancestro (lo garantiza `RegisterProvider` en ui-components). Cambiar
 * el atributo re-cascadea sin rebuild — mismo patrón runtime que `data-accent`.
 */

export type RegisterKey = 'operador' | 'conductor';
export type DensityKey = 'comoda' | 'compacta';

export interface RegisterScale {
  /** Piso de target táctil por registro (a11y). La densidad NO lo escala. */
  touchMin: string;
  /** Padding vertical base (lo escala la densidad). */
  padY: string;
  /** Padding horizontal base (lo escala la densidad). */
  padX: string;
  /** Gap base (lo escala la densidad). */
  gap: string;
}

/** Bases por registro. Ola 0 (ajustables): conductor holgado, operador denso. */
export const registerScales: Record<RegisterKey, RegisterScale> = {
  operador: { touchMin: '44px', padY: '0.5rem', padX: '0.75rem', gap: '0.5rem' },
  conductor: { touchMin: '56px', padY: '0.875rem', padX: '1.25rem', gap: '0.75rem' },
};

/** Multiplicador de densidad sobre padding/gap (nunca sobre `--touch-min`). */
export const densityScales: Record<DensityKey, string> = {
  comoda: '1',
  compacta: '0.8',
};

export const REGISTER_KEYS = Object.keys(registerScales) as RegisterKey[];
export const DENSITY_KEYS = Object.keys(densityScales) as DensityKey[];

export const REGISTER_DEFAULT: RegisterKey = 'operador';
export const DENSITY_DEFAULT: DensityKey = 'comoda';

export const REGISTER_LABEL: Record<RegisterKey, string> = {
  operador: 'Operador',
  conductor: 'Conductor',
};

export const DENSITY_LABEL: Record<DensityKey, string> = {
  comoda: 'Cómoda',
  compacta: 'Compacta',
};
