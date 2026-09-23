import {
  MENSAJE_CAPACIDAD_ESTANQUE,
  chileanPlateSchema,
  normalizePlate,
  teltonikaImeiSchema,
} from '@booster-ai/shared-schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { ArrowLeft, ChevronDown, MoreHorizontal, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { DocumentosSection } from '../components/DocumentosSection.js';
import { FormField, inputClass as fieldInputClass } from '../components/FormField.js';
import { Layout } from '../components/Layout.js';
import { ProtectedRoute } from '../components/ProtectedRoute.js';
import { VehiculoHub } from '../components/vehiculo-hub.js';
import { VehiculosLista } from '../components/vehiculos-lista.js';
import type { MeResponse } from '../hooks/use-me.js';
import { useScrollToFirstError } from '../hooks/use-scroll-to-first-error.js';
import { ApiError, api } from '../lib/api-client.js';
import {
  type NumericFieldRule,
  numericFieldError,
  serverValidationFieldsMessage,
} from '../lib/form-validation.js';

type MeOnboarded = Extract<MeResponse, { needs_onboarding: false }>;

type VehicleType =
  | 'camioneta'
  | 'furgon_pequeno'
  | 'furgon_mediano'
  | 'camion_pequeno'
  | 'camion_mediano'
  | 'camion_pesado'
  | 'semi_remolque'
  | 'refrigerado'
  | 'tanque';

type FuelType =
  | 'diesel'
  | 'gasolina'
  | 'gas_glp'
  | 'gas_gnc'
  | 'electrico'
  | 'hibrido_diesel'
  | 'hibrido_gasolina'
  | 'hidrogeno';

type VehicleStatus = 'activo' | 'mantenimiento' | 'retirado';
type FuenteCombustibleCan = '84' | '83' | '89' | 'sin_sensor';

const FUENTE_CAN_LABELS: Record<FuenteCombustibleCan, string> = {
  sin_sensor: 'Sin sensor',
  '84': 'IO 84 — nivel en porcentaje',
  '83': 'IO 83 — consumo acumulado',
  '89': 'IO 89 — nivel en porcentaje',
};

interface Vehicle {
  id: string;
  plate: string;
  type: VehicleType;
  capacity_kg: number;
  capacity_m3: number | null;
  year: number | null;
  brand: string | null;
  model: string | null;
  fuel_type: FuelType | null;
  curb_weight_kg: number | null;
  consumption_l_per_100km_baseline: string | null;
  capacidad_estanque_l?: number | null;
  fuente_combustible_can?: FuenteCombustibleCan | null;
  teltonika_imei: string | null;
  status: VehicleStatus;
  created_at: string;
  updated_at: string;
}

const VEHICLE_TYPE_LABELS: Record<VehicleType, string> = {
  camioneta: 'Camioneta',
  furgon_pequeno: 'Furgón pequeño',
  furgon_mediano: 'Furgón mediano',
  camion_pequeno: 'Camión pequeño',
  camion_mediano: 'Camión mediano',
  camion_pesado: 'Camión pesado',
  semi_remolque: 'Semi-remolque',
  refrigerado: 'Refrigerado',
  tanque: 'Tanque',
};

const FUEL_TYPE_LABELS: Record<FuelType, string> = {
  diesel: 'Diésel',
  gasolina: 'Gasolina',
  gas_glp: 'GLP',
  gas_gnc: 'GNC',
  electrico: 'Eléctrico',
  hibrido_diesel: 'Híbrido diésel',
  hibrido_gasolina: 'Híbrido gasolina',
  hidrogeno: 'Hidrógeno',
};

const STATUS_LABELS: Record<VehicleStatus, string> = {
  activo: 'Activo',
  mantenimiento: 'Mantenimiento',
  retirado: 'Retirado',
};

// =============================================================================
// /app/vehiculos — lista
// =============================================================================

export function VehiculosListRoute() {
  return (
    <ProtectedRoute meRequirement="require-onboarded">
      {(ctx) => {
        if (ctx.kind !== 'onboarded') {
          return null;
        }
        return <VehiculosListPage me={ctx.me} />;
      }}
    </ProtectedRoute>
  );
}

function VehiculosListPage({ me }: { me: MeOnboarded }) {
  const role = me.active_membership?.role;
  const canWrite = role === 'dueno' || role === 'admin' || role === 'despachador';

  return (
    <Layout me={me} title="Vehículos">
      <VehiculosLista canWrite={canWrite} />
    </Layout>
  );
}

// =============================================================================
// /app/vehiculos/nuevo — crear
// =============================================================================

export function VehiculosNuevoRoute() {
  return (
    <ProtectedRoute meRequirement="require-onboarded">
      {(ctx) => {
        if (ctx.kind !== 'onboarded') {
          return null;
        }
        const role = ctx.me.active_membership?.role;
        if (role !== 'dueno' && role !== 'admin' && role !== 'despachador') {
          return (
            <Layout me={ctx.me} title="Nuevo vehículo">
              <NoPermission />
            </Layout>
          );
        }
        return <VehiculoNuevoPage me={ctx.me} />;
      }}
    </ProtectedRoute>
  );
}

function VehiculoNuevoPage({ me }: { me: MeOnboarded }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const role = me.active_membership?.role;
  const canEditEstanque = role === 'dueno' || role === 'admin';

  const createM = useMutation({
    mutationFn: async (input: VehicleFormValues) => {
      return await api.post<{ vehicle: Vehicle }>(
        '/vehiculos',
        vehicleFormToBody(input, canEditEstanque),
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vehiculos'] });
      void navigate({ to: '/app/vehiculos' });
    },
    onError: (err: Error) => {
      setError(vehicleMutationErrorMessage(err));
    },
  });

  return (
    <Layout me={me} title="Nuevo vehículo">
      <div className="mb-6 flex items-center gap-3">
        <Link to="/app/vehiculos" className="text-neutral-500 hover:text-neutral-900">
          <ArrowLeft className="h-5 w-5" aria-hidden />
        </Link>
        <h1 className="font-bold text-3xl text-neutral-900 tracking-tight">Nuevo vehículo</h1>
      </div>

      <VehicleForm
        mode="create"
        canEditEstanque={canEditEstanque}
        onSubmit={(values) => {
          setError(null);
          createM.mutate(values);
        }}
        submitting={createM.isPending}
        submitLabel="Crear vehículo"
        error={error}
      />
    </Layout>
  );
}

// =============================================================================
// /app/vehiculos/:id — editar / eliminar
// =============================================================================

export function VehiculosDetalleRoute() {
  return (
    <ProtectedRoute meRequirement="require-onboarded">
      {(ctx) => {
        if (ctx.kind !== 'onboarded') {
          return null;
        }
        return <VehiculoDetallePage me={ctx.me} />;
      }}
    </ProtectedRoute>
  );
}

function VehiculoDetallePage({ me }: { me: MeOnboarded }) {
  const { id } = useParams({ strict: false }) as { id: string };
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [guardado, setGuardado] = useState(false);
  const [menuRetiro, setMenuRetiro] = useState<'cerrado' | 'abierto' | 'confirmar'>('cerrado');
  const [configAbierta, setConfigAbierta] = useState(
    () => typeof window !== 'undefined' && window.location.hash === '#configuracion',
  );
  const [enfocarConfig, setEnfocarConfig] = useState(false);
  const configRef = useRef<HTMLDetailsElement>(null);
  const menuRetiroRef = useRef<HTMLDivElement>(null);

  const role = me.active_membership?.role;
  const canWrite = role === 'dueno' || role === 'admin' || role === 'despachador';
  const canDelete = role === 'dueno' || role === 'admin';
  // PATCH /:id/dispositivo exige dueno|admin en el backend
  // (requireOwnerOrAdminRole, vehiculos.ts) — misma frontera que canDelete,
  // separado en su propia constante para no acoplar semánticas distintas.
  const canManageDispositivo = role === 'dueno' || role === 'admin';
  const empresa = me.active_membership?.empresa;
  const puedeVerTrayectos = Boolean(
    empresa?.is_transportista && (role === 'dueno' || role === 'admin'),
  );

  function abrirConfig() {
    setConfigAbierta(true);
    setEnfocarConfig(true);
  }

  useEffect(() => {
    if (!enfocarConfig || !configAbierta) {
      return;
    }
    const raiz = configRef.current;
    if (!raiz) {
      return;
    }
    raiz.scrollIntoView({ block: 'start' });
    const imei = raiz.querySelector<HTMLElement>('[data-config-imei]');
    const destino = imei ?? raiz.querySelector('summary');
    destino?.focus();
    setEnfocarConfig(false);
  }, [enfocarConfig, configAbierta]);

  useEffect(() => {
    if (menuRetiro === 'cerrado') {
      return;
    }
    function onClick(event: MouseEvent) {
      if (menuRetiroRef.current && !menuRetiroRef.current.contains(event.target as Node)) {
        setMenuRetiro('cerrado');
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setMenuRetiro('cerrado');
      }
    }
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuRetiro]);

  const vehicleQ = useQuery({
    queryKey: ['vehiculos', id],
    queryFn: async () => {
      const res = await api.get<{ vehicle: Vehicle }>(`/vehiculos/${id}`);
      return res.vehicle;
    },
  });

  const updateM = useMutation({
    mutationFn: async (input: VehicleFormValues) => {
      return await api.patch<{ vehicle: Vehicle }>(
        `/vehiculos/${id}`,
        vehicleFormToBody(input, canManageDispositivo),
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vehiculos'] });
      queryClient.invalidateQueries({ queryKey: ['vehiculos', id] });
      setGuardado(true);
      setError(null);
    },
    onError: (err: Error) => {
      setError(vehicleMutationErrorMessage(err));
    },
  });

  const deleteM = useMutation({
    mutationFn: async () => {
      return await api.delete<{ vehicle: Vehicle }>(`/vehiculos/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vehiculos'] });
      void navigate({ to: '/app/vehiculos' });
    },
    onError: (err: Error) => setError(err.message),
  });

  return (
    <Layout me={me} title="Detalle vehículo">
      <div className="mb-4 flex min-w-0 items-center justify-between gap-3">
        <Link
          to="/app/vehiculos"
          className="inline-flex min-w-0 items-center gap-1 text-neutral-500 text-sm hover:text-neutral-900"
        >
          <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden />
          Vehículos
        </Link>
        {canDelete && vehicleQ.data && vehicleQ.data.status !== 'retirado' ? (
          <div ref={menuRetiroRef} className="relative shrink-0">
            <button
              type="button"
              aria-label="Más acciones"
              aria-haspopup="menu"
              aria-expanded={menuRetiro !== 'cerrado'}
              onClick={() =>
                setMenuRetiro((actual) => (actual === 'cerrado' ? 'abierto' : 'cerrado'))
              }
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-neutral-600 hover:bg-neutral-100"
            >
              <MoreHorizontal className="h-4 w-4" aria-hidden />
            </button>
            {menuRetiro !== 'cerrado' ? (
              <div
                role="menu"
                aria-label="Acciones del vehículo"
                className="absolute right-0 z-20 mt-1 w-56 rounded-md border border-neutral-200 bg-white p-1 shadow-lg"
              >
                {menuRetiro === 'abierto' ? (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => setMenuRetiro('confirmar')}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-danger-700 text-sm hover:bg-danger-50"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                    Retirar
                  </button>
                ) : (
                  <div className="px-2 py-2">
                    <p className="text-neutral-800 text-sm">¿Retirar este vehículo?</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => deleteM.mutate()}
                        disabled={deleteM.isPending}
                        className="rounded-md bg-danger-600 px-2.5 py-1 text-sm text-white hover:bg-danger-700 disabled:opacity-50"
                      >
                        Sí, retirar
                      </button>
                      <button
                        type="button"
                        onClick={() => setMenuRetiro('cerrado')}
                        className="rounded-md border border-neutral-300 px-2.5 py-1 text-neutral-700 text-sm hover:bg-neutral-100"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {vehicleQ.isLoading && <p className="text-neutral-500">Cargando…</p>}
      {vehicleQ.error && <p className="text-danger-700">Error al cargar el vehículo.</p>}

      {vehicleQ.data && (
        <>
          <VehiculoHub
            vehicleId={vehicleQ.data.id}
            plate={vehicleQ.data.plate}
            typeLabel={VEHICLE_TYPE_LABELS[vehicleQ.data.type] ?? vehicleQ.data.type}
            brand={vehicleQ.data.brand}
            model={vehicleQ.data.model}
            status={vehicleQ.data.status}
            teltonikaImei={vehicleQ.data.teltonika_imei}
            puedeVerTrayectos={puedeVerTrayectos}
            puedeConfigurar={canManageDispositivo}
            onAbrirConfig={abrirConfig}
          />

          <details
            ref={configRef}
            id="configuracion"
            data-testid="configuracion-vehiculo"
            open={configAbierta}
            onToggle={(event) => setConfigAbierta(event.currentTarget.open)}
            className="group scroll-mt-20 rounded-lg border border-neutral-200 bg-white"
          >
            <summary className="flex cursor-pointer list-none items-start gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
              <ChevronDown
                className="mt-1 h-4 w-4 shrink-0 text-neutral-500 transition-transform group-open:rotate-180"
                aria-hidden
              />
              <span>
                <span className="font-semibold text-neutral-900">Configuración</span>
                <span className="mt-0.5 block font-normal text-neutral-600 text-sm">
                  IMEI, capacidades, tipo y combustible.
                </span>
              </span>
            </summary>
            <div className="space-y-6 border-neutral-200 border-t px-4 py-4">
              <DispositivoSection
                vehicleId={vehicleQ.data.id}
                currentImei={vehicleQ.data.teltonika_imei}
                canManage={canManageDispositivo}
              />

              <div>
                <h2 className="font-semibold text-neutral-900 text-xl">Datos</h2>
                <p className="mt-1 text-neutral-600 text-sm">Capacidad, tipo y combustible.</p>
                {guardado ? (
                  <output className="mt-3 block text-primary-800 text-sm">
                    Cambios guardados.
                  </output>
                ) : null}
                <div className="mt-4">
                  <VehicleForm
                    mode="edit"
                    initial={vehicleToFormValues(vehicleQ.data)}
                    canEditEstanque={canManageDispositivo}
                    onSubmit={(values) => {
                      setError(null);
                      setGuardado(false);
                      updateM.mutate(values);
                    }}
                    submitting={updateM.isPending}
                    submitLabel="Guardar cambios"
                    error={error}
                    disabled={!canWrite}
                  />
                </div>
              </div>

              <DocumentosSection
                entityType="vehiculo"
                entityId={vehicleQ.data.id}
                canWrite={canWrite}
              />
            </div>
          </details>
        </>
      )}
    </Layout>
  );
}

// =============================================================================
// DispositivoSection — gestión self-service del IMEI Teltonika (W2b)
// =============================================================================

/**
 * Respuesta 200 de `PATCH /vehiculos/:id/dispositivo` (W2a,
 * apps/api/src/routes/vehiculos.ts). `reconciliacion` refleja qué pasó con
 * el row de `dispositivos_pendientes` del IMEI nuevo; `reemplazado_anterior`
 * indica si el IMEI previo de este vehículo quedó marcado `reemplazado`;
 * `reasociado_desde` solo aparece cuando el override de D2 (confirmar
 * reasociación de un IMEI `rechazado`) se aplicó.
 */
interface DispositivoPatchResponse {
  vehicle: Vehicle;
  reconciliacion: 'aprobado' | 'reaprobado_desde_rechazado' | 'sin_registro' | null;
  reemplazado_anterior: boolean;
  reasociado_desde?: 'rechazado';
}

/**
 * Payload del 409 `imei_rechazado` (D2/D2c): `rechazado_en` viaja como
 * fecha ISO serializada por `c.json` (Date → string). Se valida con Zod acá
 * porque es una respuesta de API cruzando el boundary cliente — no se
 * confía en el shape sin parsear (regla de boundaries del CLAUDE.md).
 */
const imeiRechazadoDetailsSchema = z.object({
  rechazado_en: z.string(),
  motivo: z.string().nullable(),
});

interface RechazoConfirmState {
  imei: string;
  rechazadoEn: string | null;
  motivo: string | null;
}

/**
 * Mensaje por `err.code` (nunca `err.message.includes`, gotcha documentado
 * en `.specs/hito-2-corfo-mes-8/w2-contexto.md` §7). `imei_rechazado` NO
 * pasa por acá: abre el diálogo de dos pasos (D2) en vez de un mensaje.
 */
function dispositivoErrorMessage(err: ApiError): string {
  switch (err.code) {
    case 'imei_en_uso':
      return 'Ese IMEI ya está asociado a otro vehículo.';
    case 'imei_espejo_activo':
      return 'Este vehículo tiene un espejo demo activo: no puede asociarse un IMEI propio mientras el espejo esté activo.';
    case 'pending_device_conflict':
      return 'El estado del dispositivo cambió mientras guardábamos — reintenta.';
    case 'admin_required':
      return 'Solo dueños o administradores pueden gestionar el dispositivo.';
    default:
      if (err.status === 404) {
        return 'No se encontró el vehículo.';
      }
      if (err.status === 400) {
        return 'El IMEI ingresado no es válido.';
      }
      return 'No se pudo actualizar el dispositivo. Intenta nuevamente.';
  }
}

function DispositivoSection({
  vehicleId,
  currentImei,
  canManage,
}: {
  vehicleId: string;
  currentImei: string | null;
  canManage: boolean;
}) {
  const queryClient = useQueryClient();
  const [imeiInput, setImeiInput] = useState(currentImei ?? '');
  const [clientError, setClientError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [confirmQuitar, setConfirmQuitar] = useState(false);
  const [rechazoConfirm, setRechazoConfirm] = useState<RechazoConfirmState | null>(null);

  const dispositivoM = useMutation({
    mutationFn: async (input: {
      teltonika_imei: string | null;
      confirmar_reasociacion?: boolean;
    }) => {
      return await api.patch<DispositivoPatchResponse>(
        `/vehiculos/${vehicleId}/dispositivo`,
        input,
      );
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['vehiculos'] });
      queryClient.invalidateQueries({ queryKey: ['vehiculos', vehicleId] });
      // Re-sincroniza el input con el IMEI realmente persistido (o `''` si
      // se quitó). Sin esto, tras "Quitar" el input conservaba el IMEI recién
      // eliminado y un "Guardar" no gateado lo reasociaría en silencio,
      // bypaseando la confirmación de "Quitar" (finding W2b review).
      setImeiInput(data.vehicle.teltonika_imei ?? '');
      setServerError(null);
      setRechazoConfirm(null);
      setConfirmQuitar(false);
      if (data.reasociado_desde === 'rechazado') {
        setAviso(
          'El dispositivo estaba marcado como rechazado y fue reasociado igualmente: queda en estado aprobado.',
        );
      } else if (data.reemplazado_anterior) {
        setAviso('El IMEI anterior de este vehículo quedó marcado como reemplazado.');
      } else {
        setAviso(null);
      }
    },
    onError: (err, variables) => {
      if (!(err instanceof ApiError)) {
        setServerError('No se pudo actualizar el dispositivo. Intenta nuevamente.');
        return;
      }
      if (err.code === 'imei_rechazado' && variables.teltonika_imei !== null) {
        const parsed = imeiRechazadoDetailsSchema.safeParse(err.details);
        setRechazoConfirm({
          imei: variables.teltonika_imei,
          rechazadoEn: parsed.success ? parsed.data.rechazado_en : null,
          motivo: parsed.success ? parsed.data.motivo : null,
        });
        setServerError(null);
        return;
      }
      setRechazoConfirm(null);
      setServerError(dispositivoErrorMessage(err));
      if (err.code === 'pending_device_conflict') {
        // D2c: el estado real cambió concurrentemente — refetch para que
        // el usuario reintente contra el estado fresco, no el stale.
        queryClient.invalidateQueries({ queryKey: ['vehiculos', vehicleId] });
      }
    },
  });

  // Punto único de entrada a la mutación: limpia el feedback de un submit
  // anterior (error de servidor / diálogo de reasociación) antes de disparar
  // uno nuevo, para que no queden mensajes stale mientras el nuevo PATCH está
  // en vuelo (Minor #2 del review W2b).
  function submitDispositivo(input: {
    teltonika_imei: string | null;
    confirmar_reasociacion?: boolean;
  }) {
    setServerError(null);
    setRechazoConfirm(null);
    dispositivoM.mutate(input);
  }

  function handleGuardar() {
    const result = teltonikaImeiSchema.safeParse(imeiInput);
    if (!result.success) {
      setClientError(result.error.issues[0]?.message ?? 'IMEI inválido');
      return;
    }
    setClientError(null);
    setAviso(null);
    submitDispositivo({ teltonika_imei: result.data });
  }

  return (
    <div className="mb-6 rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="font-semibold text-neutral-900 text-xl">Dispositivo</h2>
          <p className="mt-1 text-neutral-600 text-sm">
            <strong>IMEI actual:</strong>{' '}
            <span className="font-mono">{currentImei ?? 'Sin dispositivo'}</span>
          </p>
        </div>
      </div>

      {canManage && (
        <div className="mt-4 space-y-3">
          <FormField
            label="IMEI"
            error={clientError ?? undefined}
            hint="15 dígitos, sin espacios ni guiones."
            render={({ id, describedBy }) => (
              <input
                id={id}
                data-config-imei=""
                aria-describedby={describedBy}
                type="text"
                inputMode="numeric"
                placeholder="15 dígitos"
                maxLength={15}
                value={imeiInput}
                onChange={(e) => {
                  setImeiInput(e.target.value);
                  setClientError(null);
                }}
                className={fieldInputClass(!!clientError)}
              />
            )}
          />

          {serverError && (
            <div className="rounded-md border border-danger-200 bg-danger-50 p-3 text-danger-700 text-sm">
              {serverError}
            </div>
          )}

          {aviso && (
            <div className="rounded-md border border-primary-200 bg-primary-50 p-3 text-primary-800 text-sm">
              {aviso}
            </div>
          )}

          {rechazoConfirm && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900 text-sm">
              <p>
                Este dispositivo fue rechazado el{' '}
                {rechazoConfirm.rechazadoEn
                  ? new Date(rechazoConfirm.rechazadoEn).toLocaleDateString('es-CL')
                  : 'fecha desconocida'}
                {rechazoConfirm.motivo ? `: ${rechazoConfirm.motivo}` : ''}. ¿Reasociar de todas
                formas?
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() =>
                    submitDispositivo({
                      teltonika_imei: rechazoConfirm.imei,
                      confirmar_reasociacion: true,
                    })
                  }
                  disabled={dispositivoM.isPending}
                  className="rounded-md bg-amber-600 px-3 py-1.5 text-sm text-white hover:bg-amber-700 disabled:opacity-50"
                >
                  Sí, reasociar
                </button>
                <button
                  type="button"
                  onClick={() => setRechazoConfirm(null)}
                  className="rounded-md border border-neutral-300 px-3 py-1.5 text-neutral-700 text-sm hover:bg-neutral-100"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}

          <div className="flex items-center justify-end gap-2">
            {currentImei &&
              (confirmQuitar ? (
                <>
                  <span className="text-neutral-700 text-sm">¿Quitar el dispositivo?</span>
                  <button
                    type="button"
                    onClick={() => submitDispositivo({ teltonika_imei: null })}
                    disabled={dispositivoM.isPending}
                    className="rounded-md bg-danger-600 px-3 py-1.5 text-sm text-white hover:bg-danger-700 disabled:opacity-50"
                  >
                    Sí, quitar
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmQuitar(false)}
                    className="rounded-md border border-neutral-300 px-3 py-1.5 text-neutral-700 text-sm hover:bg-neutral-100"
                  >
                    Cancelar
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmQuitar(true)}
                  className="rounded-md border border-danger-300 px-3 py-1.5 text-danger-700 text-sm hover:bg-danger-50"
                >
                  Quitar
                </button>
              ))}
            <button
              type="button"
              onClick={handleGuardar}
              disabled={dispositivoM.isPending}
              className="rounded-md bg-primary-600 px-4 py-2 font-medium text-sm text-white hover:bg-primary-700 disabled:opacity-50"
            >
              {dispositivoM.isPending ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// VehicleForm compartido (create + edit)
// =============================================================================

interface VehicleFormValues {
  plate: string;
  vehicle_type: VehicleType;
  capacity_kg: string;
  capacity_m3: string;
  year: string;
  brand: string;
  model: string;
  fuel_type: '' | FuelType;
  curb_weight_kg: string;
  consumption_l_per_100km_baseline: string;
  capacidad_estanque_l: string;
  fuente_combustible_can: FuenteCombustibleCan;
  vehicle_status?: VehicleStatus;
}

const EMPTY_FORM: VehicleFormValues = {
  plate: '',
  vehicle_type: 'camion_pequeno',
  capacity_kg: '',
  capacity_m3: '',
  year: '',
  brand: '',
  model: '',
  fuel_type: '',
  curb_weight_kg: '',
  consumption_l_per_100km_baseline: '',
  capacidad_estanque_l: '',
  fuente_combustible_can: 'sin_sensor',
};

function vehicleToFormValues(v: Vehicle): VehicleFormValues {
  return {
    plate: v.plate,
    vehicle_type: v.type,
    capacity_kg: String(v.capacity_kg),
    capacity_m3: v.capacity_m3 != null ? String(v.capacity_m3) : '',
    year: v.year != null ? String(v.year) : '',
    brand: v.brand ?? '',
    model: v.model ?? '',
    fuel_type: v.fuel_type ?? '',
    curb_weight_kg: v.curb_weight_kg != null ? String(v.curb_weight_kg) : '',
    consumption_l_per_100km_baseline: v.consumption_l_per_100km_baseline ?? '',
    capacidad_estanque_l: v.capacidad_estanque_l != null ? String(v.capacidad_estanque_l) : '',
    fuente_combustible_can: v.fuente_combustible_can ?? 'sin_sensor',
    vehicle_status: v.status,
  };
}

/**
 * Rangos numéricos del form, espejo de `createBodySchema` en
 * `apps/api/src/routes/vehiculos.ts`. El form declara `noValidate`, así que
 * los attributes HTML5 `min`/`max`/`required` de los inputs NO bloquean el
 * submit: esta tabla es la validación real, corre en `submit()` con copy en
 * español por campo (ver `lib/form-validation.ts`). Si el server endurece un
 * rango antes de actualizar esta tabla, el fallback de
 * `vehicleMutationErrorMessage` traduce ese 400 a un banner que nombra el
 * campo (defense in depth, no reemplazo).
 */
type NumericFieldName =
  | 'capacity_kg'
  | 'capacity_m3'
  | 'year'
  | 'curb_weight_kg'
  | 'consumption_l_per_100km_baseline';

const NUMERIC_FIELD_RULES: Record<NumericFieldName, NumericFieldRule> = {
  capacity_kg: {
    min: 1,
    max: 100_000,
    entero: true,
    requiredMessage: 'Ingresa la capacidad de carga',
  },
  capacity_m3: { min: 1, max: 500, entero: true },
  year: { min: 1980, max: 2100, entero: true },
  curb_weight_kg: { min: 1, max: 50_000, entero: true },
  consumption_l_per_100km_baseline: { min: 0.01, max: 99.99, entero: false },
};

/**
 * Labels en español por campo del body del API — para nombrar campos en el
 * banner cuando el server responde un 400 de validación.
 */
const API_FIELD_LABELS: Record<string, string> = {
  plate: 'Patente',
  vehicle_type: 'Tipo de vehículo',
  unit_category: 'Categoría de unidad',
  unit_type: 'Tipo de unidad',
  body_type: 'Tipo de carrocería',
  capacity_kg: 'Capacidad (kg)',
  capacity_m3: 'Capacidad (m³)',
  year: 'Año',
  brand: 'Marca',
  model: 'Modelo',
  fuel_type: 'Combustible',
  curb_weight_kg: 'Peso vacío (kg)',
  consumption_l_per_100km_baseline: 'Consumo base (L / 100 km)',
  capacidad_estanque_l: 'Capacidad del estanque (L)',
  fuente_combustible_can: 'Fuente CAN de combustible',
  vehicle_status: 'Estado',
};

/**
 * Copy del banner de error para las mutations create/update. Prioridad:
 * patente duplicada (409, por `code` — el `message` del ApiError es el
 * técnico 'plate_already_exists') → 400/422 de validación con campos
 * conocidos (`serverValidationFieldsMessage`, lib compartida) → mensaje del
 * error tal cual.
 */
function vehicleMutationErrorMessage(err: Error): string {
  if (
    (err instanceof ApiError && err.code === 'plate_duplicate') ||
    err.message.includes('plate_duplicate')
  ) {
    return 'Ya existe un vehículo con esa patente.';
  }
  return serverValidationFieldsMessage(err, API_FIELD_LABELS) ?? err.message;
}

function vehicleFormToBody(
  v: VehicleFormValues,
  incluirEstanque: boolean,
): Record<string, unknown> {
  // El servidor también normaliza vía chileanPlateSchema, pero normalizar
  // del lado del cliente nos da consistencia visual: si el usuario ingresa
  // "bcdf12", el body que viaja es "BCDF12".
  const body: Record<string, unknown> = {
    plate: normalizePlate(v.plate),
    vehicle_type: v.vehicle_type,
    capacity_kg: Number.parseInt(v.capacity_kg, 10),
  };
  if (v.capacity_m3.trim()) {
    body.capacity_m3 = Number.parseInt(v.capacity_m3, 10);
  }
  if (v.year.trim()) {
    body.year = Number.parseInt(v.year, 10);
  }
  if (v.brand.trim()) {
    body.brand = v.brand.trim();
  }
  if (v.model.trim()) {
    body.model = v.model.trim();
  }
  if (v.fuel_type) {
    body.fuel_type = v.fuel_type;
  }
  if (v.curb_weight_kg.trim()) {
    body.curb_weight_kg = Number.parseInt(v.curb_weight_kg, 10);
  }
  if (v.consumption_l_per_100km_baseline.trim()) {
    body.consumption_l_per_100km_baseline = Number.parseFloat(v.consumption_l_per_100km_baseline);
  }
  if (v.vehicle_status) {
    body.vehicle_status = v.vehicle_status;
  }
  if (incluirEstanque) {
    const capacidad = v.capacidad_estanque_l.trim();
    body.capacidad_estanque_l = capacidad === '' ? null : Number(capacidad);
    body.fuente_combustible_can = v.fuente_combustible_can;
  }
  return body;
}

function VehicleForm({
  mode,
  initial,
  canEditEstanque,
  onSubmit,
  submitting,
  submitLabel,
  error,
  disabled,
}: {
  mode: 'create' | 'edit';
  initial?: VehicleFormValues;
  canEditEstanque: boolean;
  onSubmit: (values: VehicleFormValues) => void;
  submitting: boolean;
  submitLabel: string;
  error: string | null;
  disabled?: boolean;
}) {
  const {
    register,
    handleSubmit,
    setError,
    watch,
    formState: { errors, submitCount },
  } = useForm<VehicleFormValues>({
    mode: 'onSubmit',
    defaultValues: initial ?? EMPTY_FORM,
  });

  useScrollToFirstError(errors, submitCount);

  const vehicleStatus = watch('vehicle_status');

  /**
   * Validación cliente completa: patente (schema compartido) + rangos
   * numéricos (`NUMERIC_FIELD_RULES`, espejo del `createBodySchema` del
   * API). OJO: el form declara `noValidate`, así que los attributes HTML5
   * (`required`, `min`, `max`) de los inputs NO bloquean el submit — son
   * solo afford visual de los steppers. Sin esta validación, un valor fuera
   * de rango viaja al server y vuelve como 400 opaco (incidente prod
   * 2026-08-15, capacity_m3=10000). Se reportan TODOS los campos inválidos
   * de una vez; `useScrollToFirstError` lleva el foco al primero.
   */
  function submit(values: VehicleFormValues) {
    let hasError = false;
    const plateResult = chileanPlateSchema.safeParse(values.plate);
    if (!plateResult.success) {
      const message = plateResult.error.issues[0]?.message ?? 'Patente inválida';
      setError('plate', { type: 'manual', message });
      hasError = true;
    }
    for (const field of Object.keys(NUMERIC_FIELD_RULES) as NumericFieldName[]) {
      const message = numericFieldError(NUMERIC_FIELD_RULES[field], values[field]);
      if (message) {
        setError(field, { type: 'manual', message });
        hasError = true;
      }
    }
    if (canEditEstanque) {
      const capacidad = values.capacidad_estanque_l.trim();
      if (capacidad !== '') {
        const litros = Number(capacidad);
        if (!Number.isFinite(litros) || litros <= 0 || litros > 2000) {
          setError('capacidad_estanque_l', { type: 'manual', message: MENSAJE_CAPACIDAD_ESTANQUE });
          hasError = true;
        }
      }
    }
    if (hasError) {
      return;
    }
    onSubmit(values);
  }

  return (
    <form
      onSubmit={handleSubmit(submit)}
      className="space-y-6 rounded-lg border border-neutral-200 bg-white p-6 shadow-sm"
      noValidate
    >
      <fieldset disabled={disabled} className="space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField
            label="Patente"
            required
            error={errors.plate?.message}
            render={({ id, describedBy }) => (
              <input
                id={id}
                aria-describedby={describedBy}
                type="text"
                {...register('plate')}
                className={fieldInputClass(!!errors.plate)}
                placeholder="BC·DF·12 o BCDF12"
                maxLength={12}
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
              />
            )}
          />

          <FormField
            label="Tipo de vehículo"
            required
            render={({ id, describedBy }) => (
              <select
                id={id}
                aria-describedby={describedBy}
                {...register('vehicle_type')}
                className={fieldInputClass(!!errors.vehicle_type)}
              >
                {(Object.keys(VEHICLE_TYPE_LABELS) as VehicleType[]).map((t) => (
                  <option key={t} value={t}>
                    {VEHICLE_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            )}
          />

          <FormField
            label="Capacidad (kg)"
            required
            error={errors.capacity_kg?.message}
            render={({ id, describedBy }) => (
              <input
                id={id}
                aria-describedby={describedBy}
                type="number"
                min={1}
                max={100_000}
                {...register('capacity_kg')}
                className={fieldInputClass(!!errors.capacity_kg)}
              />
            )}
          />

          <FormField
            label="Capacidad (m³)"
            error={errors.capacity_m3?.message}
            render={({ id, describedBy }) => (
              <input
                id={id}
                aria-describedby={describedBy}
                type="number"
                min={1}
                max={500}
                {...register('capacity_m3')}
                className={fieldInputClass(!!errors.capacity_m3)}
              />
            )}
          />

          <FormField
            label="Año"
            error={errors.year?.message}
            render={({ id, describedBy }) => (
              <input
                id={id}
                aria-describedby={describedBy}
                type="number"
                min={1980}
                max={2100}
                {...register('year')}
                className={fieldInputClass(!!errors.year)}
              />
            )}
          />

          <FormField
            label="Combustible"
            render={({ id, describedBy }) => (
              <select
                id={id}
                aria-describedby={describedBy}
                {...register('fuel_type')}
                className={fieldInputClass(!!errors.fuel_type)}
              >
                <option value="">— Sin especificar —</option>
                {(Object.keys(FUEL_TYPE_LABELS) as FuelType[]).map((f) => (
                  <option key={f} value={f}>
                    {FUEL_TYPE_LABELS[f]}
                  </option>
                ))}
              </select>
            )}
          />

          <FormField
            label="Marca"
            render={({ id, describedBy }) => (
              <input
                id={id}
                aria-describedby={describedBy}
                type="text"
                {...register('brand')}
                className={fieldInputClass(!!errors.brand)}
                maxLength={50}
              />
            )}
          />

          <FormField
            label="Modelo"
            render={({ id, describedBy }) => (
              <input
                id={id}
                aria-describedby={describedBy}
                type="text"
                {...register('model')}
                className={fieldInputClass(!!errors.model)}
                maxLength={100}
              />
            )}
          />
        </div>

        <fieldset
          disabled={disabled || !canEditEstanque}
          className="grid grid-cols-1 gap-4 border-0 p-0 sm:grid-cols-2"
        >
          <legend className="col-span-full mb-1 font-medium text-neutral-900 text-sm">
            Estanque y fuente CAN
          </legend>
          <FormField
            label="Capacidad del estanque (L)"
            error={errors.capacidad_estanque_l?.message}
            hint="Vacío si no la conocés. Si la indicás, tiene que ser mayor que 0 y de hasta 2000 litros."
            render={({ id, describedBy }) => (
              <input
                id={id}
                aria-describedby={describedBy}
                type="number"
                inputMode="decimal"
                step="0.1"
                min={0.1}
                max={2000}
                {...register('capacidad_estanque_l')}
                className={fieldInputClass(!!errors.capacidad_estanque_l)}
              />
            )}
          />
          <FormField
            label="Fuente CAN de combustible"
            hint="Sin sensor no calculamos litros. No adivinamos el IO."
            render={({ id, describedBy }) => (
              <select
                id={id}
                aria-describedby={describedBy}
                {...register('fuente_combustible_can')}
                className={fieldInputClass(false)}
              >
                {(Object.keys(FUENTE_CAN_LABELS) as FuenteCombustibleCan[]).map((fuente) => (
                  <option key={fuente} value={fuente}>
                    {FUENTE_CAN_LABELS[fuente]}
                  </option>
                ))}
              </select>
            )}
          />
        </fieldset>
        {!disabled && !canEditEstanque ? (
          <p className="text-neutral-600 text-sm">
            Solo el dueño o un administrador puede cambiar la capacidad del estanque y la fuente
            CAN.
          </p>
        ) : null}

        <details className="rounded-md border border-neutral-200 p-3">
          <summary className="cursor-pointer font-medium text-neutral-700 text-sm">
            Datos avanzados (huella de carbono)
          </summary>
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField
              label="Peso vacío (kg)"
              error={errors.curb_weight_kg?.message}
              render={({ id, describedBy }) => (
                <input
                  id={id}
                  aria-describedby={describedBy}
                  type="number"
                  min={1}
                  max={50_000}
                  {...register('curb_weight_kg')}
                  className={fieldInputClass(!!errors.curb_weight_kg)}
                />
              )}
            />
            <FormField
              label="Consumo base (L / 100 km)"
              error={errors.consumption_l_per_100km_baseline?.message}
              render={({ id, describedBy }) => (
                <input
                  id={id}
                  aria-describedby={describedBy}
                  type="number"
                  step="0.01"
                  min={0.1}
                  max={99.99}
                  {...register('consumption_l_per_100km_baseline')}
                  className={fieldInputClass(!!errors.consumption_l_per_100km_baseline)}
                />
              )}
            />
          </div>
        </details>

        {mode === 'edit' && vehicleStatus && (
          <FormField
            label="Estado"
            render={({ id, describedBy }) => (
              <select
                id={id}
                aria-describedby={describedBy}
                {...register('vehicle_status')}
                className={fieldInputClass(!!errors.vehicle_status)}
              >
                {(Object.keys(STATUS_LABELS) as VehicleStatus[]).map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            )}
          />
        )}

        {error && (
          <div className="rounded-md border border-danger-200 bg-danger-50 p-3 text-danger-700 text-sm">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Link
            to="/app/vehiculos"
            className="rounded-md border border-neutral-300 px-4 py-2 font-medium text-neutral-700 text-sm hover:bg-neutral-100"
          >
            Cancelar
          </Link>
          {!disabled && (
            <button
              type="submit"
              disabled={submitting}
              className="rounded-md bg-primary-600 px-4 py-2 font-medium text-sm text-white hover:bg-primary-700 disabled:opacity-50"
            >
              {submitting ? 'Guardando…' : submitLabel}
            </button>
          )}
        </div>
      </fieldset>
    </form>
  );
}

// =============================================================================
// Layout vive en components/Layout.tsx (BUG-003) — antes estaba duplicado
// inline acá y en cargas.tsx.
// =============================================================================

function NoPermission() {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
      <h2 className="font-semibold text-neutral-900 text-xl">Sin permisos</h2>
      <p className="mt-2 text-neutral-600 text-sm">
        Solo dueños, administradores y despachadores pueden modificar vehículos.
      </p>
      <Link to="/app/vehiculos" className="mt-4 inline-block text-primary-600 underline">
        Volver a la lista
      </Link>
    </div>
  );
}

// D3 — Las antiguas secciones UbicacionSection y TelemetriaSection vivían acá
// y mostraban el mapa hero + el histórico de telemetría dentro del form de
// edición del vehículo. Esto rompía el principio "una página, una intención":
// editar vs trackear. Se movieron a /app/flota (mapa multi-vehículo) y al
// modo Uber /app/vehiculos/:id/live (single-vehicle full-screen). Esta página
// quedó pure-edit.
