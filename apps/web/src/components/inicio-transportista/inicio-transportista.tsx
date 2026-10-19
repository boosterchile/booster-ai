import { InicioTransportistaVista } from './inicio-transportista-vista.js';
import { buildInicioVista } from './modelo.js';
import { buildNegocioHoy } from './negocio.js';
import { useDatosInicio } from './use-datos-inicio.js';

/**
 * Inicio del transportista. El nombre y la empresa salen de `/me` (ya resuelto);
 * el resto se pide a los endpoints que ya usan las pantallas de operación.
 */
export function InicioTransportista({
  nombreCompleto,
  legalName,
  esAdmin,
  soloLectura = false,
}: {
  nombreCompleto: string;
  legalName: string;
  esAdmin: boolean;
  soloLectura?: boolean;
}) {
  const { datos, reintentar } = useDatosInicio();
  const ahora = new Date();
  const vista = buildInicioVista(datos, {
    nombreCompleto,
    legalName,
    esAdmin,
    ahora,
  });
  const negocio = buildNegocioHoy(datos, ahora);
  return (
    <InicioTransportistaVista
      vista={vista}
      negocio={negocio}
      onReintentar={reintentar}
      soloLectura={soloLectura}
    />
  );
}
