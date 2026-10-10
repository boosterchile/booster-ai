import { calcularLiquidacionV3, resolverComisionPct } from '@booster-ai/pricing-engine';
import {
  type ConfiguracionComercial,
  configuracionComercialSchema,
} from '@booster-ai/shared-schemas';
import { History, Loader2, Save } from 'lucide-react';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { ProtectedRoute } from '../components/ProtectedRoute.js';
import { PlatformAdminFrame } from '../components/admin/PlatformAdminFrame.js';
import { ApiError, api } from '../lib/api-client.js';

/**
 * ADR-079 §3 — Configuración comercial. El platform-admin cambia tasas de
 * comisión por modalidad de carga, precios de servicios en UF,
 * financiamiento e IVA. Cada publicación es una versión nueva con nota y
 * autor; rige para cargas publicadas después (≤ 60 s), nunca para las ya
 * publicadas (tasa congelada). La autorización la valida el backend
 * (allowlist BOOSTER_PLATFORM_ADMIN_EMAILS).
 */
export function PlatformAdminConfiguracionComercialRoute() {
  return (
    <ProtectedRoute meRequirement="skip">
      {() => (
        <PlatformAdminFrame volver={{ to: '/app/platform-admin', label: 'Volver' }}>
          <Pagina />
        </PlatformAdminFrame>
      )}
    </ProtectedRoute>
  );
}

interface VersionDto {
  id: string;
  version: number;
  config: ConfiguracionComercial;
  vigenteDesde: string;
  notaCambio: string;
  creadoPorEmail: string;
  creadoEn: string;
}

interface RespuestaAdmin {
  publicada: VersionDto;
  historial: VersionDto[];
}

/** Campos editables: ruta en el JSON, etiqueta y si admite vacío. */
const CAMPOS = [
  { ruta: 'comisiones.spot_pct', etiqueta: 'Comisión carga spot (%)' },
  { ruta: 'comisiones.programada_pct', etiqueta: 'Comisión carga programada (%)' },
  {
    ruta: 'comisiones.retorno_programada_pct',
    etiqueta: 'Comisión retorno programado (%)',
    opcional: true,
  },
  {
    ruta: 'servicios.suscripcion_transportista_uf_camion_mes',
    etiqueta: 'Transportista: UF por camión al mes',
  },
  {
    ruta: 'servicios.suscripcion_transportista_gestion_flota_uf_camion_mes',
    etiqueta: 'Transportista con gestión de flota: UF por camión al mes',
  },
  {
    ruta: 'servicios.suscripcion_generador_uf_empresa_mes',
    etiqueta: 'Generador: UF por empresa al mes',
  },
  {
    ruta: 'servicios.camiones_sin_cobro_por_transportista',
    etiqueta: 'Camiones sin cobro por transportista',
  },
  {
    ruta: 'servicios.huella_carbono.precio_referencia_uf',
    etiqueta: 'Huella de carbono: precio de referencia (UF)',
    opcional: true,
  },
  { ruta: 'financiamiento.originacion_pct', etiqueta: 'Originación (%)' },
  { ruta: 'financiamiento.anticipo_documento_pct', etiqueta: 'Anticipo sobre documento (%)' },
  {
    ruta: 'financiamiento.plazo_pago_generador_dias',
    etiqueta: 'Plazo de pago del generador (días)',
  },
  {
    ruta: 'financiamiento.plazo_liberacion_transportista_dias',
    etiqueta: 'Liberación al transportista (días)',
  },
  { ruta: 'impuestos.iva_pct', etiqueta: 'IVA (%)' },
] as const;

type Ruta = (typeof CAMPOS)[number]['ruta'];
type Formulario = Record<Ruta, string>;

function leerRuta(config: ConfiguracionComercial, ruta: Ruta): number | undefined {
  let nodo: unknown = config;
  for (const parte of ruta.split('.')) {
    nodo =
      typeof nodo === 'object' && nodo !== null
        ? (nodo as Record<string, unknown>)[parte]
        : undefined;
  }
  return typeof nodo === 'number' ? nodo : undefined;
}

function aFormulario(config: ConfiguracionComercial): Formulario {
  const f = {} as Formulario;
  for (const campo of CAMPOS) {
    const v = leerRuta(config, campo.ruta);
    f[campo.ruta] = v === undefined ? '' : String(v);
  }
  return f;
}

/** Reconstruye el JSON desde el formulario; el schema decide si es válido. */
function aConfig(f: Formulario): unknown {
  const num = (r: Ruta) => (f[r].trim() === '' ? Number.NaN : Number(f[r]));
  const opt = (r: Ruta) => (f[r].trim() === '' ? undefined : Number(f[r]));
  const retorno = opt('comisiones.retorno_programada_pct');
  const referencia = opt('servicios.huella_carbono.precio_referencia_uf');
  return {
    comisiones: {
      spot_pct: num('comisiones.spot_pct'),
      programada_pct: num('comisiones.programada_pct'),
      ...(retorno === undefined ? {} : { retorno_programada_pct: retorno }),
    },
    servicios: {
      suscripcion_transportista_uf_camion_mes: num(
        'servicios.suscripcion_transportista_uf_camion_mes',
      ),
      suscripcion_transportista_gestion_flota_uf_camion_mes: num(
        'servicios.suscripcion_transportista_gestion_flota_uf_camion_mes',
      ),
      suscripcion_generador_uf_empresa_mes: num('servicios.suscripcion_generador_uf_empresa_mes'),
      camiones_sin_cobro_por_transportista: num('servicios.camiones_sin_cobro_por_transportista'),
      huella_carbono: {
        modalidad: 'por_proyecto',
        ...(referencia === undefined ? {} : { precio_referencia_uf: referencia }),
      },
    },
    financiamiento: {
      originacion_pct: num('financiamiento.originacion_pct'),
      anticipo_documento_pct: num('financiamiento.anticipo_documento_pct'),
      plazo_pago_generador_dias: num('financiamiento.plazo_pago_generador_dias'),
      plazo_liberacion_transportista_dias: num(
        'financiamiento.plazo_liberacion_transportista_dias',
      ),
    },
    impuestos: { iva_pct: num('impuestos.iva_pct') },
  };
}

const clp = (n: number) => `$${n.toLocaleString('es-CL')}`;
const PRECIO_EJEMPLO_CLP = 700_000;

function Pagina() {
  const [cargando, setCargando] = useState(true);
  const [prohibido, setProhibido] = useState(false);
  const [errorCarga, setErrorCarga] = useState(false);
  const [datos, setDatos] = useState<RespuestaAdmin | null>(null);
  const [formulario, setFormulario] = useState<Formulario | null>(null);
  const [nota, setNota] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setErrorCarga(false);
    try {
      const r = await api.get<RespuestaAdmin>('/admin/configuracion-comercial');
      setDatos(r);
      setFormulario(aFormulario(r.publicada.config));
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setProhibido(true);
      } else {
        setErrorCarga(true);
      }
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (cargando && !datos) {
    return <Loader2 className="mt-8 h-6 w-6 animate-spin text-neutral-500" aria-label="Cargando" />;
  }
  if (prohibido) {
    return (
      <p className="mt-8 text-neutral-700">
        Solo el equipo de plataforma puede ver y cambiar la configuración comercial.
      </p>
    );
  }
  if (errorCarga || !datos || !formulario) {
    return (
      <p role="alert" className="mt-8 text-danger-700">
        No se pudo cargar la configuración comercial. Intenta de nuevo.
      </p>
    );
  }

  const validacion = configuracionComercialSchema.safeParse(aConfig(formulario));
  const errores = validacion.success ? [] : validacion.error.issues.map((i) => i.message);
  const puedePublicar = validacion.success && nota.trim().length > 0 && !enviando;

  const ejemplos = validacion.success
    ? (
        [
          { id: 'spot', titulo: 'Carga spot', modalidad: 'spot', esRetorno: false },
          {
            id: 'programada',
            titulo: 'Carga programada',
            modalidad: 'programada',
            esRetorno: false,
          },
          { id: 'retorno', titulo: 'Retorno programado', modalidad: 'programada', esRetorno: true },
        ] as const
      ).map((e) => {
        const c = validacion.data;
        const liquidacion = calcularLiquidacionV3({
          precioTransportistaClp: PRECIO_EJEMPLO_CLP,
          comisionPct: resolverComisionPct({
            modalidad: e.modalidad,
            esRetorno: e.esRetorno,
            comisiones: {
              spotPct: c.comisiones.spot_pct,
              programadaPct: c.comisiones.programada_pct,
              retornoProgramadaPct: c.comisiones.retorno_programada_pct,
            },
          }),
          ivaRate: c.impuestos.iva_pct / 100,
        });
        return { ...e, liquidacion };
      })
    : [];

  async function publicar(ev: FormEvent) {
    ev.preventDefault();
    if (!validacion.success) {
      return;
    }
    setEnviando(true);
    setErrorEnvio(null);
    setMensaje(null);
    try {
      const r = await api.put<{ ok: true; publicada: VersionDto }>(
        '/admin/configuracion-comercial',
        { config: validacion.data, nota_cambio: nota.trim() },
      );
      setMensaje(`Versión ${r.publicada.version} publicada. Rige para cargas nuevas en un minuto.`);
      setNota('');
      await cargar();
    } catch {
      setErrorEnvio('No se pudo publicar la configuración. Revisa los valores e intenta de nuevo.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div>
      <h1 className="font-bold text-3xl text-neutral-900 tracking-tight">
        Configuración comercial
      </h1>
      <p className="mt-2 max-w-2xl text-neutral-600 text-sm">
        Versión vigente: {datos.publicada.version} · desde{' '}
        {new Date(datos.publicada.vigenteDesde).toLocaleString('es-CL')}. Los cambios rigen para
        cargas que se publiquen después; una carga ya publicada conserva su comisión.
      </p>

      <form onSubmit={publicar} className="mt-6 grid gap-6 lg:grid-cols-2">
        <fieldset className="space-y-3 rounded-lg border border-neutral-200 bg-white p-4">
          <legend className="px-1 font-semibold text-neutral-900">Valores</legend>
          {CAMPOS.map((campo) => (
            <label key={campo.ruta} className="block text-neutral-700 text-sm">
              {campo.etiqueta}
              <input
                type="number"
                step="any"
                inputMode="decimal"
                value={formulario[campo.ruta]}
                onChange={(e) => setFormulario({ ...formulario, [campo.ruta]: e.target.value })}
                className="mt-1 block w-full rounded-md border border-neutral-300 px-3 py-2"
              />
            </label>
          ))}
        </fieldset>

        <div className="space-y-4">
          <section className="rounded-lg border border-neutral-200 bg-white p-4">
            <h2 className="font-semibold text-neutral-900">
              Ejemplo: viaje de {clp(PRECIO_EJEMPLO_CLP)} al transportista
            </h2>
            {ejemplos.length === 0 ? (
              <p className="mt-2 text-neutral-500 text-sm">
                Corrige los valores para ver el ejemplo.
              </p>
            ) : (
              <ul className="mt-2 space-y-2 text-sm">
                {ejemplos.map((e) => (
                  <li key={e.id} data-testid={`ejemplo-${e.id}`}>
                    <span className="font-medium">{e.titulo}</span>: comisión{' '}
                    {e.liquidacion.comisionPct} % = {clp(e.liquidacion.comisionClp)} + IVA{' '}
                    {clp(e.liquidacion.ivaComisionClp)} · el generador paga{' '}
                    {clp(e.liquidacion.precioGeneradorClp)} más IVA de la comisión
                  </li>
                ))}
              </ul>
            )}
          </section>

          {errores.length > 0 && (
            <ul className="rounded-md bg-danger-50 p-3 text-danger-800 text-sm">
              {errores.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}

          <label className="block text-neutral-700 text-sm">
            Nota del cambio
            <textarea
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              maxLength={500}
              rows={3}
              className="mt-1 block w-full rounded-md border border-neutral-300 px-3 py-2"
            />
          </label>

          <button
            type="submit"
            disabled={!puedePublicar}
            className="inline-flex items-center gap-2 rounded-md bg-primary-600 px-4 py-2 font-medium text-sm text-white disabled:opacity-50"
          >
            <Save className="h-4 w-4" aria-hidden />
            Publicar versión nueva
          </button>
          {mensaje && <p className="text-sm text-success-700">{mensaje}</p>}
          {errorEnvio && (
            <p role="alert" className="text-danger-700 text-sm">
              {errorEnvio}
            </p>
          )}
        </div>
      </form>

      <BanderaPorEmpresa
        titulo="Contrato programado"
        descripcion="Solo los generadores habilitados pueden publicar carga programada, que paga la tasa menor."
        ruta="/admin/configuracion-comercial/contrato-programado"
        claveLista="generadores"
        claveFila="generador"
        nombre="contrato programado"
        vacio="No hay empresas generadoras."
      />

      <BanderaPorEmpresa
        titulo="Gestión de flota"
        descripcion="Los transportistas habilitados pagan la suscripción con la tarifa por camión de gestión de flota."
        ruta="/admin/configuracion-comercial/gestion-flota"
        claveLista="transportistas"
        claveFila="transportista"
        nombre="gestión de flota"
        vacio="No hay empresas transportistas."
      />

      <section className="mt-8">
        <h2 className="flex items-center gap-2 font-semibold text-neutral-900">
          <History className="h-4 w-4" aria-hidden /> Historial
        </h2>
        <table className="mt-2 w-full text-left text-sm">
          <thead className="text-neutral-500">
            <tr>
              <th className="py-1">Versión</th>
              <th>Fecha</th>
              <th>Autor</th>
              <th>Spot / programada</th>
              <th>Nota</th>
            </tr>
          </thead>
          <tbody>
            {datos.historial.map((v) => (
              <tr key={v.id} className="border-neutral-100 border-t">
                <td className="py-1">{v.version}</td>
                <td>{new Date(v.creadoEn).toLocaleString('es-CL')}</td>
                <td>{v.creadoPorEmail}</td>
                <td>
                  {v.config.comisiones.spot_pct} % / {v.config.comisiones.programada_pct} %
                </td>
                <td>{v.notaCambio}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

interface EmpresaBanderaDto {
  empresaId: string;
  razonSocial: string;
  rut: string;
  activadoEn: string | null;
  activadoPor: string | null;
}

/**
 * Bandera comercial por empresa, decidida a mano por el platform-admin:
 * queda registrado quién y cuándo. La usan el contrato programado (ADR-079
 * §2, generadores) y la gestión de flota (§4, transportistas).
 */
function BanderaPorEmpresa(props: {
  titulo: string;
  descripcion: string;
  ruta: string;
  claveLista: 'generadores' | 'transportistas';
  claveFila: 'generador' | 'transportista';
  /** Sustantivo en minúscula para etiquetas y errores ("contrato programado"). */
  nombre: string;
  vacio: string;
}) {
  const { ruta, claveLista, claveFila, nombre } = props;
  const [empresas, setEmpresas] = useState<EmpresaBanderaDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cambiando, setCambiando] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      const r = await api.get<Record<string, EmpresaBanderaDto[]>>(ruta);
      setEmpresas(r[claveLista] ?? []);
    } catch {
      setError(`No se pudo cargar la lista de ${claveLista}.`);
    }
  }, [ruta, claveLista]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function cambiar(e: EmpresaBanderaDto) {
    setCambiando(e.empresaId);
    setError(null);
    try {
      const r = await api.put<Record<string, EmpresaBanderaDto>>(`${ruta}/${e.empresaId}`, {
        activo: e.activadoEn === null,
      });
      const actualizada = r[claveFila];
      if (actualizada) {
        setEmpresas((lista) =>
          (lista ?? []).map((x) => (x.empresaId === actualizada.empresaId ? actualizada : x)),
        );
      }
    } catch {
      setError(`No se pudo cambiar el ${nombre}. Intenta de nuevo.`);
    } finally {
      setCambiando(null);
    }
  }

  return (
    <section className="mt-8">
      <h2 className="font-semibold text-neutral-900">{props.titulo}</h2>
      <p className="mt-1 max-w-2xl text-neutral-600 text-sm">{props.descripcion}</p>
      {error && <p className="mt-2 text-danger-700 text-sm">{error}</p>}
      {empresas === null ? null : empresas.length === 0 ? (
        <p className="mt-2 text-neutral-500 text-sm">{props.vacio}</p>
      ) : (
        <ul className="mt-3 divide-y divide-neutral-100 rounded-lg border border-neutral-200 bg-white">
          {empresas.map((e) => (
            <li
              key={e.empresaId}
              className="flex items-center justify-between gap-3 px-4 py-2 text-sm"
            >
              <div>
                <div className="font-medium text-neutral-900">{e.razonSocial}</div>
                <div className="text-neutral-500 text-xs">
                  {e.rut}
                  {e.activadoEn &&
                    ` · Habilitado por ${e.activadoPor ?? '—'} el ${new Date(e.activadoEn).toLocaleDateString('es-CL')}`}
                </div>
              </div>
              <button
                type="button"
                disabled={cambiando === e.empresaId}
                onClick={() => void cambiar(e)}
                aria-label={`${e.activadoEn ? 'Deshabilitar' : 'Habilitar'} ${nombre} de ${e.razonSocial}`}
                className="rounded-md border border-neutral-300 px-3 py-1 text-neutral-800 disabled:opacity-50"
              >
                {e.activadoEn ? 'Deshabilitar' : 'Habilitar'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
