import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../../lib/api-client.js';
import { logger } from '../../lib/logger.js';
import { PersonalBooster } from './PersonalBooster.js';

/**
 * T7 (`.specs/alta-personal-booster/spec.md`, SC1, SC2, SC5 y SC10) — panel
 * del personal de Booster en `/app/platform-admin/personal`.
 *
 * Cubre la lista con sus estados, el alta con confirmación, el código que se
 * muestra una sola vez junto a la dirección de `/activar`, la re-emisión por
 * fila, «Quitar acceso» (`.specs/acceso-panel-plataforma` SC12) y los mensajes
 * de error por código.
 */

vi.mock('../../lib/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

const USER_ACTIVA = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const USER_PENDIENTE = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
const USER_VENCIDA = '0f8fad5b-d9cb-469f-a165-70867728950e';
const USER_NUEVA = '9a1d4c6e-2b7f-4e3a-8c5d-1f2e3a4b5c6d';

const ANA = {
  email: 'ana@boosterchile.com',
  en_lista: true,
  user_id: USER_ACTIVA,
  nombre: 'Ana Rojas',
  rut: '11111111-1',
  estado: 'activa' as const,
  expira_en: null,
  ultimo_login_en: '2026-10-29T15:30:00.000Z',
};

const BETO = {
  email: 'beto@boosterchile.com',
  en_lista: false,
  user_id: USER_PENDIENTE,
  nombre: 'Beto Soto',
  rut: '12345678-5',
  estado: 'pendiente_activacion' as const,
  expira_en: '2099-11-06T16:00:00.000Z',
  ultimo_login_en: null,
};

const CARLA = {
  email: 'carla@boosterchile.com',
  en_lista: true,
  user_id: null,
  nombre: null,
  rut: null,
  estado: 'sin_cuenta' as const,
  expira_en: null,
  ultimo_login_en: null,
};

const DANI = {
  email: 'dani@boosterchile.com',
  en_lista: true,
  user_id: USER_VENCIDA,
  nombre: 'Dani Paz',
  rut: '33333333-3',
  estado: 'pendiente_activacion' as const,
  expira_en: '2020-01-01T12:00:00.000Z',
  ultimo_login_en: null,
};

const LISTA = { personal: [ANA, BETO, CARLA, DANI] };

const AVISO_CORREO =
  'Intentamos enviarle el código por correo a esa dirección. Si no le llega, entrégaselo tú: cópialo antes de cerrar.';

/** `.specs/confirmar-acceso-booster` SC16: lo que el admin lee junto al código de confirmación. */
const INSTRUCCION_CONFIRMACION =
  'Esta persona ya tiene cuenta en una empresa. Entrégale este código en persona: lo ingresa con su sesión iniciada en Confirmar acceso de Booster. No lo envíes por correo ni por chat.';

const USER_FELI = 'b3e1c2d4-5f6a-4b7c-8d9e-0f1a2b3c4d5e';
const USER_GABI = 'c4f2d3e5-6a7b-4c8d-9e0f-1a2b3c4d5e6f';
const USER_HANS = 'd5a3e4f6-7b8c-4d9e-8f1a-2b3c4d5e6f7a';

/** Cuenta de una empresa dada de alta en el panel, con su confirmación vigente. */
const FELI = {
  email: 'feli@transportesuno.cl',
  en_lista: false,
  user_id: USER_FELI,
  nombre: 'Feli Lagos',
  rut: '44444444-4',
  estado: 'pendiente_confirmacion' as const,
  expira_en: '2099-11-10T16:00:00.000Z',
  ultimo_login_en: null,
};

const GABI = {
  ...FELI,
  email: 'gabi@transportesuno.cl',
  user_id: USER_GABI,
  nombre: 'Gabi Mora',
  rut: '55555555-5',
  expira_en: '2020-01-01T12:00:00.000Z',
};

/** Confirmación sin intentos: el API no informa vencimiento. */
const HANS = {
  ...FELI,
  email: 'hans@transportesuno.cl',
  user_id: USER_HANS,
  nombre: 'Hans Vidal',
  rut: '66666666-6',
  expira_en: null,
};

const LISTA_CON_CONFIRMACION = { personal: [ANA, BETO, FELI, GABI, HANS] };

function stubClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
}

function fila(email: string): HTMLElement {
  return screen.getByTestId(`personal-row-${email}`);
}

async function renderConLista(lista: unknown = LISTA) {
  const get = vi.spyOn(api, 'get').mockResolvedValue(lista);
  render(<PersonalBooster />);
  await screen.findByTestId(`personal-row-${ANA.email}`);
  return get;
}

function llenarFormulario(datos: { email: string; nombre: string; rut: string }) {
  fireEvent.change(screen.getByLabelText('Correo'), { target: { value: datos.email } });
  fireEvent.change(screen.getByLabelText('Nombre completo'), { target: { value: datos.nombre } });
  fireEvent.change(screen.getByLabelText('RUT'), { target: { value: datos.rut } });
}

const EVA = { email: ' Eva@BoosterChile.com ', nombre: 'Eva Muñoz', rut: '22.222.222-2' };
const BODY_EVA = { email: 'eva@boosterchile.com', full_name: 'Eva Muñoz', rut: '22222222-2' };

async function altaHastaConfirmar(datos = EVA) {
  llenarFormulario(datos);
  fireEvent.click(screen.getByRole('button', { name: 'Revisar datos' }));
  return await screen.findByTestId('personal-confirmacion');
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('PersonalBooster — lista (SC1)', () => {
  it('lista al personal con correo, nombre, RUT, la lista de respaldo y el estado legible', async () => {
    const get = await renderConLista();

    expect(get).toHaveBeenCalledWith('/admin/personal-booster');

    const ana = fila(ANA.email);
    expect(within(ana).getByText('Ana Rojas')).toBeInTheDocument();
    expect(within(ana).getByText(/ana@boosterchile\.com/)).toBeInTheDocument();
    expect(within(ana).getByText(/11\.111\.111-1/)).toBeInTheDocument();
    expect(
      within(ana).getByText(
        /En la lista de respaldo: para quitarle el acceso, sácalo de Terraform/,
      ),
    ).toBeInTheDocument();
    expect(within(ana).getByText('Activa')).toBeInTheDocument();

    const beto = fila(BETO.email);
    expect(within(beto).getByText('Pendiente de activar')).toBeInTheDocument();
    expect(within(beto).queryByText(/lista de respaldo/)).not.toBeInTheDocument();

    const carla = fila(CARLA.email);
    expect(within(carla).getByText('Sin cuenta')).toBeInTheDocument();
    expect(
      within(carla).getByText(
        /En la lista de respaldo: para quitarle el acceso, sácalo de Terraform/,
      ),
    ).toBeInTheDocument();
  });

  it('muestra el vencimiento, marca el código vencido y el último ingreso', async () => {
    await renderConLista();

    const beto = fila(BETO.email);
    expect(within(beto).getByText(/Código: vence el/)).toBeInTheDocument();
    expect(within(beto).queryByText('vencido')).not.toBeInTheDocument();

    const dani = fila(DANI.email);
    expect(within(dani).getByText(/Código: venció el/)).toBeInTheDocument();
    expect(within(dani).getByText('vencido')).toBeInTheDocument();

    const ana = fila(ANA.email);
    expect(within(ana).getByText(/Último ingreso:/)).toBeInTheDocument();
    expect(within(ana).queryByText(/Código:/)).not.toBeInTheDocument();
  });

  it('una cuenta activa que nunca entró y una pendiente sin código del panel lo dicen', async () => {
    await renderConLista({
      personal: [
        ANA,
        { ...ANA, email: 'eli@boosterchile.com', ultimo_login_en: null },
        { ...BETO, email: 'fer@boosterchile.com', expira_en: null },
      ],
    });

    expect(
      within(fila('eli@boosterchile.com')).getByText('Último ingreso: todavía no entra'),
    ).toBeInTheDocument();
    // Sin vencimiento, el código actual no es del panel: no activa a una cuenta
    // marcada. La fila no lo presenta como un código válido sin plazo.
    const fer = fila('fer@boosterchile.com');
    expect(
      within(fer).getByText(
        'Sin código vigente del panel: usa «Generar código nuevo» para entregarle uno.',
      ),
    ).toBeInTheDocument();
    expect(within(fer).queryByText(/sin vencimiento registrado/)).not.toBeInTheDocument();
  });

  it('avisa cuando todavía no hay personal', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ personal: [] });
    render(<PersonalBooster />);
    expect(await screen.findByTestId('personal-lista-vacia')).toBeInTheDocument();
  });

  it('muestra un error legible si la lista no carga', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(
      new ApiError(
        403,
        undefined,
        { error: 'forbidden_platform_admin' },
        'forbidden_platform_admin',
      ),
    );
    render(<PersonalBooster />);
    expect(await screen.findByTestId('personal-lista-error')).toHaveTextContent(
      'Tu cuenta no tiene acceso a esta función del panel.',
    );
  });

  it('rechaza una respuesta con formato inesperado y lo reporta', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ personal: [{ email: 1 }] });
    render(<PersonalBooster />);
    expect(await screen.findByTestId('personal-lista-error')).toHaveTextContent(
      'La respuesta del servidor no tiene el formato esperado.',
    );
    expect(logger.error).toHaveBeenCalled();
  });

  it('Generar código nuevo solo aparece en las filas pendientes', async () => {
    await renderConLista();

    expect(
      within(fila(BETO.email)).getByRole('button', { name: 'Generar código nuevo' }),
    ).toBeInTheDocument();
    expect(
      within(fila(DANI.email)).getByRole('button', { name: 'Generar código nuevo' }),
    ).toBeInTheDocument();
    expect(
      within(fila(ANA.email)).queryByRole('button', { name: 'Generar código nuevo' }),
    ).not.toBeInTheDocument();
    expect(
      within(fila(CARLA.email)).queryByRole('button', { name: 'Generar código nuevo' }),
    ).not.toBeInTheDocument();
  });
});

describe('PersonalBooster — orden del alta (acceso-panel-plataforma SC12)', () => {
  it('explica el orden: cuenta en el panel, /activar y login, sin paso de Terraform', async () => {
    await renderConLista();

    const orden = screen.getByTestId('personal-orden-alta');
    const pasos = within(orden).getAllByRole('listitem');
    expect(pasos).toHaveLength(3);
    expect(pasos[0]).toHaveTextContent('Crea la cuenta aquí');
    expect(pasos[1]).toHaveTextContent('/activar');
    expect(pasos[2]).toHaveTextContent('/login');
    expect(orden).not.toHaveTextContent('booster_platform_admin_emails');
    expect(orden).toHaveTextContent('Quitar acceso');
  });

  it('explica el caso de una cuenta que ya es de una empresa (confirmar-acceso-booster SC16)', async () => {
    await renderConLista();

    const orden = screen.getByTestId('personal-orden-alta');
    expect(orden).toHaveTextContent('Si ya tiene cuenta en una empresa');
    expect(orden).toHaveTextContent('Confirmar acceso de Booster');
  });
});

describe('PersonalBooster — alta (SC2)', () => {
  it('valida el RUT antes de confirmar y no llama al POST', async () => {
    await renderConLista();
    const post = vi.spyOn(api, 'post');

    llenarFormulario({ ...EVA, rut: '12345678-0' });
    fireEvent.click(screen.getByRole('button', { name: 'Revisar datos' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('RUT inválido (ej: 12.345.678-5).');
    expect(screen.queryByTestId('personal-confirmacion')).not.toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it('valida el correo y el nombre antes de confirmar', async () => {
    await renderConLista();

    llenarFormulario({ ...EVA, email: 'sin-arroba' });
    fireEvent.click(screen.getByRole('button', { name: 'Revisar datos' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Revisa el correo: no parece una dirección válida.',
    );

    llenarFormulario({ ...EVA, nombre: 'E' });
    fireEvent.click(screen.getByRole('button', { name: 'Revisar datos' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Escribe el nombre completo (entre 2 y 200 caracteres).',
    );
  });

  it('muestra una confirmación con todos los datos antes de crear', async () => {
    await renderConLista();
    const post = vi.spyOn(api, 'post');

    const confirmacion = await altaHastaConfirmar();

    expect(within(confirmacion).getByText('eva@boosterchile.com')).toBeInTheDocument();
    expect(within(confirmacion).getByText('Eva Muñoz')).toBeInTheDocument();
    expect(within(confirmacion).getByText('22.222.222-2')).toBeInTheDocument();
    expect(confirmacion).toHaveTextContent('queda marcada como personal de Booster');
    // confirmar-acceso-booster SC16: la cuenta de una empresa confirma con un código.
    expect(confirmacion).toHaveTextContent('Si su cuenta ya es de una empresa');
    expect(confirmacion).not.toHaveTextContent('Terraform');
    expect(post).not.toHaveBeenCalled();

    fireEvent.click(within(confirmacion).getByRole('button', { name: 'Corregir datos' }));
    expect(screen.queryByTestId('personal-confirmacion')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Nombre completo')).toHaveValue('Eva Muñoz');
  });

  it('al confirmar crea la cuenta y muestra el código una sola vez con la dirección de /activar', async () => {
    const get = await renderConLista();
    const post = vi.spyOn(api, 'post').mockResolvedValue({
      ok: true,
      user_id: USER_NUEVA,
      vinculo: 'nueva',
      codigo_activacion: '482915',
      expira_en: '2026-11-06T16:00:00.000Z',
      en_lista: false,
    });

    const confirmacion = await altaHastaConfirmar();
    fireEvent.click(within(confirmacion).getByRole('button', { name: 'Crear cuenta' }));

    const panel = await screen.findByTestId('personal-codigo-panel');
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('/admin/personal-booster', BODY_EVA);

    expect(screen.getAllByText('482915')).toHaveLength(1);
    expect(within(panel).getByTestId('personal-codigo')).toHaveTextContent('482915');
    expect(within(panel).getByText('22.222.222-2')).toBeInTheDocument();
    expect(within(panel).getByTestId('personal-url-activar')).toHaveTextContent(
      `${window.location.origin}/activar`,
    );
    expect(within(panel).getByText(/Vence el/)).toBeInTheDocument();
    // La lista ya no es condición: el código sale por correo igual.
    expect(within(panel).getByTestId('personal-aviso-lista')).toHaveTextContent(AVISO_CORREO);
    expect(panel).toHaveTextContent('Se muestra una sola vez');

    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId('personal-confirmacion')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Correo')).toHaveValue('');

    fireEvent.click(within(panel).getByRole('button', { name: 'Listo, cerrar' }));
    expect(screen.queryByText('482915')).not.toBeInTheDocument();
    expect(screen.queryByTestId('personal-codigo-panel')).not.toBeInTheDocument();
  });

  it('con el correo en la lista avisa que el código salió por correo', async () => {
    await renderConLista();
    vi.spyOn(api, 'post').mockResolvedValue({
      ok: true,
      user_id: USER_NUEVA,
      vinculo: 'nueva',
      codigo_activacion: '482915',
      expira_en: '2026-11-06T16:00:00.000Z',
      en_lista: true,
    });

    const confirmacion = await altaHastaConfirmar();
    fireEvent.click(within(confirmacion).getByRole('button', { name: 'Crear cuenta' }));

    const aviso = await screen.findByTestId('personal-aviso-lista');
    expect(aviso).toHaveTextContent(AVISO_CORREO);
    expect(aviso).not.toHaveTextContent('Agrega este correo');
  });

  it('cuenta_activa: no hay código y lo explica', async () => {
    await renderConLista();
    vi.spyOn(api, 'post').mockResolvedValue({
      ok: true,
      user_id: USER_ACTIVA,
      vinculo: 'cuenta_activa',
      codigo_activacion: null,
      expira_en: null,
      en_lista: false,
    });

    const confirmacion = await altaHastaConfirmar();
    fireEvent.click(within(confirmacion).getByRole('button', { name: 'Crear cuenta' }));

    const panel = await screen.findByTestId('personal-vinculo-panel');
    expect(panel).toHaveTextContent('Esta persona ya tiene cuenta');
    expect(panel).toHaveTextContent('su clave no cambia');
    // SC3 y SC12: queda con acceso desde ya, y el panel pide confirmarlo.
    expect(panel).toHaveTextContent('La marcamos como personal de Booster');
    expect(panel).toHaveTextContent('Confirma con la persona que esta cuenta es suya');
    expect(panel).toHaveTextContent('Quitar acceso');
    expect(panel).not.toHaveTextContent('booster_platform_admin_emails');
    expect(screen.queryByTestId('personal-codigo')).not.toBeInTheDocument();

    fireEvent.click(within(panel).getByRole('button', { name: 'Cerrar' }));
    expect(screen.queryByTestId('personal-vinculo-panel')).not.toBeInTheDocument();
  });

  it('cuenta_activa en la lista dice lo mismo: no hay paso de Terraform', async () => {
    await renderConLista();
    vi.spyOn(api, 'post').mockResolvedValue({
      ok: true,
      user_id: USER_ACTIVA,
      vinculo: 'cuenta_activa',
      codigo_activacion: null,
      expira_en: null,
      en_lista: true,
    });

    const confirmacion = await altaHastaConfirmar();
    fireEvent.click(within(confirmacion).getByRole('button', { name: 'Crear cuenta' }));

    const panel = await screen.findByTestId('personal-vinculo-panel');
    expect(panel).toHaveTextContent('La marcamos como personal de Booster');
    expect(panel).not.toHaveTextContent('booster_platform_admin_emails');
  });

  it('codigo_vigente: el código vigente es del panel; no lo reemplaza y apunta a Generar código nuevo', async () => {
    await renderConLista();
    vi.spyOn(api, 'post').mockResolvedValue({
      ok: true,
      user_id: USER_PENDIENTE,
      vinculo: 'codigo_vigente',
      codigo_activacion: null,
      expira_en: '2099-11-06T16:00:00.000Z',
      en_lista: false,
    });

    const confirmacion = await altaHastaConfirmar({
      email: BETO.email,
      nombre: 'Beto Soto',
      rut: '12345678-5',
    });
    fireEvent.click(within(confirmacion).getByRole('button', { name: 'Crear cuenta' }));

    const panel = await screen.findByTestId('personal-vinculo-panel');
    expect(panel).toHaveTextContent('Esta persona ya tiene un código vigente');
    expect(panel).toHaveTextContent('Lo emitió este panel y sigue vigente');
    expect(panel).toHaveTextContent('Si no lo tienes a mano, usa «Generar código nuevo»');
    expect(panel).toHaveTextContent('el anterior deja de servir');
    expect(panel).not.toHaveTextContent('Si no se lo entregaste tú');
    expect(panel).not.toHaveTextContent('vencido');
    expect(panel).toHaveTextContent(/Vence el/);
    expect(panel).not.toHaveTextContent('Terraform');
    expect(screen.queryByTestId('personal-codigo')).not.toBeInTheDocument();
  });

  it('codigo_vigente sin vencimiento y en la lista no inventa una fecha', async () => {
    await renderConLista();
    vi.spyOn(api, 'post').mockResolvedValue({
      ok: true,
      user_id: USER_PENDIENTE,
      vinculo: 'codigo_vigente',
      codigo_activacion: null,
      expira_en: null,
      en_lista: true,
    });

    const confirmacion = await altaHastaConfirmar();
    fireEvent.click(within(confirmacion).getByRole('button', { name: 'Crear cuenta' }));

    const panel = await screen.findByTestId('personal-vinculo-panel');
    expect(panel).not.toHaveTextContent(/Vence el/);
    expect(panel).not.toHaveTextContent('booster_platform_admin_emails');
  });

  it('Dar de alta en una fila sin cuenta precarga el correo y lleva a la confirmación', async () => {
    await renderConLista();

    fireEvent.click(within(fila(CARLA.email)).getByRole('button', { name: 'Dar de alta' }));
    expect(screen.getByLabelText('Correo')).toHaveValue(CARLA.email);
    expect(screen.getByLabelText('Nombre completo')).toHaveFocus();

    fireEvent.change(screen.getByLabelText('Nombre completo'), {
      target: { value: 'Carla Díaz' },
    });
    fireEvent.change(screen.getByLabelText('RUT'), { target: { value: '9876543-3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Revisar datos' }));

    const confirmacion = await screen.findByTestId('personal-confirmacion');
    expect(within(confirmacion).getByText(CARLA.email)).toBeInTheDocument();
  });
});

describe('PersonalBooster — errores del alta (SC4 y SC8)', () => {
  async function altaQueFalla(err: unknown) {
    await renderConLista();
    vi.spyOn(api, 'post').mockRejectedValue(err);
    const confirmacion = await altaHastaConfirmar();
    fireEvent.click(within(confirmacion).getByRole('button', { name: 'Crear cuenta' }));
    return await screen.findByRole('alert');
  }

  it.each([
    [
      '409 rut_mismatch',
      new ApiError(409, 'rut_mismatch', {}, 'conflict'),
      'Ese correo ya es de una cuenta con otro RUT. Revisa el RUT: el de una cuenta existente no se cambia desde aquí.',
    ],
    [
      '409 rut_already_registered',
      new ApiError(409, 'rut_already_registered', {}, 'conflict'),
      'Ese RUT ya es de otra persona en Booster. Revisa el RUT o usa el correo de esa cuenta.',
    ],
    [
      '409 email_already_registered',
      new ApiError(409, 'email_already_registered', {}, 'conflict'),
      'Otra alta tomó ese correo recién. Revisa la lista antes de intentar de nuevo.',
    ],
    [
      '400 del validador',
      new ApiError(400, 'validation_error', {}, 'rut: RUT inválido'),
      'Revisa los datos: rut: RUT inválido',
    ],
    [
      '401 sin sesión',
      new ApiError(401, undefined, { error: 'unauthorized' }, 'unauthorized'),
      'Tu sesión venció. Vuelve a iniciar sesión.',
    ],
    [
      '403 sin acceso al panel',
      new ApiError(
        403,
        undefined,
        { error: 'forbidden_platform_admin' },
        'forbidden_platform_admin',
      ),
      'Tu cuenta no tiene acceso a esta función del panel.',
    ],
    [
      '403 en impersonación',
      new ApiError(
        403,
        'forbidden_impersonation_write',
        { error: 'forbidden_impersonation_write' },
        'forbidden_impersonation_write',
      ),
      'Estás viendo la plataforma como otra persona. Sal de la impersonación para hacer cambios.',
    ],
    [
      '500 inesperado',
      new ApiError(500, undefined, {}, 'internal'),
      'No pudimos completar la acción (500: internal).',
    ],
  ])('traduce %s a un mensaje legible y deja el formulario', async (_caso, err, mensaje) => {
    const alerta = await altaQueFalla(err);
    expect(alerta).toHaveTextContent(mensaje);
    expect(screen.queryByTestId('personal-confirmacion')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Nombre completo')).toHaveValue('Eva Muñoz');
    expect(screen.getByRole('button', { name: 'Revisar datos' })).not.toBeDisabled();
  });

  it('un error de red se muestra y se reporta', async () => {
    const alerta = await altaQueFalla(new TypeError('Failed to fetch'));
    expect(alerta).toHaveTextContent('No pudimos completar la acción: Failed to fetch');
    expect(logger.error).toHaveBeenCalled();
  });

  it('una respuesta del alta con formato inesperado no muestra un código', async () => {
    await renderConLista();
    vi.spyOn(api, 'post').mockResolvedValue({
      ok: true,
      user_id: USER_NUEVA,
      vinculo: 'nueva',
      codigo_activacion: null,
      expira_en: null,
      en_lista: false,
    });
    const confirmacion = await altaHastaConfirmar();
    fireEvent.click(within(confirmacion).getByRole('button', { name: 'Crear cuenta' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'La respuesta del servidor no tiene el formato esperado.',
    );
    expect(screen.queryByTestId('personal-codigo-panel')).not.toBeInTheDocument();
    expect(logger.error).toHaveBeenCalled();
  });
});

describe('PersonalBooster — Generar código nuevo (SC5)', () => {
  it('llama al POST sin body, muestra el código una vez con el RUT, la dirección y el aviso del anterior', async () => {
    const get = await renderConLista();
    const post = vi.spyOn(api, 'post').mockResolvedValue({
      ok: true,
      user_id: USER_PENDIENTE,
      codigo_activacion: '771204',
      expira_en: '2026-11-06T16:00:00.000Z',
      en_lista: false,
    });

    fireEvent.click(within(fila(BETO.email)).getByRole('button', { name: 'Generar código nuevo' }));

    const panel = await within(fila(BETO.email)).findByTestId('personal-codigo-panel');
    expect(post.mock.calls).toEqual([[`/admin/personal-booster/${USER_PENDIENTE}/codigo`]]);
    expect(screen.getAllByText('771204')).toHaveLength(1);
    expect(panel).toHaveTextContent('Código de activación nuevo');
    expect(panel).toHaveTextContent('El anterior deja de servir');
    expect(within(panel).getByText('12.345.678-5')).toBeInTheDocument();
    expect(within(panel).getByTestId('personal-url-activar')).toHaveTextContent(
      `${window.location.origin}/activar`,
    );
    expect(within(panel).getByTestId('personal-aviso-lista')).toHaveTextContent(AVISO_CORREO);

    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    expect(within(fila(BETO.email)).getByTestId('personal-codigo-panel')).toBeInTheDocument();
  });

  it('con el correo en la lista avisa que salió por correo', async () => {
    await renderConLista();
    vi.spyOn(api, 'post').mockResolvedValue({
      ok: true,
      user_id: USER_VENCIDA,
      codigo_activacion: '771204',
      expira_en: '2026-11-06T16:00:00.000Z',
      en_lista: true,
    });

    fireEvent.click(within(fila(DANI.email)).getByRole('button', { name: 'Generar código nuevo' }));

    const aviso = await within(fila(DANI.email)).findByTestId('personal-aviso-lista');
    expect(aviso).toHaveTextContent(AVISO_CORREO);
  });

  it('una cuenta sin RUT registrado no recibe el correo y el panel lo dice', async () => {
    await renderConLista({
      personal: [ANA, { ...BETO, email: 'gus@boosterchile.com', en_lista: true, rut: null }],
    });
    vi.spyOn(api, 'post').mockResolvedValue({
      ok: true,
      user_id: USER_PENDIENTE,
      codigo_activacion: '771204',
      expira_en: '2026-11-06T16:00:00.000Z',
      en_lista: true,
    });

    const gus = fila('gus@boosterchile.com');
    fireEvent.click(within(gus).getByRole('button', { name: 'Generar código nuevo' }));

    const aviso = await within(gus).findByTestId('personal-aviso-lista');
    expect(aviso).toHaveTextContent('no tiene RUT registrado');
    expect(aviso).not.toHaveTextContent(AVISO_CORREO);
  });

  it('una cuenta sin RUT y fuera de la lista: el aviso es el del RUT, que es lo que impide activar', async () => {
    await renderConLista({
      personal: [ANA, { ...BETO, email: 'hugo@boosterchile.com', en_lista: false, rut: null }],
    });
    vi.spyOn(api, 'post').mockResolvedValue({
      ok: true,
      user_id: USER_PENDIENTE,
      codigo_activacion: '771204',
      expira_en: '2026-11-06T16:00:00.000Z',
      en_lista: false,
    });

    const hugo = fila('hugo@boosterchile.com');
    fireEvent.click(within(hugo).getByRole('button', { name: 'Generar código nuevo' }));

    const aviso = await within(hugo).findByTestId('personal-aviso-lista');
    expect(aviso).toHaveTextContent('no tiene RUT registrado');
    expect(aviso).not.toHaveTextContent(AVISO_CORREO);
  });

  it('el código nuevo de otra fila reemplaza al panel anterior: nunca hay dos códigos en pantalla', async () => {
    await renderConLista();
    vi.spyOn(api, 'post')
      .mockResolvedValueOnce({
        ok: true,
        user_id: USER_PENDIENTE,
        codigo_activacion: '771204',
        expira_en: '2026-11-06T16:00:00.000Z',
        en_lista: false,
      })
      .mockResolvedValueOnce({
        ok: true,
        user_id: USER_VENCIDA,
        codigo_activacion: '305518',
        expira_en: '2026-11-06T16:00:00.000Z',
        en_lista: true,
      });

    fireEvent.click(within(fila(BETO.email)).getByRole('button', { name: 'Generar código nuevo' }));
    await screen.findByText('771204');
    fireEvent.click(within(fila(DANI.email)).getByRole('button', { name: 'Generar código nuevo' }));

    expect(await screen.findByText('305518')).toBeInTheDocument();
    expect(screen.queryByText('771204')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('personal-codigo-panel')).toHaveLength(1);
  });

  it('traduce already_activated y personal_not_found en la fila', async () => {
    await renderConLista();
    const post = vi
      .spyOn(api, 'post')
      .mockRejectedValueOnce(new ApiError(409, 'already_activated', {}, 'conflict'));

    const beto = fila(BETO.email);
    fireEvent.click(within(beto).getByRole('button', { name: 'Generar código nuevo' }));
    expect(await within(beto).findByRole('alert')).toHaveTextContent(
      'Esa persona ya activó su cuenta: entra con su RUT y su clave.',
    );

    post.mockRejectedValueOnce(new ApiError(404, 'personal_not_found', {}, 'not_found'));
    fireEvent.click(within(beto).getByRole('button', { name: 'Generar código nuevo' }));
    await waitFor(() =>
      expect(within(beto).getByRole('alert')).toHaveTextContent(
        'Esa persona no figura como personal de Booster. Repite el alta con su correo y RUT para marcarla.',
      ),
    );
  });

  it('una re-emisión con formato inesperado no muestra un código', async () => {
    await renderConLista();
    vi.spyOn(api, 'post').mockResolvedValue({ ok: true, user_id: USER_PENDIENTE });

    const beto = fila(BETO.email);
    fireEvent.click(within(beto).getByRole('button', { name: 'Generar código nuevo' }));

    expect(await within(beto).findByRole('alert')).toHaveTextContent(
      'La respuesta del servidor no tiene el formato esperado.',
    );
    expect(within(beto).queryByTestId('personal-codigo-panel')).not.toBeInTheDocument();
  });
});

describe('PersonalBooster — copiar el código', () => {
  async function conPanelDeCodigo() {
    await renderConLista();
    vi.spyOn(api, 'post').mockResolvedValue({
      ok: true,
      user_id: USER_PENDIENTE,
      codigo_activacion: '771204',
      expira_en: '2026-11-06T16:00:00.000Z',
      en_lista: false,
    });
    fireEvent.click(within(fila(BETO.email)).getByRole('button', { name: 'Generar código nuevo' }));
    return await screen.findByTestId('personal-codigo-panel');
  }

  it('Copiar código lo deja en el portapapeles y avisa', async () => {
    const writeText = vi.fn(async () => undefined);
    stubClipboard(writeText);
    const panel = await conPanelDeCodigo();

    fireEvent.click(within(panel).getByRole('button', { name: 'Copiar código' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('771204'));
    expect(await within(panel).findByRole('button', { name: 'Copiado ✓' })).toBeInTheDocument();
  });

  it('si el portapapeles falla, pide copiarlo a mano', async () => {
    stubClipboard(
      vi.fn(async () => {
        throw new Error('clipboard denied');
      }),
    );
    const panel = await conPanelDeCodigo();

    fireEvent.click(within(panel).getByRole('button', { name: 'Copiar código' }));

    expect(
      await within(panel).findByText('No pudimos copiar. Selecciona el código y cópialo a mano.'),
    ).toBeInTheDocument();
  });
});

/**
 * `.specs/acceso-panel-plataforma` SC12 — «Quitar acceso» en las cuentas
 * marcadas que no están en la lista de respaldo, con confirmación.
 */
describe('PersonalBooster — Quitar acceso (acceso-panel-plataforma SC12)', () => {
  it('aparece solo en las cuentas fuera de la lista de respaldo', async () => {
    await renderConLista();

    expect(
      within(fila(BETO.email)).getByRole('button', { name: 'Quitar acceso' }),
    ).toBeInTheDocument();
    for (const persona of [ANA, CARLA, DANI]) {
      expect(
        within(fila(persona.email)).queryByRole('button', { name: 'Quitar acceso' }),
      ).not.toBeInTheDocument();
    }
  });

  it('pide confirmación y cancelar no llama al POST', async () => {
    await renderConLista();
    const post = vi.spyOn(api, 'post');

    const beto = fila(BETO.email);
    fireEvent.click(within(beto).getByRole('button', { name: 'Quitar acceso' }));
    const confirmacion = within(beto).getByTestId('personal-quitar-confirmacion');
    expect(confirmacion).toHaveTextContent('¿Quitar el acceso al panel a Beto Soto?');
    expect(confirmacion).toHaveTextContent('Su cuenta y su clave no cambian');

    fireEvent.click(within(confirmacion).getByRole('button', { name: 'Cancelar' }));
    expect(within(beto).queryByTestId('personal-quitar-confirmacion')).not.toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it('al confirmar llama al POST sin body, avisa y recarga la lista', async () => {
    const get = await renderConLista();
    const post = vi.spyOn(api, 'post').mockResolvedValue({ ok: true, user_id: USER_PENDIENTE });

    const beto = fila(BETO.email);
    fireEvent.click(within(beto).getByRole('button', { name: 'Quitar acceso' }));
    fireEvent.click(within(beto).getByRole('button', { name: 'Sí, quitar acceso' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Quitamos el acceso al panel a Beto Soto. Avisamos a la lista de respaldo.',
    );
    expect(post.mock.calls).toEqual([[`/admin/personal-booster/${USER_PENDIENTE}/quitar-acceso`]]);
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  });

  it.each([
    [
      'ultimo_acceso',
      new ApiError(409, 'ultimo_acceso', {}, 'conflict'),
      'No puedes quitar este acceso: el panel quedaría sin nadie que pueda entrar.',
    ],
    [
      'en_lista_respaldo',
      new ApiError(409, 'en_lista_respaldo', {}, 'conflict'),
      'Su correo está en la lista de respaldo: primero sácalo de Terraform y aplica; después quítale el acceso aquí.',
    ],
  ])('traduce %s en la fila', async (_caso, err, mensaje) => {
    await renderConLista();
    vi.spyOn(api, 'post').mockRejectedValue(err);

    const beto = fila(BETO.email);
    fireEvent.click(within(beto).getByRole('button', { name: 'Quitar acceso' }));
    fireEvent.click(within(beto).getByRole('button', { name: 'Sí, quitar acceso' }));

    expect(await within(beto).findByRole('alert')).toHaveTextContent(mensaje);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('una respuesta con formato inesperado se reporta y no dice que lo quitó', async () => {
    await renderConLista();
    vi.spyOn(api, 'post').mockResolvedValue({ ok: true });

    const beto = fila(BETO.email);
    fireEvent.click(within(beto).getByRole('button', { name: 'Quitar acceso' }));
    fireEvent.click(within(beto).getByRole('button', { name: 'Sí, quitar acceso' }));

    expect(await within(beto).findByRole('alert')).toHaveTextContent(
      'La respuesta del servidor no tiene el formato esperado.',
    );
    expect(logger.error).toHaveBeenCalled();
  });
});

/**
 * `.specs/confirmar-acceso-booster` SC16 — la cuenta activa de una empresa no
 * queda marcada en el alta: el panel muestra un código de confirmación que el
 * admin entrega en persona y la persona ingresa con su sesión.
 */
describe('PersonalBooster — código de confirmación (confirmar-acceso-booster SC16)', () => {
  const URL_CONFIRMAR = `${window.location.origin}/app/confirmar-acceso-booster`;

  it('el alta muestra el código una vez con la instrucción, el vencimiento y la dirección de la pantalla', async () => {
    const get = await renderConLista();
    vi.spyOn(api, 'post').mockResolvedValue({
      ok: true,
      user_id: USER_FELI,
      vinculo: 'cuenta_activa_por_confirmar',
      codigo_activacion: '604218',
      expira_en: '2026-11-10T16:00:00.000Z',
      en_lista: false,
    });

    const confirmacion = await altaHastaConfirmar({
      email: FELI.email,
      nombre: 'Feli Lagos',
      rut: '44.444.444-4',
    });
    fireEvent.click(within(confirmacion).getByRole('button', { name: 'Crear cuenta' }));

    const panel = await screen.findByTestId('personal-codigo-panel');
    expect(panel).toHaveTextContent('Código de confirmación');
    expect(within(panel).getByTestId('personal-confirmacion-instruccion')).toHaveTextContent(
      INSTRUCCION_CONFIRMACION,
    );
    expect(screen.getAllByText('604218')).toHaveLength(1);
    expect(within(panel).getByTestId('personal-codigo')).toHaveTextContent('604218');
    expect(within(panel).getByText('44.444.444-4')).toBeInTheDocument();
    expect(within(panel).getByText(/Vence el/)).toBeInTheDocument();
    expect(within(panel).getByTestId('personal-url-confirmar')).toHaveTextContent(URL_CONFIRMAR);
    expect(panel).toHaveTextContent('Se muestra una sola vez');
    // No es un código de activación: ni /activar ni el aviso del correo.
    expect(within(panel).queryByTestId('personal-url-activar')).not.toBeInTheDocument();
    expect(within(panel).queryByTestId('personal-aviso-lista')).not.toBeInTheDocument();
    expect(panel).not.toHaveTextContent('/activar');
    expect(panel).not.toHaveTextContent('código de activación');
    expect(panel).not.toHaveTextContent(AVISO_CORREO);

    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    fireEvent.click(within(panel).getByRole('button', { name: 'Listo, cerrar' }));
    expect(screen.queryByText('604218')).not.toBeInTheDocument();
  });

  it('Generar código nuevo en una fila por confirmar muestra un código de confirmación nuevo', async () => {
    await renderConLista(LISTA_CON_CONFIRMACION);
    const post = vi.spyOn(api, 'post').mockResolvedValue({
      ok: true,
      user_id: USER_FELI,
      vinculo: 'cuenta_activa_por_confirmar',
      codigo_activacion: '913507',
      expira_en: '2026-11-10T16:00:00.000Z',
      en_lista: false,
    });

    const feli = fila(FELI.email);
    fireEvent.click(within(feli).getByRole('button', { name: 'Generar código nuevo' }));

    const panel = await within(feli).findByTestId('personal-codigo-panel');
    expect(post.mock.calls).toEqual([[`/admin/personal-booster/${USER_FELI}/codigo`]]);
    expect(panel).toHaveTextContent('Código de confirmación nuevo');
    expect(panel).toHaveTextContent('El anterior deja de servir');
    expect(panel).toHaveTextContent('24 horas');
    expect(within(panel).getByTestId('personal-confirmacion-instruccion')).toHaveTextContent(
      INSTRUCCION_CONFIRMACION,
    );
    expect(within(panel).getByTestId('personal-codigo')).toHaveTextContent('913507');
    expect(within(panel).getByTestId('personal-url-confirmar')).toHaveTextContent(URL_CONFIRMAR);
    expect(within(panel).queryByTestId('personal-url-activar')).not.toBeInTheDocument();
    expect(within(panel).queryByTestId('personal-aviso-lista')).not.toBeInTheDocument();
    expect(panel).not.toHaveTextContent('7 días');
  });

  it('la re-emisión con vinculo provisoria_sin_codigo sigue siendo el código de activación', async () => {
    await renderConLista();
    vi.spyOn(api, 'post').mockResolvedValue({
      ok: true,
      user_id: USER_PENDIENTE,
      vinculo: 'provisoria_sin_codigo',
      codigo_activacion: '771204',
      expira_en: '2026-11-06T16:00:00.000Z',
      en_lista: false,
    });

    fireEvent.click(within(fila(BETO.email)).getByRole('button', { name: 'Generar código nuevo' }));

    const panel = await within(fila(BETO.email)).findByTestId('personal-codigo-panel');
    expect(panel).toHaveTextContent('Código de activación nuevo');
    expect(within(panel).getByTestId('personal-url-activar')).toBeInTheDocument();
    expect(within(panel).queryByTestId('personal-url-confirmar')).not.toBeInTheDocument();
    expect(panel).not.toHaveTextContent(INSTRUCCION_CONFIRMACION);
  });

  it('copiar el código de confirmación lo deja en el portapapeles', async () => {
    const writeText = vi.fn(async () => undefined);
    stubClipboard(writeText);
    await renderConLista(LISTA_CON_CONFIRMACION);
    vi.spyOn(api, 'post').mockResolvedValue({
      ok: true,
      user_id: USER_FELI,
      vinculo: 'cuenta_activa_por_confirmar',
      codigo_activacion: '913507',
      expira_en: '2026-11-10T16:00:00.000Z',
      en_lista: false,
    });

    fireEvent.click(within(fila(FELI.email)).getByRole('button', { name: 'Generar código nuevo' }));
    const panel = await within(fila(FELI.email)).findByTestId('personal-codigo-panel');
    fireEvent.click(within(panel).getByRole('button', { name: 'Copiar código' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('913507'));
    expect(await within(panel).findByRole('button', { name: 'Copiado ✓' })).toBeInTheDocument();
  });
});

/**
 * `.specs/confirmar-acceso-booster` SC17 — la persona por confirmar en la
 * lista del personal.
 */
describe('PersonalBooster — persona por confirmar (confirmar-acceso-booster SC17)', () => {
  it('se lee Pendiente de confirmar, con el vencimiento, el vencido o el código sin uso', async () => {
    await renderConLista(LISTA_CON_CONFIRMACION);

    const feli = fila(FELI.email);
    expect(within(feli).getByText('Pendiente de confirmar')).toBeInTheDocument();
    expect(within(feli).getByText(/Código de confirmación: vence el/)).toBeInTheDocument();
    expect(within(feli).queryByText('vencido')).not.toBeInTheDocument();

    const gabi = fila(GABI.email);
    expect(within(gabi).getByText('Pendiente de confirmar')).toBeInTheDocument();
    expect(within(gabi).getByText(/Código de confirmación: venció el/)).toBeInTheDocument();
    expect(within(gabi).getByText('vencido')).toBeInTheDocument();

    const hans = fila(HANS.email);
    expect(
      within(hans).getByText(
        'El código de confirmación ya no sirve: usa «Generar código nuevo» para entregarle otro.',
      ),
    ).toBeInTheDocument();
    expect(within(hans).queryByText(/Sin código vigente del panel/)).not.toBeInTheDocument();
  });

  it('Generar código nuevo aparece en las filas por confirmar', async () => {
    await renderConLista(LISTA_CON_CONFIRMACION);

    for (const persona of [FELI, GABI, HANS]) {
      expect(
        within(fila(persona.email)).getByRole('button', { name: 'Generar código nuevo' }),
      ).toBeInTheDocument();
    }
  });

  it('Quitar acceso de una persona por confirmar dice que el código deja de servir y no anuncia aviso', async () => {
    const get = await renderConLista(LISTA_CON_CONFIRMACION);
    const post = vi.spyOn(api, 'post').mockResolvedValue({ ok: true, user_id: USER_FELI });

    const feli = fila(FELI.email);
    fireEvent.click(within(feli).getByRole('button', { name: 'Quitar acceso' }));
    const confirmacion = within(feli).getByTestId('personal-quitar-confirmacion');
    expect(confirmacion).toHaveTextContent('¿Quitar el acceso al panel a Feli Lagos?');
    expect(confirmacion).toHaveTextContent('Todavía no confirmó su acceso');
    expect(confirmacion).toHaveTextContent('su código de confirmación deja de servir');
    expect(confirmacion).not.toHaveTextContent('Avisamos a la lista de respaldo');

    fireEvent.click(within(feli).getByRole('button', { name: 'Sí, quitar acceso' }));

    const aviso = await screen.findByRole('status');
    expect(aviso).toHaveTextContent(
      'Anulamos el código de confirmación de Feli Lagos: no recibe acceso al panel.',
    );
    expect(aviso).not.toHaveTextContent('Avisamos a la lista de respaldo');
    expect(post.mock.calls).toEqual([[`/admin/personal-booster/${USER_FELI}/quitar-acceso`]]);
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  });
});
