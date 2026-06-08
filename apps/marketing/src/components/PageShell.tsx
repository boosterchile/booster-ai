import type { ReactNode } from 'react';

/**
 * Cáscara común para páginas de contenido (título + intro + slot). Mantiene el
 * layout consistente y permite que cada ruta sea un archivo delgado (T7/T8).
 */
export function PageShell({
  title,
  intro,
  children,
}: {
  title: string;
  intro: string;
  children?: ReactNode;
}) {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="font-bold text-4xl text-neutral-900 tracking-tight">{title}</h1>
      <p className="mt-3 text-lg text-neutral-600">{intro}</p>
      {children ? <div className="mt-8">{children}</div> : null}
    </main>
  );
}
