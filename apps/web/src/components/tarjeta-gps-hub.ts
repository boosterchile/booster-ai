export type TarjetaGpsHub = 'cargando' | 'error' | 'sin_datos' | 'resuelta';

/**
 * La tarjeta de posición del hub.
 *
 * `isLoading` de TanStack Query es `pendiente && fetching`. En el tick en
 * que la query está pendiente y todavía no salió el fetch (`fetching`
 * false), `isLoading` es false y la tarjeta decía «Sin posición GPS
 * todavía» mientras cargaba. `pendiente` cubre ese tick y el pause.
 */
export function tarjetaGpsHub(input: {
  conImei: boolean;
  pendiente: boolean;
  fetching: boolean;
  error: boolean;
  hayCuerpo: boolean;
}): TarjetaGpsHub {
  if (!input.conImei) {
    return 'sin_datos';
  }
  const esperando = input.pendiente || (input.fetching && !input.hayCuerpo);
  if (esperando) {
    return 'cargando';
  }
  if (input.error) {
    return 'error';
  }
  if (!input.hayCuerpo) {
    return 'sin_datos';
  }
  return 'resuelta';
}
