import type { ReactNode } from 'react';

export function InicioShell({
  saludo,
  linea,
  testId,
  encabezado,
  children,
}: {
  saludo: string;
  linea: string;
  testId: string;
  encabezado?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div data-testid={testId} className="min-w-0">
      <header>
        <h1 className="font-bold text-2xl text-neutral-900 tracking-tight">{saludo}</h1>
        <p className="mt-1 text-neutral-600 text-sm">{linea}</p>
      </header>
      {encabezado}
      <h2 className="mt-6 font-semibold text-neutral-500 text-xs uppercase tracking-wider">
        Tu negocio hoy
      </h2>
      <div className="mt-3">{children}</div>
    </div>
  );
}
