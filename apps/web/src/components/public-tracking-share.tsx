import { useState } from 'react';

/**
 * Enlace público de seguimiento ya resuelto (`publicTrackingShareUrl`).
 * El URL queda visible para copiarlo a mano si el portapapeles falla.
 */
export function PublicTrackingShare({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3">
      <p className="font-medium text-neutral-900 text-sm">Enlace de seguimiento</p>
      <p className="mt-1 text-neutral-600 text-xs">
        Compartilo para que vean la carga en vivo, sin iniciar sesión.
      </p>
      <a
        href={url}
        aria-label="Enlace de seguimiento público"
        className="mt-2 block break-all font-mono text-primary-700 text-xs underline"
      >
        {url}
      </a>
      <button
        type="button"
        onClick={() => {
          void copy();
        }}
        className="mt-2 rounded-md border border-neutral-300 bg-white px-3 py-1 font-medium text-neutral-800 text-xs hover:bg-neutral-100"
      >
        {copied ? 'Copiado' : 'Copiar enlace'}
      </button>
    </div>
  );
}
