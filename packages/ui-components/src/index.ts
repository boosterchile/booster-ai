/**
 * @booster-ai/ui-components
 *
 * Primitivas "tontas" del registro producto (sin personalidad). Cimiento de la
 * librería (D2 Ola 0): el helper `cn()` y el sistema de registro/densidad
 * CSS-driven (`RegisterProvider` + `useRegister`). Los valores del theme viven
 * en `@booster-ai/ui-tokens` (fuente única); acá va solo el wiring React.
 */
export { cn } from './cn.js';
export {
  RegisterProvider,
  type RegisterContextValue,
  type RegisterProviderProps,
  useRegister,
} from './register-provider.js';
