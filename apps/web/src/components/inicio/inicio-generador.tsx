import type { MeResponse } from '../../hooks/use-me.js';
import {
  fechaLargaEs,
  horaEnZona,
  nombreDePila,
  saludoPorHora,
} from '../inicio-transportista/modelo.js';
import { navSectionsForMe } from '../nav-items.js';
import { buildGeneradorHoy } from './generador.js';
import { InicioGeneradorVista } from './inicio-generador-vista.js';
import { useInicioData } from './use-inicio-data.js';

type MeOnboarded = Extract<MeResponse, { needs_onboarding: false }>;

export function InicioGenerador({
  me,
  soloLectura,
}: {
  me: MeOnboarded;
  soloLectura: boolean;
}) {
  const { viajes, certificados, reintentar } = useInicioData('generador');
  const ahora = new Date();
  const empresa = me.active_membership?.empresa?.legal_name ?? '';
  const pila = nombreDePila(me.user.full_name);
  const saludoBase = saludoPorHora(horaEnZona(ahora));
  const saludo = pila.length > 0 ? `${saludoBase}, ${pila}` : saludoBase;
  const linea = `${fechaLargaEs(ahora)} · ${empresa} · Generador de carga`;
  const negocio = buildGeneradorHoy(viajes, certificados, ahora, { soloLectura });
  const accesos = navSectionsForMe(me).flatMap((seccion) =>
    seccion.heading === 'Generador' ? seccion.items : [],
  );
  return (
    <InicioGeneradorVista
      saludo={saludo}
      linea={linea}
      negocio={negocio}
      accesos={accesos}
      soloLectura={soloLectura}
      onReintentar={(fuente) => {
        reintentar(fuente === 'certificados' ? 'certificados' : 'viajes');
      }}
    />
  );
}
