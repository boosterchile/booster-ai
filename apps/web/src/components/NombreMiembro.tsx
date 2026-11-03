/** Textos de un miembro pendiente: los mismos en todas las listas. */
export const TEXTO_PENDIENTE = 'Invitación pendiente';
export const TELEFONO_PENDIENTE = 'Se muestra cuando acepte';
export const CODIGO_REENVIADO = 'Listo, generamos un código nuevo. Entrégaselo a la persona.';

/** Celda del nombre. Si el miembro está pendiente, nunca muestra un dato vacío. */
export function NombreMiembro({
  nombre,
  pendiente,
  rut,
}: {
  nombre: string | null;
  pendiente: boolean;
  rut?: string | null;
}) {
  if (!pendiente && nombre) {
    return <div className="truncate font-medium text-neutral-900">{nombre}</div>;
  }
  return (
    <div data-testid="miembro-pendiente">
      <div className="truncate text-neutral-500">{TEXTO_PENDIENTE}</div>
      {rut && <div className="font-mono text-neutral-500 text-xs">{rut}</div>}
    </div>
  );
}
