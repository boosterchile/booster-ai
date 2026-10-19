import {
  type RegionCode,
  clasificarTextoPunto,
  comunaPorCodigo,
  comunasDeRegion,
  tieneComaDecimal,
} from '@booster-ai/shared-schemas';
import { useMapsLibrary } from '@vis.gl/react-google-maps';
import { MapPin } from 'lucide-react';
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { logger } from '../../lib/logger.js';
import { FormField, inputClass as fieldInputClass } from '../FormField.js';
import { MapaPinLugar } from './MapaPinLugar.js';
import {
  type LugarDetallado,
  type SugerenciaLugar,
  buscarSugerencias,
  detallarLugar,
} from './buscar-lugares.js';

export type { LugarDetallado } from './buscar-lugares.js';

const REGION_ETIQUETA: Record<RegionCode, string> = {
  XV: 'XV — Arica y Parinacota',
  I: 'I — Tarapacá',
  II: 'II — Antofagasta',
  III: 'III — Atacama',
  IV: 'IV — Coquimbo',
  V: 'V — Valparaíso',
  XIII: 'XIII — Metropolitana',
  VI: 'VI — O’Higgins',
  VII: 'VII — Maule',
  XVI: 'XVI — Ñuble',
  VIII: 'VIII — Biobío',
  IX: 'IX — Araucanía',
  XIV: 'XIV — Los Ríos',
  X: 'X — Los Lagos',
  XI: 'XI — Aysén',
  XII: 'XII — Magallanes',
};

const REGION_ORDEN: RegionCode[] = [
  'XV',
  'I',
  'II',
  'III',
  'IV',
  'V',
  'XIII',
  'VI',
  'VII',
  'XVI',
  'VIII',
  'IX',
  'XIV',
  'X',
  'XI',
  'XII',
];

export interface PuntoResuelto {
  latitude: number;
  longitude: number;
}

interface SelectorLugarProps {
  etiquetaDireccion: string;
  placeholderDireccion: string;
  direccion: string;
  region: RegionCode | '';
  comunaCode: string;
  latitude: number | null;
  longitude: number | null;
  errorDireccion?: string | undefined;
  errorRegion?: string | undefined;
  /** `name` del form para que el scroll al primer error encuentre el control. */
  nombreDireccion?: string | undefined;
  nombreRegion?: string | undefined;
  nombreComuna?: string | undefined;
  /** False cuando no hay key o la key de Maps falló al cargar. */
  mapasDisponibles: boolean;
  onDireccion: (value: string) => void;
  onRegion: (value: RegionCode | '') => void;
  onComuna: (code: string) => void;
  onCoordenadas: (latitude: number | null, longitude: number | null) => void;
  onLugar: (lugar: LugarDetallado) => void;
  resolverEnlace: (texto: string) => Promise<PuntoResuelto | null>;
}

function esRegion(valor: string): valor is RegionCode {
  return Object.hasOwn(REGION_ETIQUETA, valor);
}

function etiquetaPunto(latitude: number, longitude: number): string {
  return `Punto en el mapa (${latitude.toFixed(5)}, ${longitude.toFixed(5)})`;
}

/**
 * Sugerencias de Places bajo el input. Si la librería o la API fallan,
 * avisa una vez y el texto libre sigue funcionando.
 */
type TecladoInput = (event: ReactKeyboardEvent<HTMLInputElement>) => void;

function SugerenciasPlaces({
  listaId,
  consulta,
  abierto,
  onElegir,
  onNoDisponible,
  onCerrar,
  onActivaId,
  tecladoRef,
}: {
  listaId: string;
  consulta: string;
  abierto: boolean;
  onElegir: (lugar: LugarDetallado) => void;
  onNoDisponible: () => void;
  onCerrar: () => void;
  onActivaId: (id: string | null) => void;
  tecladoRef: { current: TecladoInput };
}) {
  const places = useMapsLibrary('places');
  const [sugerencias, setSugerencias] = useState<SugerenciaLugar[]>([]);
  const [activo, setActivo] = useState(0);
  const onNoDisponibleRef = useRef(onNoDisponible);
  const onElegirRef = useRef(onElegir);
  const onCerrarRef = useRef(onCerrar);
  const onActivaIdRef = useRef(onActivaId);
  const sugerenciasRef = useRef(sugerencias);
  const activoRef = useRef(activo);
  onNoDisponibleRef.current = onNoDisponible;
  onElegirRef.current = onElegir;
  onCerrarRef.current = onCerrar;
  onActivaIdRef.current = onActivaId;
  sugerenciasRef.current = sugerencias;
  activoRef.current = activo;

  function elegir(item: SugerenciaLugar) {
    if (!places) {
      return;
    }
    const ancla = document.createElement('div');
    void detallarLugar(places, item.placeId, ancla).then((lugar) => {
      if (!lugar) {
        logger.warn({ placeId: item.placeId }, 'no se pudo leer la sugerencia');
        onNoDisponibleRef.current();
        return;
      }
      onElegirRef.current(lugar);
      setSugerencias([]);
    });
  }
  const elegirRef = useRef(elegir);
  elegirRef.current = elegir;

  useEffect(() => {
    if (!places || !abierto || consulta.trim().length < 3) {
      setSugerencias([]);
      return;
    }
    let vigente = true;
    const timer = window.setTimeout(() => {
      void buscarSugerencias(places, consulta.trim()).then((lista) => {
        if (!vigente) {
          return;
        }
        if (lista === null) {
          onNoDisponibleRef.current();
          setSugerencias([]);
          return;
        }
        setSugerencias(lista);
        setActivo(0);
      });
    }, 280);
    return () => {
      vigente = false;
      window.clearTimeout(timer);
    };
  }, [places, consulta, abierto]);

  useEffect(() => {
    onActivaIdRef.current(abierto && sugerencias.length > 0 ? `${listaId}-opcion-${activo}` : null);
  }, [abierto, sugerencias.length, activo, listaId]);

  useEffect(() => {
    return () => onActivaIdRef.current(null);
  }, []);

  tecladoRef.current = (event) => {
    const lista = sugerenciasRef.current;
    if (lista.length === 0) {
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setSugerencias([]);
      onCerrarRef.current();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActivo((indice) => Math.min(lista.length - 1, indice + 1));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActivo((indice) => Math.max(0, indice - 1));
      return;
    }
    if (event.key !== 'Enter') {
      return;
    }
    const item = lista[activoRef.current];
    if (!item) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    elegirRef.current(item);
  };

  return (
    <ul
      id={listaId}
      // biome-ignore lint/a11y/useSemanticElements: listbox del combobox ARIA; un select no muestra Places
      // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: listbox del combobox ARIA; un select no muestra Places
      role="listbox"
      aria-label="Sugerencias de dirección"
      hidden={sugerencias.length === 0}
      tabIndex={-1}
      className="absolute z-50 mt-1 max-h-64 w-full overflow-auto rounded-md border border-neutral-200 bg-white py-1 shadow-lg"
    >
      {sugerencias.map((item, index) => (
        <li
          key={item.placeId}
          id={`${listaId}-opcion-${index}`}
          // biome-ignore lint/a11y/useSemanticElements: option del listbox ARIA; el teclado vive en el input
          // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: option del listbox ARIA; el teclado vive en el input
          role="option"
          aria-selected={index === activo}
          tabIndex={-1}
          className={`flex min-h-11 w-full cursor-pointer flex-col items-start px-3 py-2 text-left text-sm ${
            index === activo ? 'bg-primary-50' : 'hover:bg-neutral-50'
          }`}
          onMouseDown={(event) => event.preventDefault()}
          onMouseEnter={() => setActivo(index)}
          onClick={() => elegir(item)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              elegir(item);
            }
          }}
        >
          <span className="text-neutral-900">{item.principal}</span>
          {item.secundario && <span className="text-neutral-500 text-xs">{item.secundario}</span>}
        </li>
      ))}
    </ul>
  );
}

/**
 * Dirección de origen o destino: texto libre, sugerencias de Chile, comuna
 * editable y punto en el mapa. Sin key de Maps queda el texto, la región y
 * la comuna, y se puede pegar un link o coordenadas.
 */
export function SelectorLugar({
  etiquetaDireccion,
  placeholderDireccion,
  direccion,
  region,
  comunaCode,
  latitude,
  longitude,
  errorDireccion,
  errorRegion,
  nombreDireccion,
  nombreRegion,
  nombreComuna,
  mapasDisponibles,
  onDireccion,
  onRegion,
  onComuna,
  onCoordenadas,
  onLugar,
  resolverEnlace,
}: SelectorLugarProps) {
  const [aviso, setAviso] = useState<string | null>(null);
  const [placesCaido, setPlacesCaido] = useState(false);
  const [sugerenciasAbiertas, setSugerenciasAbiertas] = useState(false);
  const [revision, setRevision] = useState(0);
  const [textoPunto, setTextoPunto] = useState('');
  const [errorPunto, setErrorPunto] = useState<string | null>(null);
  // El mapa queda cerrado hasta que la persona lo pide o ya hay un punto.
  // Un mapa de Google en el tab order atrapa el foco (el E2E de teclado lo
  // marca) y con una key inválida igual inyecta el iframe.
  const [mapaAbierto, setMapaAbierto] = useState(latitude !== null && longitude !== null);
  const [opcionActivaId, setOpcionActivaId] = useState<string | null>(null);
  const listaId = useId();
  const tecladoRef = useRef<TecladoInput>(() => undefined);
  const reportarActiva = useCallback((id: string | null) => {
    setOpcionActivaId(id);
  }, []);

  useEffect(() => {
    if (latitude !== null && longitude !== null) {
      setMapaAbierto(true);
    }
  }, [latitude, longitude]);

  const comunas = region
    ? [...comunasDeRegion(region)].sort((a, b) => a.name.localeCompare(b.name, 'es'))
    : [];

  function marcarPunto(lat: number, lng: number, reemplazarDireccion: boolean) {
    onCoordenadas(lat, lng);
    if (reemplazarDireccion) {
      onDireccion(etiquetaPunto(lat, lng));
    }
    setRevision((valor) => valor + 1);
    setErrorPunto(null);
  }

  async function resolverTexto(texto: string, reemplazarDireccion: boolean) {
    const clasificado = clasificarTextoPunto(texto);
    if (clasificado.tipo === 'punto') {
      marcarPunto(clasificado.punto.latitude, clasificado.punto.longitude, reemplazarDireccion);
      return;
    }
    if (clasificado.tipo !== 'enlace') {
      setErrorPunto(
        tieneComaDecimal(texto)
          ? 'Usa un punto para los decimales, por ejemplo -33.45, -70.66.'
          : 'Pega un link de Google Maps o coordenadas (lat, lng).',
      );
      return;
    }
    setErrorPunto(null);
    setAviso('Leyendo el link…');
    const punto = await resolverEnlace(clasificado.url);
    if (!punto) {
      setAviso(null);
      setErrorPunto(
        'No pudimos leer un punto en ese link. Ábrelo, copia las coordenadas o el link completo.',
      );
      return;
    }
    setAviso(null);
    marcarPunto(punto.latitude, punto.longitude, reemplazarDireccion);
  }

  return (
    <div className="space-y-4 sm:col-span-2">
      <div className="relative">
        <FormField
          label={etiquetaDireccion}
          required
          error={errorDireccion}
          hint="Escribe y elige una sugerencia, o deja el texto si el lugar no tiene calle."
          render={({ id, describedBy }) => (
            <input
              id={id}
              name={nombreDireccion}
              role="combobox"
              aria-describedby={describedBy}
              aria-autocomplete="list"
              aria-expanded={opcionActivaId !== null}
              aria-controls={listaId}
              aria-activedescendant={opcionActivaId ?? undefined}
              type="text"
              autoComplete="off"
              value={direccion}
              placeholder={placeholderDireccion}
              maxLength={500}
              className={fieldInputClass(!!errorDireccion)}
              onKeyDown={(event) => tecladoRef.current(event)}
              onChange={(event) => {
                onDireccion(event.target.value);
                onCoordenadas(null, null);
                setSugerenciasAbiertas(true);
                setErrorPunto(null);
              }}
              onFocus={() => setSugerenciasAbiertas(true)}
              onBlur={() => {
                setSugerenciasAbiertas(false);
                const clasificado = clasificarTextoPunto(direccion);
                if (clasificado.tipo !== 'texto') {
                  void resolverTexto(direccion, true);
                }
              }}
            />
          )}
        />
        {mapasDisponibles && !placesCaido ? (
          <SugerenciasPlaces
            listaId={listaId}
            consulta={direccion}
            abierto={sugerenciasAbiertas}
            tecladoRef={tecladoRef}
            onActivaId={reportarActiva}
            onCerrar={() => setSugerenciasAbiertas(false)}
            onElegir={(lugar) => {
              setSugerenciasAbiertas(false);
              setAviso(null);
              onLugar(lugar);
            }}
            onNoDisponible={() => {
              setPlacesCaido(true);
              setOpcionActivaId(null);
              setAviso(
                'Las sugerencias no están disponibles. Escribe la dirección y elige región y comuna.',
              );
              logger.warn('places autocomplete degradado en el formulario de carga');
            }}
          />
        ) : (
          <ul
            id={listaId}
            // biome-ignore lint/a11y/useSemanticElements: ancla de aria-controls cuando Places no está
            // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: ancla de aria-controls cuando Places no está
            // biome-ignore lint/a11y/useFocusableInteractive: el listbox cerrado no entra en el tab order
            role="listbox"
            aria-label="Sugerencias de dirección"
            hidden
            tabIndex={-1}
          />
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField
          label="Región"
          required
          error={errorRegion}
          render={({ id, describedBy }) => (
            <select
              id={id}
              name={nombreRegion}
              aria-describedby={describedBy}
              value={region}
              className={fieldInputClass(!!errorRegion)}
              onChange={(event) => {
                const valor = event.target.value;
                const siguiente = esRegion(valor) ? valor : '';
                onRegion(siguiente);
                const actual = comunaPorCodigo(comunaCode);
                if (!siguiente || !actual || actual.region !== siguiente) {
                  onComuna('');
                }
              }}
            >
              <option value="">— Seleccionar —</option>
              {REGION_ORDEN.map((codigo) => (
                <option key={codigo} value={codigo}>
                  {REGION_ETIQUETA[codigo]}
                </option>
              ))}
            </select>
          )}
        />
        <FormField
          label="Comuna"
          hint={
            region
              ? 'Se completa al elegir una dirección. Puedes cambiarla.'
              : 'Primero elige la región.'
          }
          render={({ id, describedBy }) => (
            <select
              id={id}
              name={nombreComuna}
              aria-describedby={describedBy}
              value={comunaCode}
              disabled={!region}
              className={fieldInputClass(false)}
              onChange={(event) => onComuna(event.target.value)}
            >
              <option value="">— Seleccionar —</option>
              {comunas.map((comuna) => (
                <option key={comuna.code} value={comuna.code}>
                  {comuna.name}
                </option>
              ))}
            </select>
          )}
        />
      </div>

      <FormField
        label="Link de Google Maps o coordenadas"
        error={errorPunto ?? undefined}
        hint="Sirve para un lugar sin calle. Acepta maps.app.goo.gl, un link de Google Maps o -33.45, -70.66."
        render={({ id, describedBy }) => (
          <input
            id={id}
            aria-describedby={describedBy}
            type="text"
            inputMode="text"
            autoComplete="off"
            value={textoPunto}
            placeholder="https://maps.app.goo.gl/… o -33.45, -70.66"
            maxLength={500}
            className={fieldInputClass(!!errorPunto)}
            onChange={(event) => {
              setTextoPunto(event.target.value);
              setErrorPunto(null);
            }}
            onBlur={() => {
              if (textoPunto.trim()) {
                void resolverTexto(textoPunto, true);
              }
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && textoPunto.trim()) {
                event.preventDefault();
                void resolverTexto(textoPunto, true);
              }
            }}
          />
        )}
      />

      {aviso && <p className="text-neutral-600 text-xs">{aviso}</p>}

      {mapasDisponibles ? (
        <div>
          <button
            type="button"
            className="mb-2 flex min-h-11 items-center gap-1.5 font-medium text-neutral-700 text-sm"
            aria-expanded={mapaAbierto}
            onClick={() => setMapaAbierto((abierto) => !abierto)}
          >
            <MapPin className="h-4 w-4" aria-hidden />
            {mapaAbierto ? 'Ocultar mapa' : 'Elige el punto en el mapa'}
          </button>
          {mapaAbierto && (
            <MapaPinLugar
              latitude={latitude}
              longitude={longitude}
              revision={revision}
              onMover={(lat, lng) => marcarPunto(lat, lng, true)}
              onLugar={(lugar) => {
                setAviso(null);
                onLugar(lugar);
              }}
              onGeocodeFallo={() =>
                setAviso(
                  'No pudimos resolver la calle de ese punto. El pin queda guardado: escribe la dirección y elige la comuna.',
                )
              }
            />
          )}
        </div>
      ) : (
        <p className="rounded-md border border-neutral-300 border-dashed bg-neutral-50 px-3 py-2 text-neutral-600 text-xs">
          El mapa no está disponible en este entorno. Puedes escribir la dirección, elegir región y
          comuna, o pegar coordenadas.
        </p>
      )}
    </div>
  );
}
