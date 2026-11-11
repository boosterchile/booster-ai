import {
  type AltaPersonalBooster,
  type AltaPersonalBoosterResponse,
  CONFIRMACION_ACCESO_BOOSTER_VIGENCIA_HORAS,
  type PersonalBooster as PersonaDelPersonal,
  type PersonalBoosterErrorCode,
  type PersonalBoosterEstado,
  type VinculoPersonalBooster,
  altaPersonalBoosterResponseSchema,
  altaPersonalBoosterSchema,
  ensureRutHasDash,
  listaPersonalBoosterResponseSchema,
  personalBoosterErrorCodeSchema,
  quitarAccesoPersonalBoosterResponseSchema,
  reemitirCodigoPersonalBoosterResponseSchema,
} from '@booster-ai/shared-schemas';
import { Copy, KeyRound, Loader2, UserMinus, UserPlus, Users } from 'lucide-react';
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import type { ZodError } from 'zod';
import { urlActivar } from '../../lib/activar-url.js';
import { ApiError, api } from '../../lib/api-client.js';
import { urlConfirmarAccesoBooster } from '../../lib/confirmar-acceso-booster-url.js';
import { logger } from '../../lib/logger.js';
import { formatRut } from '../../lib/rut.js';

/**
 * Platform-admin: personal de Booster con acceso al panel
 * (`.specs/alta-personal-booster/spec.md` y
 * `.specs/acceso-panel-plataforma/spec.md` SC12).
 *
 * El panel otorga y quita el acceso. El admin crea la cuenta con correo,
 * nombre y RUT; la persona elige su clave en `/activar` con un código de un
 * solo uso y entra por `/login`. «Quitar acceso» la desmarca. La lista de
 * respaldo de Terraform queda para el primer admin.
 *
 * El código llega solo en la respuesta del alta o de la re-emisión y se
 * muestra una sola vez: al cerrar el panel, o al emitir otro, deja de estar
 * en pantalla. La lista nunca lo trae.
 *
 * Una cuenta activa que ya es de una empresa no queda marcada en el alta: el
 * panel muestra un código de confirmación que el admin entrega en persona y
 * que la persona ingresa con su sesión en `/app/confirmar-acceso-booster`
 * (`.specs/confirmar-acceso-booster` SC16 y SC17).
 */

// La API no informa si el proveedor de correo entregó el mensaje: el aviso no
// lo afirma y pide entregar el código a mano si no llega.
const AVISO_CORREO_ENVIADO =
  'Intentamos enviarle el código por correo a esa dirección. Si no le llega, entrégaselo tú: cópialo antes de cerrar.';
const AVISO_SIN_RUT =
  'No enviamos el correo: la cuenta no tiene RUT registrado y sin RUT no puede activar. Repárala con el script de bootstrap del runbook.';
/** El código de confirmación no sale por correo: lo entrega el admin (SC16). */
const INSTRUCCION_CONFIRMACION =
  'Esta persona ya tiene cuenta en una empresa. Entrégale este código en persona: lo ingresa con su sesión iniciada en Confirmar acceso de Booster. No lo envíes por correo ni por chat.';

const ESTADO_LABEL: Record<PersonalBoosterEstado, string> = {
  sin_cuenta: 'Sin cuenta',
  pendiente_activacion: 'Pendiente de activar',
  pendiente_confirmacion: 'Pendiente de confirmar',
  activa: 'Activa',
};

const ESTADO_CLASE: Record<PersonalBoosterEstado, string> = {
  sin_cuenta: 'border-neutral-300 bg-neutral-100 text-neutral-700',
  pendiente_activacion: 'border-amber-300 bg-amber-50 text-amber-900',
  pendiente_confirmacion: 'border-amber-300 bg-amber-50 text-amber-900',
  activa: 'border-success-200 bg-success-50 text-success-700',
};

const MENSAJES_POR_CODIGO: Record<PersonalBoosterErrorCode, string> = {
  rut_mismatch:
    'Ese correo ya es de una cuenta con otro RUT. Revisa el RUT: el de una cuenta existente no se cambia desde aquí.',
  rut_already_registered:
    'Ese RUT ya es de otra persona en Booster. Revisa el RUT o usa el correo de esa cuenta.',
  email_already_registered:
    'Otra alta tomó ese correo recién. Revisa la lista antes de intentar de nuevo.',
  already_activated: 'Esa persona ya activó su cuenta: entra con su RUT y su clave.',
  personal_not_found:
    'Esa persona no figura como personal de Booster. Repite el alta con su correo y RUT para marcarla.',
  en_lista_respaldo:
    'Su correo está en la lista de respaldo: primero sácalo de Terraform y aplica; después quítale el acceso aquí.',
  ultimo_acceso: 'No puedes quitar este acceso: el panel quedaría sin nadie que pueda entrar.',
};

/** Mensaje por campo del body del alta, en el orden del formulario. */
const MENSAJES_VALIDACION: Record<string, string> = {
  email: 'Revisa el correo: no parece una dirección válida.',
  full_name: 'Escribe el nombre completo (entre 2 y 200 caracteres).',
  rut: 'RUT inválido (ej: 12.345.678-5).',
};

const FORMATO_FECHA_HORA = new Intl.DateTimeFormat('es-CL', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'America/Santiago',
});

function fechaHora(iso: string): string {
  return FORMATO_FECHA_HORA.format(new Date(iso));
}

function yaPaso(iso: string): boolean {
  return Date.parse(iso) <= Date.now();
}

/** La respuesta no pasó su schema. Se reporta al detectarla; la UI muestra un texto fijo. */
class RespuestaInesperadaError extends Error {
  constructor() {
    super('respuesta_inesperada');
    this.name = 'RespuestaInesperadaError';
  }
}

/**
 * Reporta qué campos fallaron, sin los valores: la respuesta del alta y de la
 * re-emisión trae el código y no debe llegar a un log.
 */
function respuestaInesperada(contexto: string, error: ZodError): RespuestaInesperadaError {
  logger.error(
    {
      contexto,
      problemas: error.issues.map((issue) => `${issue.path.join('.')}:${issue.code}`),
    },
    'personal-booster: respuesta del servidor con formato inesperado',
  );
  return new RespuestaInesperadaError();
}

function mensajeError(err: unknown): string {
  if (err instanceof RespuestaInesperadaError) {
    return 'La respuesta del servidor no tiene el formato esperado.';
  }
  if (err instanceof ApiError) {
    const codigo = personalBoosterErrorCodeSchema.safeParse(err.code);
    if (codigo.success) {
      return MENSAJES_POR_CODIGO[codigo.data];
    }
    if (err.status === 400) {
      return `Revisa los datos: ${err.message}`;
    }
    if (err.status === 401) {
      return 'Tu sesión venció. Vuelve a iniciar sesión.';
    }
    if (err.status === 403) {
      return err.code === 'forbidden_impersonation_write'
        ? 'Estás viendo la plataforma como otra persona. Sal de la impersonación para hacer cambios.'
        : 'Tu cuenta no tiene acceso a esta función del panel.';
    }
    return `No pudimos completar la acción (${err.status}: ${err.message}).`;
  }
  logger.error({ err }, 'personal-booster: la acción falló sin respuesta del servidor');
  return `No pudimos completar la acción: ${err instanceof Error ? err.message : String(err)}`;
}

interface CodigoEmitido {
  tipo: 'codigo';
  /**
   * `activacion`: la persona elige su clave en `/activar`. `confirmacion`: la
   * persona lo ingresa con su sesión en `/app/confirmar-acceso-booster`.
   */
  uso: 'activacion' | 'confirmacion';
  /** El alta lo muestra bajo el formulario; la re-emisión, en la fila. */
  origen: 'alta' | 'reemision';
  userId: string;
  email: string;
  nombre: string | null;
  rut: string | null;
  codigo: string;
  expiraEn: string;
}

interface AltaSinCodigo {
  tipo: 'sin_codigo';
  vinculo: Extract<VinculoPersonalBooster, 'cuenta_activa' | 'codigo_vigente'>;
  expiraEn: string | null;
}

type Panel = CodigoEmitido | AltaSinCodigo;

function usoDelCodigo(vinculo: VinculoPersonalBooster): CodigoEmitido['uso'] {
  return vinculo === 'cuenta_activa_por_confirmar' ? 'confirmacion' : 'activacion';
}

function panelDelAlta(res: AltaPersonalBoosterResponse, datos: AltaPersonalBooster): Panel {
  if (res.codigo_activacion !== null && res.expira_en !== null) {
    return {
      tipo: 'codigo',
      uso: usoDelCodigo(res.vinculo),
      origen: 'alta',
      userId: res.user_id,
      email: datos.email,
      nombre: datos.full_name,
      rut: datos.rut,
      codigo: res.codigo_activacion,
      expiraEn: res.expira_en,
    };
  }
  if (res.vinculo === 'cuenta_activa' || res.vinculo === 'codigo_vigente') {
    return {
      tipo: 'sin_codigo',
      vinculo: res.vinculo,
      expiraEn: res.expira_en,
    };
  }
  // El schema exige código en `nueva`, `provisoria_sin_codigo` y
  // `cuenta_activa_por_confirmar`: no se llega aquí.
  throw new RespuestaInesperadaError();
}

function avisoDeLista(panel: CodigoEmitido): string {
  // Sin RUT no puede activar: ese aviso va primero.
  return panel.rut === null ? AVISO_SIN_RUT : AVISO_CORREO_ENVIADO;
}

export function PersonalBooster() {
  const [personal, setPersonal] = useState<PersonaDelPersonal[]>([]);
  const [cargando, setCargando] = useState(true);
  const [errorLista, setErrorLista] = useState<string | null>(null);

  const [email, setEmail] = useState('');
  const [nombre, setNombre] = useState('');
  const [rut, setRut] = useState('');
  const [errorAlta, setErrorAlta] = useState<string | null>(null);
  const [confirmacion, setConfirmacion] = useState<AltaPersonalBooster | null>(null);
  const [enviando, setEnviando] = useState(false);
  const nombreRef = useRef<HTMLInputElement>(null);
  const [pedidosDeFoco, setPedidosDeFoco] = useState(0);

  const [panel, setPanel] = useState<Panel | null>(null);
  const [reemitiendoId, setReemitiendoId] = useState<string | null>(null);
  const [errorReemision, setErrorReemision] = useState<{
    userId: string;
    mensaje: string;
  } | null>(null);

  const [confirmandoQuitar, setConfirmandoQuitar] = useState<string | null>(null);
  const [quitandoId, setQuitandoId] = useState<string | null>(null);
  const [errorQuitar, setErrorQuitar] = useState<{ userId: string; mensaje: string } | null>(null);
  const [accesoQuitado, setAccesoQuitado] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setErrorLista(null);
    try {
      const parsed = listaPersonalBoosterResponseSchema.safeParse(
        await api.get<unknown>('/admin/personal-booster'),
      );
      if (!parsed.success) {
        throw respuestaInesperada('lista', parsed.error);
      }
      setPersonal(parsed.data.personal);
    } catch (err) {
      setErrorLista(mensajeError(err));
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  // El formulario se monta de nuevo al salir de la confirmación: el foco se
  // pide después del render, no en el click.
  useEffect(() => {
    if (pedidosDeFoco > 0) {
      nombreRef.current?.focus();
    }
  }, [pedidosDeFoco]);

  function revisar(e: FormEvent) {
    e.preventDefault();
    setErrorAlta(null);
    const parsed = altaPersonalBoosterSchema.safeParse({
      email,
      full_name: nombre,
      rut: ensureRutHasDash(rut),
    });
    if (!parsed.success) {
      const campo = String(parsed.error.issues[0]?.path[0]);
      setErrorAlta(MENSAJES_VALIDACION[campo] ?? 'Revisa los datos del formulario.');
      return;
    }
    setConfirmacion(parsed.data);
  }

  async function crear(datos: AltaPersonalBooster) {
    setEnviando(true);
    setErrorAlta(null);
    setErrorReemision(null);
    setPanel(null);
    try {
      const parsed = altaPersonalBoosterResponseSchema.safeParse(
        await api.post<unknown>('/admin/personal-booster', datos),
      );
      if (!parsed.success) {
        throw respuestaInesperada('alta', parsed.error);
      }
      setPanel(panelDelAlta(parsed.data, datos));
      setConfirmacion(null);
      setEmail('');
      setNombre('');
      setRut('');
      void cargar();
    } catch (err) {
      setErrorAlta(mensajeError(err));
      setConfirmacion(null);
    } finally {
      setEnviando(false);
    }
  }

  async function reemitir(persona: PersonaDelPersonal, userId: string) {
    setReemitiendoId(userId);
    setErrorReemision(null);
    setPanel(null);
    try {
      // Sin body: el endpoint no lo lee y el cliente no manda Content-Type.
      const parsed = reemitirCodigoPersonalBoosterResponseSchema.safeParse(
        await api.post<unknown>(`/admin/personal-booster/${userId}/codigo`),
      );
      if (!parsed.success) {
        throw respuestaInesperada('reemision', parsed.error);
      }
      setPanel({
        tipo: 'codigo',
        uso: usoDelCodigo(parsed.data.vinculo),
        origen: 'reemision',
        userId,
        email: persona.email,
        nombre: persona.nombre,
        rut: persona.rut,
        codigo: parsed.data.codigo_activacion,
        expiraEn: parsed.data.expira_en,
      });
      void cargar();
    } catch (err) {
      setErrorReemision({ userId, mensaje: mensajeError(err) });
    } finally {
      setReemitiendoId(null);
    }
  }

  async function quitarAcceso(persona: PersonaDelPersonal, userId: string) {
    setQuitandoId(userId);
    setErrorQuitar(null);
    setAccesoQuitado(null);
    try {
      // Sin body: el endpoint no lo lee y el cliente no manda Content-Type.
      const parsed = quitarAccesoPersonalBoosterResponseSchema.safeParse(
        await api.post<unknown>(`/admin/personal-booster/${userId}/quitar-acceso`),
      );
      if (!parsed.success) {
        throw respuestaInesperada('quitar_acceso', parsed.error);
      }
      setConfirmandoQuitar(null);
      // Una persona por confirmar nunca tuvo acceso: el API no avisa a la lista (SC10).
      setAccesoQuitado(
        persona.estado === 'pendiente_confirmacion'
          ? `Anulamos el código de confirmación de ${persona.nombre ?? persona.email}: no recibe acceso al panel.`
          : `Quitamos el acceso al panel a ${persona.nombre ?? persona.email}. Avisamos a la lista de respaldo.`,
      );
      void cargar();
    } catch (err) {
      setErrorQuitar({ userId, mensaje: mensajeError(err) });
    } finally {
      setQuitandoId(null);
    }
  }

  function precargar(correo: string) {
    setEmail(correo);
    setConfirmacion(null);
    setErrorAlta(null);
    setPedidosDeFoco((n) => n + 1);
  }

  const cerrarPanel = () => setPanel(null);

  return (
    <div className="mt-6 space-y-8">
      <OrdenDelAlta />

      <section className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <UserPlus className="mt-0.5 h-5 w-5 shrink-0 text-primary-700" aria-hidden />
          <div>
            <h2 className="font-semibold text-neutral-900">Dar de alta</h2>
            <p className="mt-1 max-w-2xl text-neutral-600 text-sm">
              Con su correo, nombre completo y RUT. No cargas su clave: la elige ella al activar.
            </p>
          </div>
        </div>

        {confirmacion === null ? (
          <form
            onSubmit={revisar}
            noValidate
            className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2"
          >
            <label className="flex flex-col gap-1 sm:col-span-2">
              <span className="font-medium text-neutral-700 text-sm">Correo</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="off"
                className="rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200"
                placeholder="persona@boosterchile.com"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-medium text-neutral-700 text-sm">Nombre completo</span>
              <input
                ref={nombreRef}
                type="text"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                autoComplete="off"
                className="rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200"
                placeholder="Ej: Javiera Soto"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-medium text-neutral-700 text-sm">RUT</span>
              <input
                type="text"
                value={rut}
                onChange={(e) => setRut(e.target.value)}
                autoComplete="off"
                className="rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200"
                placeholder="12.345.678-5"
              />
            </label>
            <div className="sm:col-span-2">
              <button
                type="submit"
                className="inline-flex items-center gap-2 rounded-md bg-primary-600 px-4 py-2 font-medium text-sm text-white hover:bg-primary-700 disabled:opacity-50"
              >
                Revisar datos
              </button>
            </div>
          </form>
        ) : (
          <div
            className="mt-4 rounded-lg border border-primary-200 bg-primary-50 p-4"
            data-testid="personal-confirmacion"
          >
            <div className="font-semibold text-neutral-900">Confirma el alta</div>
            <p className="mt-1 text-neutral-700 text-sm">
              Revisa los datos. Al crearla, la persona queda marcada como personal de Booster con
              acceso al panel, salvo que ya tenga cuenta en una empresa. Si no tiene cuenta, se crea
              con un código de activación de un solo uso que vence en 7 días; si ya tiene una
              activa, entra desde ya con su clave. Si su cuenta ya es de una empresa, queda marcada
              cuando confirme, con su sesión, el código que le entregues en persona.
            </p>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-neutral-600">Correo</dt>
              <dd className="text-neutral-900">{confirmacion.email}</dd>
              <dt className="text-neutral-600">Nombre completo</dt>
              <dd className="text-neutral-900">{confirmacion.full_name}</dd>
              <dt className="text-neutral-600">RUT</dt>
              <dd className="font-mono text-neutral-900">{formatRut(confirmacion.rut)}</dd>
            </dl>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={enviando}
                onClick={() => void crear(confirmacion)}
                className="inline-flex items-center gap-2 rounded-md bg-primary-600 px-4 py-2 font-medium text-sm text-white hover:bg-primary-700 disabled:opacity-50"
              >
                {enviando ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    Creando…
                  </>
                ) : (
                  'Crear cuenta'
                )}
              </button>
              <button
                type="button"
                disabled={enviando}
                onClick={() => setConfirmacion(null)}
                className="rounded-md border border-neutral-300 bg-white px-4 py-2 font-medium text-neutral-700 text-sm hover:bg-neutral-50 disabled:opacity-50"
              >
                Corregir datos
              </button>
            </div>
          </div>
        )}

        {errorAlta && (
          <div
            role="alert"
            className="mt-4 rounded-md border border-danger-200 bg-danger-50 p-3 text-danger-700 text-sm"
          >
            {errorAlta}
          </div>
        )}

        {panel?.tipo === 'codigo' && panel.origen === 'alta' && (
          <PanelCodigoEmitido key={panel.codigo} panel={panel} onCerrar={cerrarPanel} />
        )}
        {panel?.tipo === 'sin_codigo' && <PanelSinCodigo panel={panel} onCerrar={cerrarPanel} />}
      </section>

      <section className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <Users className="mt-0.5 h-5 w-5 shrink-0 text-primary-700" aria-hidden />
          <div>
            <h2 className="font-semibold text-neutral-900">Personal con acceso al panel</h2>
            <p className="mt-1 max-w-2xl text-neutral-600 text-sm">
              Las cuentas marcadas como personal de Booster y los correos de la lista de respaldo.
            </p>
          </div>
        </div>

        <div className="mt-4">
          {accesoQuitado !== null && (
            <output className="mb-3 block rounded-md border border-success-200 bg-success-50 p-3 text-sm text-success-700">
              {accesoQuitado}
            </output>
          )}
          {cargando && personal.length === 0 && (
            <div className="inline-flex items-center gap-2 text-neutral-500 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Cargando personal…
            </div>
          )}
          {errorLista && (
            <div
              role="alert"
              className="rounded-md border border-danger-200 bg-danger-50 p-3 text-danger-700 text-sm"
              data-testid="personal-lista-error"
            >
              {errorLista}
            </div>
          )}
          {!cargando && !errorLista && personal.length === 0 && (
            <p className="text-neutral-500 text-sm" data-testid="personal-lista-vacia">
              Todavía no hay personal de Booster registrado ni correos en la lista de respaldo.
            </p>
          )}
          {personal.length > 0 && (
            <ul className="divide-y divide-neutral-100">
              {personal.map((persona) => {
                const userId = persona.user_id;
                const puedeReemitir =
                  userId !== null &&
                  (persona.estado === 'pendiente_activacion' ||
                    persona.estado === 'pendiente_confirmacion');
                // Una fila con cuenta y fuera de la lista es una cuenta marcada:
                // el panel le quita el acceso. El de la lista se quita en Terraform.
                const puedeQuitar = userId !== null && !persona.en_lista;
                return (
                  <li
                    key={persona.email}
                    className="py-3"
                    data-testid={`personal-row-${persona.email}`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="break-all font-medium text-neutral-900">
                            {persona.email}
                          </span>
                          <span
                            className={`rounded-full border px-2 py-0.5 font-medium text-xs ${ESTADO_CLASE[persona.estado]}`}
                          >
                            {ESTADO_LABEL[persona.estado]}
                          </span>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-x-3 text-neutral-600 text-xs">
                          {persona.estado === 'sin_cuenta' ? (
                            <span>Nombre y RUT: se cargan al dar de alta</span>
                          ) : (
                            <>
                              <span>{persona.nombre ?? 'Sin nombre registrado'}</span>
                              <span className="font-mono">
                                {persona.rut === null
                                  ? 'RUT sin registrar'
                                  : formatRut(persona.rut)}
                              </span>
                            </>
                          )}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 text-neutral-600 text-xs">
                          {persona.en_lista && (
                            <span>
                              En la lista de respaldo: para quitarle el acceso, sácalo de Terraform
                              y después usa «Quitar acceso»
                            </span>
                          )}
                          <DetalleEstado persona={persona} />
                        </div>
                      </div>
                      <div className="flex shrink-0 gap-2">
                        {persona.estado === 'sin_cuenta' && (
                          <button
                            type="button"
                            onClick={() => precargar(persona.email)}
                            className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 font-medium text-neutral-700 text-sm hover:bg-neutral-50"
                          >
                            Dar de alta
                          </button>
                        )}
                        {puedeReemitir && (
                          <button
                            type="button"
                            disabled={reemitiendoId === userId}
                            onClick={() => void reemitir(persona, userId)}
                            className="rounded-md border border-amber-400 bg-amber-50 px-3 py-1.5 font-medium text-amber-950 text-sm hover:bg-amber-100 disabled:opacity-50"
                          >
                            {reemitiendoId === userId ? 'Generando…' : 'Generar código nuevo'}
                          </button>
                        )}
                        {puedeQuitar && confirmandoQuitar !== userId && (
                          <button
                            type="button"
                            onClick={() => {
                              setConfirmandoQuitar(userId);
                              setErrorQuitar(null);
                              setAccesoQuitado(null);
                            }}
                            className="inline-flex items-center gap-1 rounded-md border border-danger-200 bg-white px-3 py-1.5 font-medium text-danger-700 text-sm hover:bg-danger-50"
                          >
                            <UserMinus className="h-4 w-4" aria-hidden />
                            Quitar acceso
                          </button>
                        )}
                      </div>
                    </div>
                    {puedeQuitar && confirmandoQuitar === userId && (
                      <div
                        className="mt-3 rounded-md border border-danger-200 bg-danger-50 p-3 text-sm"
                        data-testid="personal-quitar-confirmacion"
                      >
                        <p className="font-medium text-danger-700">
                          {`¿Quitar el acceso al panel a ${persona.nombre ?? persona.email}?`}
                        </p>
                        <p className="mt-1 text-neutral-700">
                          {persona.estado === 'pendiente_confirmacion'
                            ? 'Todavía no confirmó su acceso, así que no entra al panel: su código de confirmación deja de servir. Su cuenta en la empresa no cambia.'
                            : 'Deja de entrar al panel desde su próxima acción. Su cuenta y su clave no cambian; si todavía no activó, su código deja de servir. Avisamos a la lista de respaldo.'}
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={quitandoId === userId}
                            onClick={() => void quitarAcceso(persona, userId)}
                            className="rounded-md bg-danger-600 px-3 py-1.5 font-medium text-sm text-white hover:bg-danger-700 disabled:opacity-50"
                          >
                            {quitandoId === userId ? 'Quitando…' : 'Sí, quitar acceso'}
                          </button>
                          <button
                            type="button"
                            disabled={quitandoId === userId}
                            onClick={() => {
                              setConfirmandoQuitar(null);
                              setErrorQuitar(null);
                            }}
                            className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 font-medium text-neutral-700 text-sm hover:bg-neutral-50 disabled:opacity-50"
                          >
                            Cancelar
                          </button>
                        </div>
                      </div>
                    )}
                    {errorQuitar !== null && errorQuitar.userId === userId && (
                      <p role="alert" className="mt-2 text-danger-700 text-sm">
                        {errorQuitar.mensaje}
                      </p>
                    )}
                    {errorReemision !== null && errorReemision.userId === userId && (
                      <p role="alert" className="mt-2 text-danger-700 text-sm">
                        {errorReemision.mensaje}
                      </p>
                    )}
                    {panel?.tipo === 'codigo' &&
                      panel.origen === 'reemision' &&
                      panel.userId === userId && (
                        <PanelCodigoEmitido
                          key={panel.codigo}
                          panel={panel}
                          onCerrar={cerrarPanel}
                        />
                      )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

/** El orden del alta, fijo en la pantalla (`.specs/acceso-panel-plataforma` SC12). */
function OrdenDelAlta() {
  return (
    <section
      className="rounded-lg border border-primary-200 bg-primary-50 p-5"
      data-testid="personal-orden-alta"
    >
      <div className="flex items-start gap-3">
        <KeyRound className="mt-0.5 h-5 w-5 shrink-0 text-primary-700" aria-hidden />
        <div>
          <h2 className="font-semibold text-neutral-900">Cómo se suma a alguien del equipo</h2>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-neutral-700 text-sm">
            <li>
              Crea la cuenta aquí con su correo, nombre completo y RUT. Desde ese momento queda
              marcada como personal de Booster, salvo que ya tenga cuenta en una empresa.
            </li>
            <li>
              Entrégale el código o usa «Generar código nuevo» en su fila: también se lo enviamos
              por correo. La persona lo usa en /activar con su RUT y elige su clave de 6 dígitos.
            </li>
            <li>
              Entra por /login con el tipo «Booster». Si ya tenía cuenta, entra con su clave de
              siempre.
            </li>
          </ol>
          <p className="mt-2 text-neutral-600 text-sm">
            Si ya tiene cuenta en una empresa, el alta te muestra un código de confirmación:
            entrégaselo en persona y ella lo ingresa con su sesión iniciada en Confirmar acceso de
            Booster. Queda con acceso al panel cuando lo confirma.
          </p>
          <p className="mt-2 text-neutral-600 text-sm">
            Para quitarle el acceso, usa «Quitar acceso» en su fila. Cada alta que da acceso y cada
            baja de quien tenía acceso se avisan a la lista de respaldo.
          </p>
        </div>
      </div>
    </section>
  );
}

function DetalleEstado({ persona }: { persona: PersonaDelPersonal }) {
  if (persona.estado === 'activa') {
    return (
      <span>
        {persona.ultimo_login_en === null
          ? 'Último ingreso: todavía no entra'
          : `Último ingreso: ${fechaHora(persona.ultimo_login_en)}`}
      </span>
    );
  }
  if (persona.estado === 'sin_cuenta') {
    return null;
  }
  const porConfirmar = persona.estado === 'pendiente_confirmacion';
  // Sin vencimiento: en una provisoria, el código actual no lo emitió el panel
  // y no activa a una cuenta del personal; en una persona por confirmar, el
  // código ya no tiene intentos (SC9). En ambos casos se pide uno nuevo.
  if (persona.expira_en === null) {
    return (
      <span>
        {porConfirmar
          ? 'El código de confirmación ya no sirve: usa «Generar código nuevo» para entregarle otro.'
          : 'Sin código vigente del panel: usa «Generar código nuevo» para entregarle uno.'}
      </span>
    );
  }
  const codigo = porConfirmar ? 'Código de confirmación' : 'Código';
  if (yaPaso(persona.expira_en)) {
    return (
      <span className="inline-flex items-center gap-1">
        <span>{`${codigo}: venció el ${fechaHora(persona.expira_en)}`}</span>
        <span className="rounded-full border border-danger-200 bg-danger-50 px-2 py-0.5 font-medium text-danger-700">
          vencido
        </span>
      </span>
    );
  }
  return <span>{`${codigo}: vence el ${fechaHora(persona.expira_en)}`}</span>;
}

function PanelCodigoEmitido({ panel, onCerrar }: { panel: CodigoEmitido; onCerrar: () => void }) {
  return panel.uso === 'confirmacion' ? (
    <PanelConfirmacion panel={panel} onCerrar={onCerrar} />
  ) : (
    <PanelCodigo panel={panel} onCerrar={onCerrar} />
  );
}

/** El código en grande. */
function CodigoEnPantalla({ codigo }: { codigo: string }) {
  return (
    <div
      className="flex-1 rounded-md border border-amber-300 bg-white px-3 py-2 text-center font-mono text-2xl text-neutral-900 tracking-[0.3em]"
      data-testid="personal-codigo"
    >
      {codigo}
    </div>
  );
}

/** El código en grande, con «Copiar código». */
function CodigoParaCopiar({ codigo }: { codigo: string }) {
  const [copia, setCopia] = useState<'pendiente' | 'copiado' | 'fallo'>('pendiente');

  async function copiar() {
    try {
      await navigator.clipboard.writeText(codigo);
      setCopia('copiado');
    } catch {
      // Sin portapapeles (http, permiso denegado): se avisa y el código sigue en pantalla.
      setCopia('fallo');
    }
  }

  return (
    <>
      <div className="mt-3 flex items-center gap-2">
        <CodigoEnPantalla codigo={codigo} />
        <button
          type="button"
          onClick={() => void copiar()}
          className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-md bg-amber-600 px-3 py-2 font-medium text-white text-xs transition hover:bg-amber-700"
        >
          <Copy className="h-3 w-3" aria-hidden />
          {copia === 'copiado' ? 'Copiado ✓' : 'Copiar código'}
        </button>
      </div>
      {copia === 'fallo' && (
        <p className="mt-2 text-amber-900 text-sm">
          No pudimos copiar. Selecciona el código y cópialo a mano.
        </p>
      )}
    </>
  );
}

function DatosDeLaPersona({ panel }: { panel: CodigoEmitido }) {
  return (
    <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
      <dt className="text-amber-800">Persona</dt>
      <dd className="text-neutral-900">{panel.nombre ?? panel.email}</dd>
      <dt className="text-amber-800">Correo</dt>
      <dd className="break-all text-neutral-900">{panel.email}</dd>
      <dt className="text-amber-800">RUT</dt>
      <dd className="font-mono text-neutral-900">
        {panel.rut === null ? 'Sin RUT registrado' : formatRut(panel.rut)}
      </dd>
    </dl>
  );
}

/** Código de activación de una sola vez, con el RUT y la dirección absoluta de `/activar`. */
function PanelCodigo({ panel, onCerrar }: { panel: CodigoEmitido; onCerrar: () => void }) {
  const direccion = urlActivar();

  return (
    <div
      className="mt-4 rounded-lg border-2 border-amber-300 bg-amber-50 p-4"
      data-testid="personal-codigo-panel"
    >
      <div className="font-semibold text-amber-900">
        {panel.origen === 'alta'
          ? 'Cuenta creada: código de activación'
          : 'Código de activación nuevo'}
      </div>
      {panel.origen === 'reemision' && (
        <p className="mt-1 text-amber-800 text-sm">
          El anterior deja de servir. El plazo de 7 días corre desde ahora.
        </p>
      )}
      <p className="mt-1 text-amber-800 text-sm">
        Se muestra una sola vez: cópialo o entrégalo antes de cerrar. Sirve para activar una vez y
        no es su clave.
      </p>
      <DatosDeLaPersona panel={panel} />
      <CodigoParaCopiar codigo={panel.codigo} />
      <p className="mt-2 text-amber-700 text-xs">Vence el {fechaHora(panel.expiraEn)}.</p>
      <p className="mt-2 text-amber-800 text-sm">
        La persona entra a{' '}
        <span className="break-all font-mono" data-testid="personal-url-activar">
          {direccion}
        </span>
        , escribe su RUT y este código, y elige su clave de 6 dígitos. Después entra por /login con
        el tipo «Booster».
      </p>
      <p className="mt-2 font-medium text-amber-900 text-sm" data-testid="personal-aviso-lista">
        {avisoDeLista(panel)}
      </p>
      <button
        type="button"
        onClick={onCerrar}
        className="mt-3 rounded-md border border-amber-400 bg-white px-3 py-1.5 font-medium text-amber-950 text-sm hover:bg-amber-100"
      >
        Listo, cerrar
      </button>
    </div>
  );
}

/**
 * Código de confirmación de una sola vez (`.specs/confirmar-acceso-booster`
 * SC16): la persona ya tiene cuenta en una empresa y confirma el acceso con su
 * sesión. No sale por correo y no sirve en `/activar`.
 */
function PanelConfirmacion({ panel, onCerrar }: { panel: CodigoEmitido; onCerrar: () => void }) {
  const direccion = urlConfirmarAccesoBooster();

  return (
    <div
      className="mt-4 rounded-lg border-2 border-amber-300 bg-amber-50 p-4"
      data-testid="personal-codigo-panel"
    >
      <div className="font-semibold text-amber-900">
        {panel.origen === 'alta' ? 'Código de confirmación' : 'Código de confirmación nuevo'}
      </div>
      <p
        className="mt-1 font-medium text-amber-900 text-sm"
        data-testid="personal-confirmacion-instruccion"
      >
        {INSTRUCCION_CONFIRMACION}
      </p>
      {panel.origen === 'reemision' && (
        <p className="mt-1 text-amber-800 text-sm">
          {`El anterior deja de servir. El plazo de ${CONFIRMACION_ACCESO_BOOSTER_VIGENCIA_HORAS} horas corre desde ahora.`}
        </p>
      )}
      <p className="mt-1 text-amber-800 text-sm">
        Se muestra una sola vez: anótalo o entrégaselo antes de cerrar. Hasta que lo confirme, la
        persona no tiene acceso al panel.
      </p>
      <DatosDeLaPersona panel={panel} />
      {/* Sin «Copiar código»: se entrega en persona, no por un canal. */}
      <div className="mt-3 flex">
        <CodigoEnPantalla codigo={panel.codigo} />
      </div>
      <p className="mt-2 text-amber-700 text-xs">Vence el {fechaHora(panel.expiraEn)}.</p>
      <p className="mt-2 text-amber-800 text-sm">
        La persona inicia sesión con su RUT y su clave de siempre, entra a{' '}
        <span className="break-all font-mono" data-testid="personal-url-confirmar">
          {direccion}
        </span>{' '}
        y escribe este código.
      </p>
      <button
        type="button"
        onClick={onCerrar}
        className="mt-3 rounded-md border border-amber-400 bg-white px-3 py-1.5 font-medium text-amber-950 text-sm hover:bg-amber-100"
      >
        Listo, cerrar
      </button>
    </div>
  );
}

/**
 * Provisoria con un código del panel vigente (SC3): la API lo conserva solo
 * en ese caso; sin código, con uno que no emitió el panel o con el del panel
 * vencido, emite uno nuevo y la respuesta lo trae. No se reemplaza ni se
 * vuelve a mostrar.
 */
function PanelCodigoPendiente({ panel }: { panel: AltaSinCodigo }) {
  return (
    <>
      <div className="font-semibold text-amber-900">Esta persona ya tiene un código vigente</div>
      <p className="mt-1 text-amber-800 text-sm">
        Lo emitió este panel y sigue vigente: no lo reemplazamos y no lo volvemos a mostrar. Si no
        lo tienes a mano, usa «Generar código nuevo» en su fila de la lista: el anterior deja de
        servir.
      </p>
      {panel.expiraEn !== null && (
        <p className="mt-1 text-amber-700 text-xs">Vence el {fechaHora(panel.expiraEn)}.</p>
      )}
    </>
  );
}

/** Alta de alguien que ya existía: no se emite código (SC3). */
function PanelSinCodigo({ panel, onCerrar }: { panel: AltaSinCodigo; onCerrar: () => void }) {
  return (
    <div
      className="mt-4 rounded-lg border-2 border-amber-300 bg-amber-50 p-4"
      data-testid="personal-vinculo-panel"
    >
      {panel.vinculo === 'cuenta_activa' ? (
        <>
          <div className="font-semibold text-amber-900">Esta persona ya tiene cuenta</div>
          <p className="mt-1 text-amber-800 text-sm">
            La marcamos como personal de Booster: desde ya entra a este panel con su RUT y su clave
            de siempre, por /login con el tipo «Booster». No se generó código: su clave no cambia.
          </p>
          <p className="mt-2 font-medium text-amber-900 text-sm">
            Confirma con la persona que esta cuenta es suya: quien entra con ese RUT y esa clave
            tiene acceso al panel. Si no corresponde, usa «Quitar acceso» en su fila.
          </p>
        </>
      ) : (
        <PanelCodigoPendiente panel={panel} />
      )}
      <button
        type="button"
        onClick={onCerrar}
        className="mt-3 rounded-md border border-amber-400 bg-white px-3 py-1.5 font-medium text-amber-950 text-sm hover:bg-amber-100"
      >
        Cerrar
      </button>
    </div>
  );
}
