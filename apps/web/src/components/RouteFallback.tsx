/**
 * Fallback de carga para rutas lazy (code-splitting, audit P1-J).
 *
 * TanStack Router lo muestra como `defaultPendingComponent` mientras descarga
 * el chunk JS de una ruta diferida (tras `defaultPendingMs`). Mismo estilo que
 * `ProtectedRoute:FullPageSplash`, con atributos a11y para anunciar la carga.
 */
export function RouteFallback() {
  return (
    <output
      aria-live="polite"
      className="flex min-h-screen items-center justify-center bg-neutral-50"
    >
      <span className="font-medium text-neutral-500 text-sm">Cargando…</span>
    </output>
  );
}
