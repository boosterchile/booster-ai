import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Loader2, Search } from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
import { api } from '../../lib/api-client.js';
import { ChileanPlate } from '../ChileanPlate.js';
import { RelativeTime } from '../RelativeTime.js';
import { FleetMap, type FleetMapVehicle } from '../map/FleetMap.js';

/**
 * Panel de plataforma: la flota de todas las empresas (`.specs/flota-plataforma`).
 * Mapa con la última posición, lista con búsqueda y filtro por empresa, y la
 * ficha del vehículo seleccionado. Solo lectura.
 */

type Estado = 'activo' | 'mantenimiento' | 'retirado';
type NivelCertificacion = 'primario_verificable' | 'secundario_modeled' | 'secundario_default';
type PresentacionCertificado = 'primario' | 'medido_teltonika' | 'estimado';

export interface VehiculoDeFlota {
  id: string;
  patente: string;
  empresa: { id: string; nombre: string };
  tipo: string;
  capacidad_kg: number | null;
  estado: Estado;
  teltonika_imei: string | null;
  fuente_combustible_can: string | null;
  posicion: {
    latitud: number;
    longitud: number;
    velocidad_kmh: number | null;
    registrada_en: string;
    fuente: 'teltonika' | 'espejo' | 'movil';
  } | null;
}

export interface FichaDeVehiculo {
  vehiculo: {
    id: string;
    patente: string;
    empresa: { id: string; nombre: string; rut: string | null };
    tipo: string;
    marca: string | null;
    modelo: string | null;
    anio: number | null;
    combustible: string | null;
    capacidad_kg: number | null;
    peso_vacio_kg: number | null;
    consumo_l_por_100km_base: number | null;
    capacidad_estanque_l: number | null;
    estado: Estado;
    teltonika_imei: string | null;
    teltonika_imei_espejo: string | null;
  };
  can: {
    fuente_configurada: string | null;
    ventana_dias: number;
    puntos: number;
    con_combustible_83: number;
    con_nivel_84: number;
    con_nivel_89: number;
    ultima_lectura_en: string | null;
    aviso: 'envia_83_sin_configurar' | 'configurado_83_sin_lecturas' | null;
  } | null;
  viajes: {
    entregados: number;
    en_curso: number;
    certificados: Record<NivelCertificacion | 'sin_certificado', number> & {
      por_presentacion: Record<PresentacionCertificado, number>;
    };
    ultimos: {
      codigo_seguimiento: string;
      estado: string;
      entregado_en: string | null;
      nivel_certificacion: NivelCertificacion | null;
      certificado_emitido: boolean;
      presentacion_certificado: PresentacionCertificado | null;
    }[];
  };
}

const TEXTO_ESTADO: Record<Estado, string> = {
  activo: 'Activo',
  mantenimiento: 'Mantenimiento',
  retirado: 'Retirado',
};
const CLASE_ESTADO: Record<Estado, string> = {
  activo: 'bg-success-50 text-success-700',
  mantenimiento: 'bg-amber-50 text-amber-700',
  retirado: 'bg-neutral-100 text-neutral-600',
};
const TEXTO_FUENTE_POSICION = {
  teltonika: 'Equipo Teltonika',
  espejo: 'Equipo Teltonika (espejo)',
  movil: 'Celular del conductor',
} as const;
const TEXTO_FUENTE_CAN: Record<string, string> = {
  '83': 'Combustible consumido (83)',
  '84': 'Nivel de estanque en litros (84)',
  '89': 'Nivel de estanque en % (89)',
  sin_sensor: 'Sin configurar',
};
/** ADR-091: quién midió la distancia del certificado. */
const TEXTO_PRESENTACION: Record<PresentacionCertificado, string> = {
  primario: 'combustible medido por CAN',
  medido_teltonika: 'distancia medida con Teltonika',
  estimado: 'estimado',
};
const TEXTO_ESTADO_VIAJE: Record<string, string> = {
  asignado: 'Asignado',
  recogido: 'En camino',
  entregado: 'Entregado',
  cancelado: 'Cancelado',
};
const TEXTO_AVISO_CAN = {
  envia_83_sin_configurar:
    'El equipo envía el combustible por CAN, pero no está configurado como fuente de la huella. Los certificados de este vehículo salen con consumo modelado.',
  configurado_83_sin_lecturas:
    'Está configurado el combustible por CAN, pero el equipo no lo envió en los últimos días.',
} as const;

const tipoLegible = (tipo: string) => {
  const t = tipo.replace(/_/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
};
const numero = (n: number) => n.toLocaleString('es-CL');
const fecha = (iso: string) =>
  new Date(iso).toLocaleDateString('es-CL', { timeZone: 'America/Santiago' });

export function FlotaPlataforma() {
  const [busqueda, setBusqueda] = useState('');
  const [empresaId, setEmpresaId] = useState('');
  const [seleccion, setSeleccion] = useState<string | null>(null);

  const flotaQ = useQuery({
    queryKey: ['platform-admin', 'flota'],
    queryFn: () =>
      api.get<{ vehiculos: VehiculoDeFlota[]; truncada?: boolean }>('/admin/plataforma/flota'),
    refetchInterval: 60_000,
  });
  const todos = flotaQ.data?.vehiculos ?? [];

  const empresas = useMemo(() => {
    const porId = new Map<string, string>();
    for (const v of flotaQ.data?.vehiculos ?? []) {
      porId.set(v.empresa.id, v.empresa.nombre);
    }
    return [...porId].sort((a, b) => a[1].localeCompare(b[1], 'es'));
  }, [flotaQ.data]);

  const texto = busqueda.trim().toLocaleLowerCase('es');
  const visibles = todos.filter(
    (v) =>
      (empresaId === '' || v.empresa.id === empresaId) &&
      (texto === '' ||
        v.patente.toLocaleLowerCase('es').includes(texto) ||
        v.empresa.nombre.toLocaleLowerCase('es').includes(texto)),
  );
  const enMapa: FleetMapVehicle[] = visibles.flatMap((v) =>
    v.posicion
      ? [
          {
            id: v.id,
            plate: v.patente,
            latitude: v.posicion.latitud,
            longitude: v.posicion.longitud,
            speedKmh: v.posicion.velocidad_kmh,
            hasTeltonika: v.teltonika_imei != null,
          },
        ]
      : [],
  );

  if (flotaQ.isLoading) {
    return (
      <p className="mt-6 flex items-center gap-2 text-neutral-600 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Cargando la flota…
      </p>
    );
  }
  if (flotaQ.isError) {
    return (
      <p role="alert" className="mt-6 rounded-md bg-danger-50 p-3 text-danger-700 text-sm">
        No se pudo cargar la flota. Recarga la página para intentarlo de nuevo.
      </p>
    );
  }

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-0 flex-1 text-sm sm:max-w-xs">
          <span className="mb-1 block font-medium text-neutral-700">Buscar</span>
          <span className="relative block">
            <Search
              className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 text-neutral-400"
              aria-hidden
            />
            <input
              type="search"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Patente o empresa"
              className="w-full rounded-md border border-neutral-300 py-2 pr-3 pl-8 text-sm"
            />
          </span>
        </label>
        <label className="min-w-0 text-sm">
          <span className="mb-1 block font-medium text-neutral-700">Empresa</span>
          <select
            value={empresaId}
            onChange={(e) => setEmpresaId(e.target.value)}
            className="w-full max-w-xs rounded-md border border-neutral-300 px-3 py-2 text-sm"
          >
            <option value="">Todas las empresas</option>
            {empresas.map(([id, nombre]) => (
              <option key={id} value={id}>
                {nombre}
              </option>
            ))}
          </select>
        </label>
        <p className="ml-auto text-neutral-600 text-sm" data-testid="flota-resumen">
          {numero(visibles.length)} {visibles.length === 1 ? 'vehículo' : 'vehículos'} ·{' '}
          {numero(enMapa.length)} con posición
        </p>
      </div>
      {flotaQ.data?.truncada ? (
        <p className="mt-2 text-amber-700 text-sm">
          La lista llegó a su tope y no muestra todos los vehículos. Filtra por empresa.
        </p>
      ) : null}

      <div className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <FleetMap
            vehicles={enMapa}
            selectedId={seleccion}
            onSelectVehicle={setSeleccion}
            height={480}
          />
          <ListaDeVehiculos
            vehiculos={visibles}
            seleccion={seleccion}
            onSeleccionar={setSeleccion}
          />
        </div>
        <aside
          aria-label="Ficha del vehículo"
          className="lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:self-start lg:overflow-y-auto"
        >
          {seleccion ? (
            <Ficha vehiculoId={seleccion} resumen={todos.find((v) => v.id === seleccion) ?? null} />
          ) : (
            <p className="rounded-lg border border-neutral-300 border-dashed p-6 text-center text-neutral-600 text-sm">
              Selecciona un vehículo en el mapa o en la lista para ver su ficha.
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}

function ListaDeVehiculos({
  vehiculos,
  seleccion,
  onSeleccionar,
}: {
  vehiculos: VehiculoDeFlota[];
  seleccion: string | null;
  onSeleccionar: (id: string) => void;
}) {
  if (vehiculos.length === 0) {
    return <p className="mt-4 text-neutral-600 text-sm">Ningún vehículo coincide con el filtro.</p>;
  }
  return (
    <div className="mt-4 overflow-x-auto rounded-lg border border-neutral-200 bg-white">
      <table className="w-full min-w-[560px] text-left text-sm">
        <thead className="bg-neutral-50 text-neutral-600 text-xs uppercase tracking-wider">
          <tr>
            <th className="px-3 py-2 font-medium">Patente</th>
            <th className="px-3 py-2 font-medium">Empresa</th>
            <th className="px-3 py-2 font-medium">Estado</th>
            <th className="px-3 py-2 font-medium">Última posición</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {vehiculos.map((v) => (
            <tr key={v.id} className={seleccion === v.id ? 'bg-primary-50' : 'hover:bg-neutral-50'}>
              <td className="px-3 py-2">
                <button
                  type="button"
                  onClick={() => onSeleccionar(v.id)}
                  aria-label={`Ver la ficha de ${v.patente}`}
                  aria-current={seleccion === v.id ? 'true' : undefined}
                  className="rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-600"
                >
                  <ChileanPlate plate={v.patente} size="sm" />
                </button>
              </td>
              <td className="px-3 py-2 text-neutral-800">{v.empresa.nombre}</td>
              <td className="px-3 py-2">
                <span
                  className={`rounded-md px-2 py-0.5 font-medium text-xs ${CLASE_ESTADO[v.estado]}`}
                >
                  {TEXTO_ESTADO[v.estado]}
                </span>
              </td>
              <td className="px-3 py-2">
                {v.posicion ? (
                  <RelativeTime date={v.posicion.registrada_en} />
                ) : (
                  <span className="text-neutral-500">Sin posición</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Dato({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-neutral-500 text-xs">{etiqueta}</dt>
      <dd className="text-neutral-900 text-sm">{children}</dd>
    </div>
  );
}

function Ficha({ vehiculoId, resumen }: { vehiculoId: string; resumen: VehiculoDeFlota | null }) {
  const fichaQ = useQuery({
    queryKey: ['platform-admin', 'flota', vehiculoId],
    queryFn: () => api.get<FichaDeVehiculo>(`/admin/plataforma/flota/${vehiculoId}`),
  });

  if (fichaQ.isLoading) {
    return (
      <p className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-white p-4 text-neutral-600 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Cargando la ficha…
      </p>
    );
  }
  if (fichaQ.isError || !fichaQ.data) {
    return (
      <p role="alert" className="rounded-md bg-danger-50 p-3 text-danger-700 text-sm">
        No se pudo cargar la ficha de este vehículo.
      </p>
    );
  }
  const { vehiculo: v, can, viajes } = fichaQ.data;
  const posicion = resumen?.posicion ?? null;
  const o = (valor: string | number | null, sufijo = '') =>
    valor == null ? '—' : `${typeof valor === 'number' ? numero(valor) : valor}${sufijo}`;

  return (
    <div
      className="space-y-5 rounded-lg border border-neutral-200 bg-white p-4 shadow-sm"
      data-testid="ficha-vehiculo"
    >
      <header>
        <div className="flex items-center justify-between gap-3">
          <ChileanPlate plate={v.patente} />
          <span className={`rounded-md px-2 py-0.5 font-medium text-xs ${CLASE_ESTADO[v.estado]}`}>
            {TEXTO_ESTADO[v.estado]}
          </span>
        </div>
        <p className="mt-2 font-semibold text-neutral-900">{v.empresa.nombre}</p>
        {v.empresa.rut ? <p className="text-neutral-600 text-sm">{v.empresa.rut}</p> : null}
      </header>

      <section aria-labelledby="ficha-vehiculo-titulo">
        <h2 id="ficha-vehiculo-titulo" className="font-semibold text-neutral-900 text-sm">
          Vehículo
        </h2>
        <dl className="mt-2 grid grid-cols-2 gap-3">
          <Dato etiqueta="Tipo">{tipoLegible(v.tipo)}</Dato>
          <Dato etiqueta="Marca y modelo">
            {[v.marca, v.modelo, v.anio].filter((x) => x != null).join(' ') || '—'}
          </Dato>
          <Dato etiqueta="Combustible">{v.combustible ? tipoLegible(v.combustible) : '—'}</Dato>
          <Dato etiqueta="Capacidad">{o(v.capacidad_kg, ' kg')}</Dato>
          <Dato etiqueta="Peso vacío">{o(v.peso_vacio_kg, ' kg')}</Dato>
          <Dato etiqueta="Consumo base">{o(v.consumo_l_por_100km_base, ' L/100 km')}</Dato>
        </dl>
      </section>

      <section aria-labelledby="ficha-posicion-titulo">
        <h2 id="ficha-posicion-titulo" className="font-semibold text-neutral-900 text-sm">
          Equipo y posición
        </h2>
        <dl className="mt-2 grid grid-cols-2 gap-3">
          <Dato etiqueta="IMEI Teltonika">
            <span className="font-mono text-xs">
              {v.teltonika_imei ?? v.teltonika_imei_espejo ?? 'Sin equipo'}
            </span>
          </Dato>
          <Dato etiqueta="Última posición">
            {posicion ? <RelativeTime date={posicion.registrada_en} /> : 'Sin posición'}
          </Dato>
          {posicion ? (
            <>
              <Dato etiqueta="Fuente">{TEXTO_FUENTE_POSICION[posicion.fuente]}</Dato>
              <Dato etiqueta="Velocidad">{o(posicion.velocidad_kmh, ' km/h')}</Dato>
            </>
          ) : null}
        </dl>
      </section>

      <section aria-labelledby="ficha-can-titulo">
        <h2 id="ficha-can-titulo" className="font-semibold text-neutral-900 text-sm">
          Lectura de CAN
        </h2>
        {can ? (
          <>
            {can.aviso ? (
              <p
                data-testid="aviso-can"
                className="mt-2 flex gap-2 rounded-md bg-amber-50 p-3 text-amber-800 text-sm"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>{TEXTO_AVISO_CAN[can.aviso]}</span>
              </p>
            ) : null}
            <dl className="mt-2 grid grid-cols-2 gap-3">
              <Dato etiqueta="Fuente de la huella">
                {TEXTO_FUENTE_CAN[can.fuente_configurada ?? 'sin_sensor'] ?? can.fuente_configurada}
              </Dato>
              <Dato etiqueta="Última lectura">
                {can.ultima_lectura_en ? <RelativeTime date={can.ultima_lectura_en} /> : '—'}
              </Dato>
            </dl>
            <p className="mt-3 text-neutral-500 text-xs">
              Lo que envió el equipo en los últimos {can.ventana_dias} días ({numero(can.puntos)}{' '}
              registros):
            </p>
            <dl className="mt-1 grid grid-cols-3 gap-3">
              <Dato etiqueta="Combustible (83)">{numero(can.con_combustible_83)}</Dato>
              <Dato etiqueta="Nivel en L (84)">{numero(can.con_nivel_84)}</Dato>
              <Dato etiqueta="Nivel en % (89)">{numero(can.con_nivel_89)}</Dato>
            </dl>
          </>
        ) : (
          <p className="mt-2 text-neutral-600 text-sm">
            Este vehículo no tiene un equipo Teltonika propio.
          </p>
        )}
      </section>

      <section aria-labelledby="ficha-viajes-titulo">
        <h2 id="ficha-viajes-titulo" className="font-semibold text-neutral-900 text-sm">
          Viajes y certificados
        </h2>
        <dl className="mt-2 grid grid-cols-2 gap-3">
          <Dato etiqueta="Viajes entregados">{numero(viajes.entregados)}</Dato>
          <Dato etiqueta="Viajes en curso">{numero(viajes.en_curso)}</Dato>
          <Dato etiqueta="Certificados con combustible medido por CAN">
            <span data-testid="cert-primario">
              {numero(viajes.certificados.por_presentacion.primario)}
            </span>
          </Dato>
          <Dato etiqueta="Certificados con distancia medida con Teltonika">
            <span data-testid="cert-medido-teltonika">
              {numero(viajes.certificados.por_presentacion.medido_teltonika)}
            </span>
          </Dato>
          <Dato etiqueta="Certificados estimados">
            <span data-testid="cert-estimado">
              {numero(viajes.certificados.por_presentacion.estimado)}
            </span>
          </Dato>
          <Dato etiqueta="Entregados sin certificado">
            {numero(viajes.certificados.sin_certificado)}
          </Dato>
        </dl>
        {viajes.ultimos.length > 0 ? (
          <ul className="mt-3 divide-y divide-neutral-100 border-neutral-100 border-t">
            {viajes.ultimos.map((u) => (
              <li key={u.codigo_seguimiento} className="py-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-neutral-900 text-xs">{u.codigo_seguimiento}</span>
                  <span className="text-neutral-600 text-xs">
                    {TEXTO_ESTADO_VIAJE[u.estado] ?? tipoLegible(u.estado)}
                    {u.entregado_en ? ` · ${fecha(u.entregado_en)}` : ''}
                  </span>
                </div>
                {u.estado === 'entregado' ? (
                  <p className="text-neutral-600 text-xs">
                    {u.presentacion_certificado
                      ? `Certificado: ${TEXTO_PRESENTACION[u.presentacion_certificado]}`
                      : 'Sin certificado emitido'}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-neutral-600 text-sm">Este vehículo todavía no tiene viajes.</p>
        )}
      </section>
    </div>
  );
}
