import {
  DENSITY_DEFAULT,
  type DensityKey,
  REGISTER_DEFAULT,
  type RegisterKey,
} from '@booster-ai/ui-tokens';
import { type ReactNode, createContext, useContext } from 'react';

export interface RegisterContextValue {
  register: RegisterKey;
  density: DensityKey;
}

const RegisterContext = createContext<RegisterContextValue>({
  register: REGISTER_DEFAULT,
  density: DENSITY_DEFAULT,
});

export interface RegisterProviderProps {
  register?: RegisterKey;
  density?: DensityKey;
  /** Clase del ancestro. El wrapper es un `div` común; el consumidor lo estiliza. */
  className?: string;
  children: ReactNode;
}

/**
 * Ancestro CSS-driven del registro/densidad. Setea `data-register` y
 * `data-density` **co-locados** en un `div` (invariante del que depende el
 * `calc` de `ui-tokens/theme.css`), y expone el valor por contexto para el caso
 * raro (`useRegister`). NO dirige el rendering de las primitivas por state JS:
 * las primitivas responden solo vía las custom properties del theme (`--pad-y`,
 * `--touch-min`, …). Cambiar los props re-cascadea en runtime, sin rebuild —
 * mismo patrón que `data-accent`.
 */
export function RegisterProvider({
  register = REGISTER_DEFAULT,
  density = DENSITY_DEFAULT,
  className,
  children,
}: RegisterProviderProps) {
  return (
    <RegisterContext.Provider value={{ register, density }}>
      <div data-register={register} data-density={density} className={className}>
        {children}
      </div>
    </RegisterContext.Provider>
  );
}

/** Lee el registro/densidad activos. Caso raro: las primitivas usan CSS, no esto. */
export function useRegister(): RegisterContextValue {
  return useContext(RegisterContext);
}
