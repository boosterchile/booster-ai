import { zIndex } from '@booster-ai/ui-tokens';
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { cn } from './cn.js';

export type ToastSeverity = 'success' | 'error' | 'warning' | 'info' | 'neutral';

export interface ToastOptions {
  title: string;
  description?: string;
  /** `error` se anuncia `assertive` (role=alert); el resto `polite` (role=status). */
  severity?: ToastSeverity;
  /** ms hasta auto-cerrar. `<= 0` no auto-cierra (queda hasta dismiss manual). */
  duration?: number;
}

interface ToastItem extends ToastOptions {
  id: string;
  severity: ToastSeverity;
}

interface ToastContextValue {
  /** Encola un toast; devuelve su id (para `dismiss` programático). */
  notify: (opts: ToastOptions) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

/** Colores por severidad — tints/bordes semánticos FIJOS de D1. */
const SEVERITY_CLASS: Record<ToastSeverity, string> = {
  success: 'bg-success-50 text-success-700 border-success-500',
  error: 'bg-danger-50 text-danger-700 border-danger-500',
  warning: 'bg-warning-50 text-warning-700 border-warning-500',
  info: 'bg-info-50 text-info-700 border-info-500',
  neutral: 'bg-neutral-0 text-neutral-900 border-neutral-300',
};

const DEFAULT_DURATION = 5000;

/**
 * Sistema de Toast (grupo **dual-sistema**). `ToastProvider` monta un portal en
 * `document.body` con una región `aria-live`; `useToast()` expone `notify`/`dismiss`.
 * Cada toast: `role=alert`/`assertive` si `error`, si no `role=status`/`polite`;
 * auto-cierre por timer; dismiss por teclado (botón "Cerrar" nativo). **No** roba
 * foco ni hace focus-trap. z-index desde el token D1 `zIndex.toast`. Padding vía
 * las custom properties de registro (dual, a nivel documento). Sin personalidad.
 */
export function ToastProvider({
  children,
  duration = DEFAULT_DURATION,
}: {
  children: ReactNode;
  duration?: number;
}) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const notify = useCallback((opts: ToastOptions) => {
    idRef.current += 1;
    const id = String(idRef.current);
    setToasts((prev) => [...prev, { ...opts, id, severity: opts.severity ?? 'neutral' }]);
    return id;
  }, []);

  const value = useMemo<ToastContextValue>(() => ({ notify, dismiss }), [notify, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} defaultDuration={duration} />
    </ToastContext.Provider>
  );
}

/** Lee el sistema de toast. Lanza si se usa fuera del `ToastProvider`. */
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (ctx === null) {
    throw new Error('useToast debe usarse dentro de <ToastProvider>');
  }
  return ctx;
}

function ToastViewport({
  toasts,
  onDismiss,
  defaultDuration,
}: {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
  defaultDuration: number;
}) {
  if (typeof document === 'undefined') {
    return null;
  }
  return createPortal(
    // <section> con nombre accesible = role="region" implícito; NO roba foco
    // (sin autofocus, sin focus-trap).
    <section
      aria-label="Notificaciones"
      className="fixed right-0 bottom-0 flex flex-col p-4"
      style={{ zIndex: zIndex.toast, gap: 'var(--gap)' }}
    >
      {toasts.map((toast) => (
        <ToastRow
          key={toast.id}
          toast={toast}
          onDismiss={onDismiss}
          defaultDuration={defaultDuration}
        />
      ))}
    </section>,
    document.body,
  );
}

function ToastRow({
  toast,
  onDismiss,
  defaultDuration,
}: {
  toast: ToastItem;
  onDismiss: (id: string) => void;
  defaultDuration: number;
}) {
  const duration = toast.duration ?? defaultDuration;

  useEffect(() => {
    if (duration <= 0) {
      return;
    }
    const timer = setTimeout(() => onDismiss(toast.id), duration);
    return () => clearTimeout(timer);
  }, [toast.id, duration, onDismiss]);

  const assertive = toast.severity === 'error';

  return (
    <div
      role={assertive ? 'alert' : 'status'}
      aria-live={assertive ? 'assertive' : 'polite'}
      className={cn(
        'flex items-start gap-2 rounded-md border shadow-md',
        SEVERITY_CLASS[toast.severity],
      )}
      style={{ paddingBlock: 'var(--pad-y)', paddingInline: 'var(--pad-x)' }}
    >
      <div className="flex-1">
        <p className="font-medium text-sm">{toast.title}</p>
        {toast.description && <p className="text-sm opacity-90">{toast.description}</p>}
      </div>
      <button
        type="button"
        aria-label="Cerrar"
        onClick={() => onDismiss(toast.id)}
        className="shrink-0 rounded text-lg leading-none opacity-70 hover:opacity-100"
      >
        <span aria-hidden="true">×</span>
      </button>
    </div>
  );
}
