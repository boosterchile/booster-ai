import {
  type CrearViajePropioBody,
  crearViajePropioBodySchema,
  ensureRutHasDash,
  rutSchema,
} from '@booster-ai/shared-schemas';
import { Button } from '@booster-ai/ui-components';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { APIProvider } from '@vis.gl/react-google-maps';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { FormField, inputClass as fieldInputClass } from '../components/FormField.js';
import { Layout } from '../components/Layout.js';
import { ProtectedRoute } from '../components/ProtectedRoute.js';
import { type LugarDetallado, SelectorLugar } from '../components/lugar/SelectorLugar.js';
import type { MeResponse } from '../hooks/use-me.js';
import { useScrollToFirstError } from '../hooks/use-scroll-to-first-error.js';
import { ApiError, api } from '../lib/api-client.js';
import { flagsDe } from '../lib/capacidades.js';
import { useEmpresaScope } from '../lib/empresa-activa.js';
import { env } from '../lib/env.js';
import { CARGO_TYPE_LABELS, type CargoType, type RegionCode } from '../lib/etiquetas-carga.js';
import { logger } from '../lib/logger.js';

type MeOnboarded = Extract<MeResponse, { needs_onboarding: false }>;

type ClienteTipo = 'generador' | 'externo';

export interface ViajePropioFormValues {
  origin_address_raw: string;
  origin_region_code: RegionCode | '';
  origin_comuna_code: string;
  destination_address_raw: string;
  destination_region_code: RegionCode | '';
  destination_comuna_code: string;
  cargo_type: CargoType;
  cargo_weight_kg: string;
  cargo_volume_m3: string;
  pickup_date_raw: string;
  cliente_tipo: ClienteTipo;
  generador_empresa_id: string;
  externo_nombre: string;
  externo_rut: string;
  externo_contacto: string;
  externo_correo: string;
}

export const VALORES_INICIALES: ViajePropioFormValues = {
  origin_address_raw: '',
  origin_region_code: '',
  origin_comuna_code: '',
  destination_address_raw: '',
  destination_region_code: '',
  destination_comuna_code: '',
  cargo_type: 'carga_seca',
  cargo_weight_kg: '',
  cargo_volume_m3: '',
  pickup_date_raw: '',
  cliente_tipo: 'externo',
  generador_empresa_id: '',
  externo_nombre: '',
  externo_rut: '',
  externo_contacto: '',
  externo_correo: '',
};

const RUTA_ISSUE_A_CAMPO: Record<string, keyof ViajePropioFormValues> = {
  'origen.address_raw': 'origin_address_raw',
  'origen.region_code': 'origin_region_code',
  'origen.comuna_code': 'origin_comuna_code',
  'destino.address_raw': 'destination_address_raw',
  'destino.region_code': 'destination_region_code',
  'destino.comuna_code': 'destination_comuna_code',
  cargo_type: 'cargo_type',
  cargo_weight_kg: 'cargo_weight_kg',
  cargo_volume_m3: 'cargo_volume_m3',
  pickup_date_raw: 'pickup_date_raw',
  'cliente.empresa_id': 'generador_empresa_id',
  'cliente.nombre': 'externo_nombre',
  'cliente.rut': 'externo_rut',
  'cliente.contacto': 'externo_contacto',
  'cliente.correo': 'externo_correo',
};

function mensajeApi(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'capability_denied') {
      return 'Tu rol no puede dar de alta viajes propios.';
    }
    if (err.code === 'generador_not_found') {
      return 'No encontramos esa empresa generadora en Booster.';
    }
    if (err.code === 'validation_error') {
      return 'Revisa los datos del formulario e intenta de nuevo.';
    }
    return err.message;
  }
  return 'No pudimos crear el viaje. Intenta de nuevo en unos segundos.';
}

export function formToBody(values: ViajePropioFormValues): CrearViajePropioBody {
  const peso = values.cargo_weight_kg.trim();
  const volumen = values.cargo_volume_m3.trim();
  const origen: CrearViajePropioBody['origen'] = {
    address_raw: values.origin_address_raw.trim(),
    region_code: values.origin_region_code,
  };
  if (values.origin_comuna_code.trim()) {
    origen.comuna_code = values.origin_comuna_code.trim();
  }
  const destino: CrearViajePropioBody['destino'] = {
    address_raw: values.destination_address_raw.trim(),
    region_code: values.destination_region_code,
  };
  if (values.destination_comuna_code.trim()) {
    destino.comuna_code = values.destination_comuna_code.trim();
  }

  const cliente: CrearViajePropioBody['cliente'] =
    values.cliente_tipo === 'generador'
      ? { tipo: 'generador', empresa_id: values.generador_empresa_id.trim() }
      : {
          tipo: 'externo',
          nombre: values.externo_nombre.trim(),
          ...(values.externo_rut.trim()
            ? { rut: ensureRutHasDash(values.externo_rut.replace(/\./g, '').trim()) }
            : {}),
          ...(values.externo_contacto.trim() ? { contacto: values.externo_contacto.trim() } : {}),
          ...(values.externo_correo.trim() ? { correo: values.externo_correo.trim() } : {}),
        };

  const body: CrearViajePropioBody = {
    origen,
    destino,
    cargo_type: values.cargo_type,
    pickup_date_raw: values.pickup_date_raw.trim(),
    cliente,
  };
  if (peso !== '') {
    body.cargo_weight_kg = Number.parseInt(peso, 10);
  }
  if (volumen !== '') {
    body.cargo_volume_m3 = Number.parseInt(volumen, 10);
  }
  return body;
}

export function ViajePropioNuevoRoute() {
  return (
    <ProtectedRoute meRequirement="require-onboarded">
      {(ctx) => {
        if (ctx.kind !== 'onboarded') {
          return null;
        }
        const empresa = ctx.me.active_membership?.empresa;
        const esTransportista = empresa?.is_transportista ?? false;
        const puedeCrear = flagsDe(ctx.me).asignar;
        if (!esTransportista || !puedeCrear) {
          return (
            <Layout me={ctx.me} title="Nuevo viaje propio">
              <SinPermisoViajePropio esTransportista={esTransportista} />
            </Layout>
          );
        }
        return <ViajePropioNuevoPage me={ctx.me} />;
      }}
    </ProtectedRoute>
  );
}

function SinPermisoViajePropio({ esTransportista }: { esTransportista: boolean }) {
  return (
    <div className="mx-auto max-w-lg">
      <h1 className="font-bold text-2xl text-neutral-900 tracking-tight">Nuevo viaje propio</h1>
      <output className="mt-6 block rounded-md border border-warning-500/30 bg-warning-50 p-4 text-sm text-warning-800">
        {esTransportista
          ? 'Tu rol no puede dar de alta viajes propios. Pide a un dueño o despachador de tu empresa.'
          : 'Solo empresas que operan como transportista pueden crear viajes propios.'}
      </output>
      <p className="mt-4">
        <Link to="/app/rutas" className="text-primary-700 text-sm underline hover:text-primary-900">
          Volver a rutas
        </Link>
      </p>
    </div>
  );
}

function ViajePropioNuevoPage({ me }: { me: MeOnboarded }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const scope = useEmpresaScope();
  const [errorGlobal, setErrorGlobal] = useState<string | null>(null);

  const crearM = useMutation({
    mutationFn: async (body: CrearViajePropioBody) => {
      return await api.post<{ ruta_id: string; trip: { tracking_code: string } }>(
        '/viajes-propios',
        body,
        scope.init,
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: scope.key('rutas') });
      void navigate({ to: '/app/rutas' });
    },
    onError: (err: unknown) => setErrorGlobal(mensajeApi(err)),
  });

  return (
    <Layout me={me} title="Nuevo viaje propio">
      <div className="mb-6 flex items-center gap-3">
        <Link
          to="/app/rutas"
          className="text-neutral-500 hover:text-neutral-900"
          aria-label="Volver a rutas"
        >
          <ArrowLeft className="h-5 w-5" aria-hidden />
        </Link>
        <h1 className="font-bold text-3xl text-neutral-900 tracking-tight">Nuevo viaje propio</h1>
      </div>
      <p className="mb-6 max-w-2xl text-neutral-600 text-sm">
        Registra un servicio fuera del marketplace (cliente externo o generador ya en Booster). El
        viaje queda asignado a tu empresa y aparece en tus rutas para armar paradas.
      </p>
      <ViajePropioForm
        onSubmit={(values) => {
          setErrorGlobal(null);
          crearM.mutate(values);
        }}
        submitting={crearM.isPending}
        errorGlobal={errorGlobal}
      />
    </Layout>
  );
}

function ViajePropioForm({
  onSubmit,
  submitting,
  errorGlobal,
}: {
  onSubmit: (body: CrearViajePropioBody) => void;
  submitting: boolean;
  errorGlobal: string | null;
}) {
  const {
    register,
    handleSubmit,
    setError,
    clearErrors,
    watch,
    setValue,
    formState: { errors, submitCount },
  } = useForm<ViajePropioFormValues>({
    mode: 'onSubmit',
    defaultValues: VALORES_INICIALES,
  });

  useScrollToFirstError(errors, submitCount);
  const [mapasCaidos, setMapasCaidos] = useState(false);
  const mapasDisponibles = Boolean(env.VITE_GOOGLE_MAPS_API_KEY) && !mapasCaidos;
  const valores = watch();
  const clienteTipo = valores.cliente_tipo;

  function aplicarOrigen(lugar: LugarDetallado) {
    setValue('origin_address_raw', lugar.direccion, { shouldDirty: true });
    if (lugar.region) {
      setValue('origin_region_code', lugar.region, { shouldDirty: true });
    }
    if (lugar.comunaCode) {
      setValue('origin_comuna_code', lugar.comunaCode, { shouldDirty: true });
    }
  }

  function aplicarDestino(lugar: LugarDetallado) {
    setValue('destination_address_raw', lugar.direccion, { shouldDirty: true });
    if (lugar.region) {
      setValue('destination_region_code', lugar.region, { shouldDirty: true });
    }
    if (lugar.comunaCode) {
      setValue('destination_comuna_code', lugar.comunaCode, { shouldDirty: true });
    }
  }

  async function resolverEnlace(texto: string) {
    try {
      return await api.post<{ latitude: number; longitude: number }>(
        '/trip-requests-v2/resolver-enlace',
        { texto },
      );
    } catch (err) {
      logger.warn({ err }, 'no se pudo resolver el link de mapa');
      return null;
    }
  }

  function validarYEnviar(values: ViajePropioFormValues) {
    clearErrors();
    if (values.cliente_tipo === 'externo' && values.externo_rut.trim()) {
      const rutNorm = ensureRutHasDash(values.externo_rut.replace(/\./g, '').trim());
      if (!rutSchema.safeParse(rutNorm).success) {
        setError('externo_rut', { message: 'RUT no válido' });
        return;
      }
    }
    const body = formToBody(values);
    const parsed = crearViajePropioBodySchema.safeParse(body);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const path = issue.path.join('.');
        const campo = RUTA_ISSUE_A_CAMPO[path];
        if (campo) {
          setError(campo, { message: issue.message });
        }
      }
      return;
    }
    onSubmit(parsed.data);
  }

  const formulario = (
    <form
      onSubmit={handleSubmit(validarYEnviar)}
      className="mx-auto max-w-3xl space-y-8"
      noValidate
    >
      {errorGlobal && (
        <div
          role="alert"
          className="rounded-md border border-danger-500/30 bg-danger-50 p-4 text-danger-800 text-sm"
        >
          {errorGlobal}
        </div>
      )}

      <section>
        <h2 className="font-semibold text-lg text-neutral-900">Origen</h2>
        <div className="mt-3">
          <SelectorLugar
            etiquetaDireccion="Dirección de recogida"
            placeholderDireccion="Av. Apoquindo 3000, Las Condes"
            direccion={valores.origin_address_raw}
            region={valores.origin_region_code}
            comunaCode={valores.origin_comuna_code}
            latitude={null}
            longitude={null}
            errorDireccion={errors.origin_address_raw?.message}
            errorRegion={errors.origin_region_code?.message}
            nombreDireccion="origin_address_raw"
            nombreRegion="origin_region_code"
            nombreComuna="origin_comuna_code"
            mapasDisponibles={mapasDisponibles}
            onDireccion={(value) => setValue('origin_address_raw', value, { shouldDirty: true })}
            onRegion={(value) => setValue('origin_region_code', value, { shouldDirty: true })}
            onComuna={(code) => setValue('origin_comuna_code', code, { shouldDirty: true })}
            onCoordenadas={() => undefined}
            onLugar={aplicarOrigen}
            resolverEnlace={resolverEnlace}
          />
        </div>
      </section>

      <section>
        <h2 className="font-semibold text-lg text-neutral-900">Destino</h2>
        <div className="mt-3">
          <SelectorLugar
            etiquetaDireccion="Dirección de entrega"
            placeholderDireccion="Puerto San Antonio"
            direccion={valores.destination_address_raw}
            region={valores.destination_region_code}
            comunaCode={valores.destination_comuna_code}
            latitude={null}
            longitude={null}
            errorDireccion={errors.destination_address_raw?.message}
            errorRegion={errors.destination_region_code?.message}
            nombreDireccion="destination_address_raw"
            nombreRegion="destination_region_code"
            nombreComuna="destination_comuna_code"
            mapasDisponibles={mapasDisponibles}
            onDireccion={(value) =>
              setValue('destination_address_raw', value, { shouldDirty: true })
            }
            onRegion={(value) => setValue('destination_region_code', value, { shouldDirty: true })}
            onComuna={(code) => setValue('destination_comuna_code', code, { shouldDirty: true })}
            onCoordenadas={() => undefined}
            onLugar={aplicarDestino}
            resolverEnlace={resolverEnlace}
          />
        </div>
      </section>

      <section>
        <h2 className="font-semibold text-lg text-neutral-900">Carga y recogida</h2>
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField
            label="Tipo de carga"
            required
            error={errors.cargo_type?.message}
            render={({ id, describedBy }) => (
              <select
                id={id}
                aria-describedby={describedBy}
                {...register('cargo_type')}
                className={fieldInputClass(!!errors.cargo_type)}
              >
                {(Object.keys(CARGO_TYPE_LABELS) as CargoType[]).map((t) => (
                  <option key={t} value={t}>
                    {CARGO_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            )}
          />
          <FormField
            label="Peso (kg)"
            error={errors.cargo_weight_kg?.message}
            render={({ id, describedBy }) => (
              <input
                id={id}
                aria-describedby={describedBy}
                type="number"
                min={1}
                step={1}
                {...register('cargo_weight_kg')}
                className={fieldInputClass(!!errors.cargo_weight_kg)}
              />
            )}
          />
          <FormField
            label="Volumen (m³)"
            error={errors.cargo_volume_m3?.message}
            render={({ id, describedBy }) => (
              <input
                id={id}
                aria-describedby={describedBy}
                type="number"
                min={1}
                step={1}
                {...register('cargo_volume_m3')}
                className={fieldInputClass(!!errors.cargo_volume_m3)}
              />
            )}
          />
          <FormField
            label="Fecha de recogida"
            required
            hint="Puede ser fecha aproximada o ventana en texto libre."
            error={errors.pickup_date_raw?.message}
            render={({ id, describedBy }) => (
              <input
                id={id}
                aria-describedby={describedBy}
                type="text"
                placeholder="2026-11-20 o 20 nov 08:00–12:00"
                {...register('pickup_date_raw')}
                className={fieldInputClass(!!errors.pickup_date_raw)}
                maxLength={200}
              />
            )}
          />
        </div>
      </section>

      <section>
        <h2 className="font-semibold text-lg text-neutral-900">Cliente</h2>
        <fieldset className="mt-3 space-y-4">
          <legend className="sr-only">Tipo de cliente</legend>
          <div className="flex flex-wrap gap-4">
            <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="radio"
                value="externo"
                {...register('cliente_tipo')}
                className="h-4 w-4 border-neutral-300 text-primary-600"
              />
              Cliente externo
            </label>
            <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="radio"
                value="generador"
                {...register('cliente_tipo')}
                className="h-4 w-4 border-neutral-300 text-primary-600"
              />
              Generador en Booster
            </label>
          </div>

          {clienteTipo === 'generador' ? (
            <FormField
              label="ID de empresa generadora"
              required
              hint="UUID de la empresa generadora registrada en Booster."
              error={errors.generador_empresa_id?.message}
              render={({ id, describedBy }) => (
                <input
                  id={id}
                  aria-describedby={describedBy}
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  {...register('generador_empresa_id')}
                  className={fieldInputClass(!!errors.generador_empresa_id)}
                />
              )}
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <FormField
                  label="Nombre o razón social"
                  required
                  error={errors.externo_nombre?.message}
                  render={({ id, describedBy }) => (
                    <input
                      id={id}
                      aria-describedby={describedBy}
                      type="text"
                      {...register('externo_nombre')}
                      className={fieldInputClass(!!errors.externo_nombre)}
                      maxLength={200}
                    />
                  )}
                />
              </div>
              <FormField
                label="RUT (opcional)"
                error={errors.externo_rut?.message}
                render={({ id, describedBy }) => (
                  <input
                    id={id}
                    aria-describedby={describedBy}
                    type="text"
                    inputMode="text"
                    placeholder="12.345.678-9"
                    {...register('externo_rut')}
                    className={fieldInputClass(!!errors.externo_rut)}
                  />
                )}
              />
              <FormField
                label="Contacto (opcional)"
                error={errors.externo_contacto?.message}
                render={({ id, describedBy }) => (
                  <input
                    id={id}
                    aria-describedby={describedBy}
                    type="text"
                    placeholder="Teléfono o nombre de quien recibe"
                    {...register('externo_contacto')}
                    className={fieldInputClass(!!errors.externo_contacto)}
                    maxLength={200}
                  />
                )}
              />
              <FormField
                label="Correo para el certificado (opcional)"
                hint="Al entregar el viaje podrás enviarle ahí su certificado de huella."
                error={errors.externo_correo?.message}
                render={({ id, describedBy }) => (
                  <input
                    id={id}
                    aria-describedby={describedBy}
                    type="email"
                    autoComplete="email"
                    {...register('externo_correo')}
                    className={fieldInputClass(!!errors.externo_correo)}
                    maxLength={254}
                    data-testid="viaje-propio-correo-cliente"
                  />
                )}
              />
            </div>
          )}
        </fieldset>
      </section>

      <div className="flex flex-wrap items-center gap-3 border-neutral-200 border-t pt-6">
        <Button type="submit" variant="primary" disabled={submitting}>
          {submitting ? 'Creando…' : 'Crear viaje propio'}
        </Button>
        <Link to="/app/rutas" className="text-neutral-600 text-sm hover:text-neutral-900">
          Cancelar
        </Link>
      </div>
    </form>
  );

  if (!env.VITE_GOOGLE_MAPS_API_KEY || mapasCaidos) {
    return formulario;
  }

  return (
    <APIProvider
      apiKey={env.VITE_GOOGLE_MAPS_API_KEY}
      language="es"
      region="CL"
      onError={() => {
        logger.warn('google maps no cargó en viaje propio');
        setMapasCaidos(true);
      }}
    >
      {formulario}
    </APIProvider>
  );
}
