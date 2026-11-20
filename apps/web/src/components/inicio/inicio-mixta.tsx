import type { MeResponse } from '../../hooks/use-me.js';
import type { FuenteReintento } from '../inicio-transportista/modelo.js';
import {
  fechaLargaEs,
  horaEnZona,
  nombreDePila,
  saludoPorHora,
} from '../inicio-transportista/modelo.js';
import { buildNegocioHoy } from '../inicio-transportista/negocio.js';
import { useDatosInicio } from '../inicio-transportista/use-datos-inicio.js';
import { navSectionsForMe } from '../nav-items.js';
import { buildGeneradorHoy } from './generador.js';
import { InicioMixtaVista } from './inicio-mixta-vista.js';
import { useInicioData } from './use-inicio-data.js';

type MeOnboarded = Extract<MeResponse, { needs_onboarding: false }>;

const FUENTES_TRANSPORTE = new Set<string>([
  'ofertas',
  'servicios',
  'cumplimiento',
  'flota',
  'vehiculos',
  'conductores',
]);

export function InicioMixta({ me, soloLectura }: { me: MeOnboarded; soloLectura: boolean }) {
  const { datos, reintentar } = useDatosInicio();
  const generadorData = useInicioData('mixta');
  const ahora = new Date();
  const negocio = buildNegocioHoy(datos, ahora);
  const generador = buildGeneradorHoy(generadorData.viajes, generadorData.certificados, ahora, {
    soloLectura,
  });
  const empresa = me.active_membership?.empresa?.legal_name ?? '';
  const pila = nombreDePila(me.user.full_name);
  const saludoBase = saludoPorHora(horaEnZona(ahora));
  const saludo = pila.length > 0 ? `${saludoBase}, ${pila}` : saludoBase;
  const secciones = navSectionsForMe(me);
  const accesosTransporte = secciones.flatMap((seccion) =>
    seccion.heading === 'Transporte' ? seccion.items : [],
  );
  const accesosGenerador = secciones.flatMap((seccion) =>
    seccion.heading === 'Generador' ? seccion.items : [],
  );
  return (
    <InicioMixtaVista
      saludo={saludo}
      linea={`${fechaLargaEs(ahora)} · ${empresa}`}
      negocio={negocio}
      generador={generador}
      ahora={ahora}
      accesosTransporte={accesosTransporte}
      accesosGenerador={accesosGenerador}
      soloLectura={soloLectura}
      onReintentar={(fuente) => {
        if (fuente === 'viajes' || fuente === 'certificados') {
          generadorData.reintentar(fuente);
          return;
        }
        if (FUENTES_TRANSPORTE.has(fuente)) {
          reintentar(fuente as FuenteReintento);
        }
      }}
    />
  );
}
