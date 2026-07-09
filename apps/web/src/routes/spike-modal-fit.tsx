import { RegisterProvider } from '@booster-ai/ui-components';
import {
  Button as AriaButton,
  Dialog,
  DialogTrigger,
  Modal,
  ModalOverlay,
} from 'react-aria-components';

/**
 * SPIKE — NO productivo. Gate de encaje de `react-aria-components` para el
 * Modal (parte 1). Existe SOLO en la rama spike para verificar en Chromium que:
 *   1. el modelo de estados de RAC (`[data-hovered]`, etc.) se estiliza con
 *      nuestras custom properties (acento);
 *   2. el acento (que vive en `:root` vía `data-accent`) alcanza el portal;
 *   3. el registro (que vive en un wrapper `RegisterProvider`) NO alcanza el
 *      portal — el modal cae al default de `:root` (operador).
 *
 * NO es el Modal productivo (sin focus-trap propio, sin backdrop configurable,
 * sin scroll-lock declarado); RAC aporta el comportamiento. Se descarta.
 *
 * El wrapper es `register="conductor"`: el BOTÓN (dentro del wrapper) tendrá
 * padding de conductor; el MODAL (porteado al body, fuera del wrapper) tendrá
 * padding de operador. Ese contraste es la prueba del portal.
 */
export function SpikeModalFitRoute() {
  return (
    <div className="p-8">
      {/* Estiliza un ESTADO de RAC ([data-hovered]) con nuestra custom property
          de acento — prueba de que el styling de RAC juega con los tokens. */}
      <style>{`
        [data-testid="spike-open"][data-hovered] { background-color: var(--accent-100); }
      `}</style>

      <RegisterProvider register="conductor" density="comoda" className="inline-block">
        <DialogTrigger>
          <AriaButton
            data-testid="spike-open"
            className="rounded-md bg-accent-600 font-medium text-sm text-white"
            style={{ paddingBlock: 'var(--pad-y)', paddingInline: 'var(--pad-x)' }}
          >
            Abrir modal (spike)
          </AriaButton>

          <ModalOverlay
            data-testid="spike-overlay"
            className="fixed inset-0 flex items-center justify-center bg-black/40"
            style={{ zIndex: 1400 }}
          >
            <Modal
              data-testid="spike-modal"
              className="rounded-lg border-2 bg-neutral-0 shadow-lg"
              style={{
                borderColor: 'var(--accent-600)',
                paddingBlock: 'var(--pad-y)',
                paddingInline: 'var(--pad-x)',
                minWidth: '18rem',
              }}
            >
              <Dialog aria-label="Modal de prueba" className="outline-none">
                {({ close }) => (
                  <>
                    <p data-testid="spike-modal-text" className="text-neutral-900">
                      Contenido del modal
                    </p>
                    <AriaButton
                      data-testid="spike-close"
                      onPress={close}
                      className="mt-4 rounded-md border border-neutral-300 px-3 py-2 text-neutral-900 text-sm"
                    >
                      Cerrar
                    </AriaButton>
                  </>
                )}
              </Dialog>
            </Modal>
          </ModalOverlay>
        </DialogTrigger>
      </RegisterProvider>
    </div>
  );
}
