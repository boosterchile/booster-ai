import { zIndex } from '@booster-ai/ui-tokens';
import type { ReactNode } from 'react';
import {
  Modal as AriaModal,
  ModalOverlay as AriaModalOverlay,
  Dialog,
  Heading,
} from 'react-aria-components';
import { cn } from './cn.js';
import { useRegister } from './register-provider.js';

type DialogRenderProps = { close: () => void };

export interface ModalProps {
  /** Estado controlado. */
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  /**
   * Click en el backdrop cierra. Default `true`. Poné `false` en confirmaciones
   * destructivas (cancelar un flete): no deben cerrarse por click accidental.
   * Esc cierra SIEMPRE (no configurable).
   */
  isDismissable?: boolean;
  /** Título del diálogo (`Heading`). Si no lo pasás, dale un `aria-label`. */
  title?: string;
  'aria-label'?: string;
  className?: string;
  /** Passthrough al box del modal (p.ej. `data-testid`). */
  'data-testid'?: string;
  /** Contenido. Función `({ close }) => …` para cerrar desde adentro. */
  children: ReactNode | ((opts: DialogRenderProps) => ReactNode);
}

/**
 * Modal primitivo (grupo **dual**, optimizado para OPERADOR — el conductor es
 * voice-first ~90% y casi no ve modales; responde al registro pero sin variante
 * conductor elaborada). Comportamiento accesible por **react-aria-components**
 * (headless): overlay + backdrop + focus-trap + retorno de foco al trigger +
 * scroll-lock. Apariencia 100% con tokens D1.
 *
 * **Portal al `body`**: queda FUERA del ancestro `RegisterProvider`, así que
 * **re-aplica `data-register`/`data-density`** en el overlay (leídos de
 * `useRegister()`) para que el registro llegue al portal. El **acento NO** se
 * re-aplica: vive en `:root` (`data-accent`) y cascada global (gate parte 1).
 *
 * Foco al abrir: primer enfocable (RAC `autoFocus`); en confirmaciones poné
 * `autoFocus` en el botón seguro (Cancelar). Esc cierra siempre; el click-afuera
 * es configurable con `isDismissable`.
 */
export function Modal({
  isOpen,
  onOpenChange,
  isDismissable = true,
  title,
  className,
  children,
  'aria-label': ariaLabel,
  'data-testid': dataTestid,
}: ModalProps) {
  const { register, density } = useRegister();
  // Con `title`, el `Heading slot="title"` da el nombre accesible; sin título,
  // se usa `aria-label`. Spread condicional: RAC tipa `aria-label` como `string`
  // (exactOptionalPropertyTypes rechaza pasar `undefined`).
  const dialogLabel = title ? undefined : ariaLabel;
  return (
    <AriaModalOverlay
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      isDismissable={isDismissable}
      // Re-aplica SOLO el registro en el portal (el acento se hereda de :root).
      data-register={register}
      data-density={density}
      className="fixed inset-0 flex items-center justify-center bg-neutral-1000/50 p-4"
      style={{ zIndex: zIndex.modal }}
    >
      <AriaModal
        data-testid={dataTestid}
        className={cn(
          'w-full max-w-lg rounded-lg border border-neutral-200 bg-neutral-0 text-neutral-900 shadow-xl',
          className,
        )}
        // padding por registro (custom properties de Ola 0), heredado del overlay
        style={{ paddingBlock: 'var(--pad-y)', paddingInline: 'var(--pad-x)' }}
      >
        <Dialog {...(dialogLabel ? { 'aria-label': dialogLabel } : {})} className="outline-none">
          {(renderProps) => (
            <>
              {title ? (
                <Heading slot="title" className="mb-2 font-semibold text-lg">
                  {title}
                </Heading>
              ) : null}
              {typeof children === 'function' ? children(renderProps) : children}
            </>
          )}
        </Dialog>
      </AriaModal>
    </AriaModalOverlay>
  );
}
