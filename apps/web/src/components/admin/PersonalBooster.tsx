import {
  type AltaPersonalBooster,
  type AltaPersonalBoosterResponse,
  type PersonalBooster as PersonaDelPersonal,
  type PersonalBoosterErrorCode,
  type PersonalBoosterEstado,
  type VinculoPersonalBooster,
  altaPersonalBoosterResponseSchema,
  altaPersonalBoosterSchema,
  ensureRutHasDash,
  listaPersonalBoosterResponseSchema,
  personalBoosterErrorCodeSchema,
  reemitirCodigoPersonalBoosterResponseSchema,
} from '@booster-ai/shared-schemas';
import { Copy, KeyRound, Loader2, UserPlus, Users } from 'lucide-react';
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import type { ZodError } from 'zod';
import { urlActivar } from '../../lib/activar-url.js';
import { ApiError, api } from '../../lib/api-client.js';
import { logger } from '../../lib/logger.js';
import { formatRut } from '../../lib/rut.js';

/**
 * Platform-admin: alta del personal de Booster con acceso al panel
 * (`.specs/alta-personal-booster/spec.md`, SC1, SC2, SC5 y SC10).
 *
 * La lista de Terraform (`booster_platform_admin_emails`) sigue decidiendo
 * quién entra al panel. Aquí el admin crea la cuenta con correo, nombre y RUT;
 * la persona elige su clave en `/activar` con un código de un solo uso. El
 * orden es: alta aquí → el PO agrega el correo a la lista y aplica → la
 * persona activa.
 *
 * El código llega solo en la respuesta del alta o de la re-emisión y se
 * muestra una sola vez: al cerrar el panel, o al emitir otro, deja de estar
 * en pantalla. La lista nunca lo trae.
 */

const LISTA_TERRAFORM = 'booster_platform_admin_emails';

const AVISO_AGREGAR_A_LISTA = `Agrega este correo a la lista de Terraform (${LISTA_TERRAFORM}) y aplica; recién entonces la persona podrá activar. Si el código vence antes, genera uno nuevo aquí.`;
// La API no informa si el proveedor de correo entregó el mensaje: el aviso no
// lo afirma y pide entregar el código a mano si no llega.
const AVISO_CORREO_ENVIADO =
  'Intentamos enviarle el código por correo a esa dirección. Si no le llega, entrégaselo tú: cópialo antes de cerrar.';
const AVISO_SIN_RUT =
  'No enviamos el correo: la cuenta no tiene RUT registrado y sin RUT no puede activar. Repárala con el script de bootstrap del runbook.';

const ESTADO_LABEL: Record<PersonalBoosterEstado, string> = {
  sin_cuenta: 'Sin cuenta',
  pendiente_activacion: 'Pendiente de activar',
  activa: 'Activa',
};

const ESTADO_CLASE: Record<PersonalBoosterEstado, string> = {
  sin_cuenta: 'border-neutral-300 bg-neutral-100 text-neutral-700',
  pendiente_activacion: 'border-amber-300 bg-amber-50 text-amber-900',
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
  /** El alta lo muestra bajo el formulario; la re-emisión, en la fila. */
  origen: 'alta' | 'reemision';
  userId: string;
  email: string;
  nombre: string | null;
  rut: string | null;
  codigo: string;
  expiraEn: string;
  enLista: boolean;
}

interface AltaSinCodigo {
  tipo: 'sin_codigo';
  vinculo: Extract<VinculoPersonalBooster, 'cuenta_activa' | 'codigo_vigente'>;
  expiraEn: string | null;
  enLista: boolean;
}

type Panel = CodigoEmitido | AltaSinCodigo;

function panelDelAlta(res: AltaPersonalBoosterResponse, datos: AltaPersonalBooster): Panel {
  if (res.codigo_activacion !== null && res.expira_en !== null) {
    return {
      tipo: 'codigo',
      origen: 'alta',
      userId: res.user_id,
      email: datos.email,
      nombre: datos.full_name,
      rut: datos.rut,
      codigo: res.codigo_activacion,
      expiraEn: res.expira_en,
      enLista: res.en_lista,
    };
  }
  if (res.vinculo === 'cuenta_activa' || res.vinculo === 'codigo_vigente') {
    return {
      tipo: 'sin_codigo',
      vinculo: res.vinculo,
      expiraEn: res.expira_en,
      enLista: res.en_lista,
    };
  }
  // El schema exige código en `nueva` y `provisoria_sin_codigo`: no se llega aquí.
  throw new RespuestaInesperadaError();
}

function avisoDeLista(panel: CodigoEmitido): string {
  // Sin RUT no puede activar aunque el correo esté en la lista: ese aviso va primero.
  if (panel.rut === null) {
    return AVISO_SIN_RUT;
  }
  if (!panel.enLista) {
    return AVISO_AGREGAR_A_LISTA;
  }
  return AVISO_CORREO_ENVIADO;
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
        origen: 'reemision',
        userId,
        email: persona.email,
        nombre: persona.nombre,
        rut: persona.rut,
        codigo: parsed.data.codigo_activacion,
        expiraEn: parsed.data.expira_en,
        enLista: parsed.data.en_lista,
      });
      void cargar();
    } catch (err) {
      setErrorReemision({ userId, mensaje: mensajeError(err) });
    } finally {
      setReemitiendoId(null);
    }
  }

  function precargar(correo: string) {
    setEmail(correo);
    setConfirmacion(null);
    setErrorAlta(null);
    setPedidosDeFoco((n) => n + 1);
  }

  const cerrarPanel = () => setPanel(null);
  const enListaConfirmacion =
    confirmacion === null || errorLista !== null
      ? null
      : personal.some((p) => p.email.toLowerCase() === confirmacion.email && p.en_lista);

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
              Revisa los datos. Si la persona no tiene cuenta, se crea con un código de activación
              de un solo uso que vence en 7 días.
            </p>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-neutral-600">Correo</dt>
              <dd className="text-neutral-900">{confirmacion.email}</dd>
              <dt className="text-neutral-600">Nombre completo</dt>
              <dd className="text-neutral-900">{confirmacion.full_name}</dd>
              <dt className="text-neutral-600">RUT</dt>
              <dd className="font-mono text-neutral-900">{formatRut(confirmacion.rut)}</dd>
            </dl>
            {enListaConfirmacion !== null && (
              <p className="mt-3 text-neutral-700 text-sm">
                {enListaConfirmacion
                  ? 'Este correo ya está en la lista de Terraform: podrá activar apenas tenga el código.'
                  : 'Este correo todavía no está en la lista de Terraform: después del alta, hay que agregarlo y aplicar para que la persona pueda activar.'}
              </p>
            )}
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
          <PanelCodigo key={panel.codigo} panel={panel} onCerrar={cerrarPanel} />
        )}
        {panel?.tipo === 'sin_codigo' && <PanelSinCodigo panel={panel} onCerrar={cerrarPanel} />}
      </section>

      <section className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <Users className="mt-0.5 h-5 w-5 shrink-0 text-primary-700" aria-hidden />
          <div>
            <h2 className="font-semibold text-neutral-900">Personal con acceso al panel</h2>
            <p className="mt-1 max-w-2xl text-neutral-600 text-sm">
              Los correos de la lista de Terraform y las cuentas marcadas como personal de Booster.
            </p>
          </div>
        </div>

        <div className="mt-4">
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
              Todavía no hay personal de Booster registrado ni correos en la lista de Terraform.
            </p>
          )}
          {personal.length > 0 && (
            <ul className="divide-y divide-neutral-100">
              {personal.map((persona) => {
                const userId = persona.user_id;
                const puedeReemitir = userId !== null && persona.estado === 'pendiente_activacion';
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
                          <span>
                            {persona.en_lista
                              ? 'En la lista de Terraform: sí'
                              : 'En la lista de Terraform: no'}
                          </span>
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
                      </div>
                    </div>
                    {errorReemision !== null && errorReemision.userId === userId && (
                      <p role="alert" className="mt-2 text-danger-700 text-sm">
                        {errorReemision.mensaje}
                      </p>
                    )}
                    {panel?.tipo === 'codigo' &&
                      panel.origen === 'reemision' &&
                      panel.userId === userId && (
                        <PanelCodigo key={panel.codigo} panel={panel} onCerrar={cerrarPanel} />
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

/** SC10: el orden del alta, fijo en la pantalla. */
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
              Crea la cuenta aquí con su correo, nombre completo y RUT. Desde ese momento el correo
              queda reservado para esa persona.
            </li>
            <li>
              El PO agrega el correo a la lista de Terraform ({LISTA_TERRAFORM}) y la aplica. Esa
              lista decide quién entra a este panel.
            </li>
            <li>
              Con el correo ya en la lista, entrégale el código o usa «Generar código nuevo» en su
              fila: también intentamos enviárselo por correo. La persona lo usa en /activar con su
              RUT, elige su clave de 6 dígitos y entra por /login con el tipo «Booster».
            </li>
          </ol>
          <p className="mt-2 text-neutral-600 text-sm">
            Mientras el correo no esté en la lista, lo verás marcado con «En la lista de Terraform:
            no» y no le enviamos el código por correo.
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
  // Sin vencimiento, el código actual no lo emitió el panel y no activa a una
  // cuenta del personal: se pide uno nuevo desde esta fila.
  if (persona.expira_en === null) {
    return (
      <span>Sin código vigente del panel: usa «Generar código nuevo» para entregarle uno.</span>
    );
  }
  if (yaPaso(persona.expira_en)) {
    return (
      <span className="inline-flex items-center gap-1">
        <span>{`Código: venció el ${fechaHora(persona.expira_en)}`}</span>
        <span className="rounded-full border border-danger-200 bg-danger-50 px-2 py-0.5 font-medium text-danger-700">
          vencido
        </span>
      </span>
    );
  }
  return <span>{`Código: vence el ${fechaHora(persona.expira_en)}`}</span>;
}

/** Código de una sola vez, con el RUT y la dirección absoluta de `/activar`. */
function PanelCodigo({ panel, onCerrar }: { panel: CodigoEmitido; onCerrar: () => void }) {
  const [copia, setCopia] = useState<'pendiente' | 'copiado' | 'fallo'>('pendiente');
  const direccion = urlActivar();

  async function copiar() {
    try {
      await navigator.clipboard.writeText(panel.codigo);
      setCopia('copiado');
    } catch {
      // Sin portapapeles (http, permiso denegado): se avisa y el código sigue en pantalla.
      setCopia('fallo');
    }
  }

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
      <div className="mt-3 flex items-center gap-2">
        <div
          className="flex-1 rounded-md border border-amber-300 bg-white px-3 py-2 text-center font-mono text-2xl text-neutral-900 tracking-[0.3em]"
          data-testid="personal-codigo"
        >
          {panel.codigo}
        </div>
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
      {!panel.enLista && (
        <p className="mt-2 font-medium text-amber-900 text-sm">{AVISO_AGREGAR_A_LISTA}</p>
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
          {panel.enLista ? (
            <p className="mt-1 text-amber-800 text-sm">
              La marcamos como personal de Booster. Entra con su RUT y su clave de siempre por
              /login, con el tipo «Booster». No se generó código: su clave no cambia.
            </p>
          ) : (
            <>
              <p className="mt-1 text-amber-800 text-sm">
                Sigue entrando con su RUT y su clave de siempre. No se generó código: su clave no
                cambia.
              </p>
              <p className="mt-2 font-medium text-amber-900 text-sm">
                Su correo todavía no está en la lista de Terraform ({LISTA_TERRAFORM}), así que no
                la marcamos como personal: hasta entonces sigue en el inicio de su empresa, como
                siempre. Cuando el PO agregue el correo y aplique, entra a este panel con el tipo
                «Booster»; repite el alta en ese momento para dejarla marcada.
              </p>
            </>
          )}
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
