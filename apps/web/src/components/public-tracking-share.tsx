import { Button } from '@booster-ai/ui-components';
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
      <Button
        variant="secondary"
        size="sm"
        onClick={() => {
          void copy();
        }}
        className="mt-2"
      >
        {copied ? 'Copiado' : 'Copiar enlace'}
      </Button>
    </div>
  );
}
