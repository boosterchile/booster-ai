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

// Primitivas D2 Ola 1 (tontas, token-driven, sin personalidad).
export { Badge, type BadgeProps, type BadgeVariant } from './badge.js';
export { Button, type ButtonProps, type ButtonVariant } from './button.js';
export { Card, CardBody, CardFooter, CardHeader, type CardProps } from './card.js';
export { Input, type InputProps } from './input.js';
export {
  ToastProvider,
  type ToastOptions,
  type ToastSeverity,
  useToast,
} from './toast.js';

// Primitiva D2 Ola 2 — Modal (comportamiento accesible por react-aria-components).
export { Modal, type ModalProps } from './modal.js';
