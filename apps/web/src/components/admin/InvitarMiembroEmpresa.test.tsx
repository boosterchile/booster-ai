import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../lib/api-client.js';
import { logger } from '../../lib/logger.js';
import { InvitarMiembroEmpresa } from './InvitarMiembroEmpresa.js';

/**
 * Fase 3.5 — UI de alta de miembro en empresa existente.
 *
 * Cubre el caso que hoy se resuelve con INSERT a mano: sumar al gestor de una
 * empresa ya creada (Van Oosterwyk) y entregarle su link de acceso.
 */

const EMPRESAS = [
  {
    id: '60c344e0-b925-43a6-a7b3-aa6b07fac721',
    razon_social: 'Transportes Van Oosterwyk',
    rut: '76653720-0',
    estado: 'activa',
    es_transportista: true,
    es_generador_carga: false,
  },
];

function stubClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('InvitarMiembroEmpresa', () => {
  it('lista las empresas y permite sumar una persona con su rol', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ empresas: EMPRESAS });
    const post = vi.spyOn(api, 'post').mockResolvedValue({
      ok: true,
      user_id: 'user-uuid',
      membership_id: 'membership-uuid',
      rol: 'admin',
      estado: 'pendiente_invitacion',
      codigo_activacion: '482915',
      expira_en: '2026-10-04T00:00:00.000Z',
    });
    stubClipboard(vi.fn(async () => undefined));

    render(<InvitarMiembroEmpresa />);

    await waitFor(() => screen.getByRole('option', { name: /Transportes Van Oosterwyk/ }));

    fireEvent.change(screen.getByLabelText(/Empresa/i), { target: { value: EMPRESAS[0]?.id } });
    fireEvent.change(screen.getByLabelText(/Nombre completo/i), {
      target: { value: 'Javier Vicencio' },
    });
    fireEvent.change(screen.getByLabelText(/^RUT$/i), { target: { value: '12345678-5' } });
    fireEvent.change(screen.getByLabelText(/Email/i), {
      target: { value: 'fvicencio@me.com' },
    });
    fireEvent.change(screen.getByLabelText(/Rol/i), { target: { value: 'admin' } });
    fireEvent.click(screen.getByRole('button', { name: /Agregar a la empresa/i }));

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(`/admin/empresas/${EMPRESAS[0]?.id}/miembros`, {
        email: 'fvicencio@me.com',
        full_name: 'Javier Vicencio',
        rut: '12345678-5',
        rol: 'admin',
      }),
    );

    await waitFor(() => expect(screen.getByText('482915')).toBeInTheDocument());
  });

  it('avisa cuando la persona ya es miembro, sin dejar el form colgado', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ empresas: EMPRESAS });
    vi.spyOn(api, 'post').mockRejectedValue(
      Object.assign(new Error('conflict'), { code: 'already_member', status: 409 }),
    );

    render(<InvitarMiembroEmpresa />);
    await waitFor(() => screen.getByRole('option', { name: /Transportes Van Oosterwyk/ }));

    fireEvent.change(screen.getByLabelText(/Empresa/i), { target: { value: EMPRESAS[0]?.id } });
    fireEvent.change(screen.getByLabelText(/Nombre completo/i), {
      target: { value: 'Javier Vicencio' },
    });
    fireEvent.change(screen.getByLabelText(/^RUT$/i), { target: { value: '12345678-5' } });
    fireEvent.change(screen.getByLabelText(/Email/i), {
      target: { value: 'fvicencio@me.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Agregar a la empresa/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Agregar a la empresa/i })).not.toBeDisabled();
  });
});

const OTRA_EMPRESA = {
  id: 'b1d7a2c4-1111-4a2b-9c3d-000000000001',
  razon_social: 'Retail Norte SpA',
  rut: '76274900-9',
  estado: 'activa',
  es_transportista: false,
  es_generador_carga: true,
};

const RESPUESTA_CODIGO = {
  ok: true,
  user_id: 'user-uuid',
  membership_id: 'membership-uuid',
  rol: 'dueno',
  estado: 'pendiente_invitacion',
  codigo_activacion: '482915',
  expira_en: '2026-10-04T00:00:00.000Z',
  vinculo: 'nueva' as const,
};

async function invitar() {
  fireEvent.change(screen.getByLabelText(/Nombre completo/i), {
    target: { value: 'Javier Vicencio' },
  });
  fireEvent.change(screen.getByLabelText(/^RUT$/i), { target: { value: '12.345.678-5' } });
  fireEvent.change(screen.getByLabelText(/Email/i), { target: { value: 'fvicencio@me.com' } });
  fireEvent.click(screen.getByRole('button', { name: /Agregar a la empresa/i }));
}

/** acceso-usuarios-empresa-panel SC4 — el código se entrega con la dirección de `/activar`. */
describe('InvitarMiembroEmpresa — lo que se entrega junto al código (SC4)', () => {
  it('muestra la dirección absoluta de /activar, el RUT, el código y el vencimiento', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ empresas: EMPRESAS });
    vi.spyOn(api, 'post').mockResolvedValue(RESPUESTA_CODIGO);

    render(<InvitarMiembroEmpresa />);
    await waitFor(() => screen.getByRole('option', { name: /Transportes Van Oosterwyk/ }));
    fireEvent.change(screen.getByLabelText(/Empresa/i), { target: { value: EMPRESAS[0]?.id } });
    await invitar();

    const entrega = await screen.findByTestId('invitar-entrega');
    expect(entrega).toHaveTextContent(`${window.location.origin}/activar`);
    expect(entrega).toHaveTextContent('12345678-5');
    expect(entrega).toHaveTextContent('482915');
    expect(entrega).toHaveTextContent(/Vence el/);
    // Le habla al admin, en tuteo, y no en voseo.
    expect(entrega).toHaveTextContent(/Entrégale/);
    expect(entrega.textContent ?? '').not.toMatch(/Entrá|escribí|elegí/);
    // Quien elige la clave es la persona, no el admin.
    expect(entrega).toHaveTextContent(/la persona escribe su RUT/);
    expect(entrega).toHaveTextContent(/elige su propia clave/);
  });

  it('copia la dirección de /activar', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ empresas: EMPRESAS });
    vi.spyOn(api, 'post').mockResolvedValue(RESPUESTA_CODIGO);
    const writeText = vi.fn(async () => undefined);
    stubClipboard(writeText);

    render(<InvitarMiembroEmpresa />);
    await waitFor(() => screen.getByRole('option', { name: /Transportes Van Oosterwyk/ }));
    fireEvent.change(screen.getByLabelText(/Empresa/i), { target: { value: EMPRESAS[0]?.id } });
    await invitar();

    fireEvent.click(await screen.findByRole('button', { name: /Copiar dirección/i }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/activar`),
    );
    expect(await screen.findByRole('button', { name: /Copiada ✓/ })).toBeInTheDocument();
  });

  it('si el portapapeles falla, la dirección sigue en pantalla y el fallo queda registrado', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ empresas: EMPRESAS });
    vi.spyOn(api, 'post').mockResolvedValue(RESPUESTA_CODIGO);
    stubClipboard(
      vi.fn(async () => {
        throw new Error('NotAllowedError');
      }),
    );
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

    render(<InvitarMiembroEmpresa />);
    await waitFor(() => screen.getByRole('option', { name: /Transportes Van Oosterwyk/ }));
    fireEvent.change(screen.getByLabelText(/Empresa/i), { target: { value: EMPRESAS[0]?.id } });
    await invitar();

    fireEvent.click(await screen.findByRole('button', { name: /Copiar dirección/i }));
    await waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: /Copiar dirección/i })).toBeInTheDocument();
    expect(screen.getByTestId('invitar-entrega')).toHaveTextContent(
      `${window.location.origin}/activar`,
    );
  });

  it('el aviso de copiado vuelve a su texto después de un rato', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ empresas: EMPRESAS });
    vi.spyOn(api, 'post').mockResolvedValue(RESPUESTA_CODIGO);
    stubClipboard(vi.fn(async () => undefined));
    const timeout = vi.spyOn(window, 'setTimeout');

    render(<InvitarMiembroEmpresa />);
    await waitFor(() => screen.getByRole('option', { name: /Transportes Van Oosterwyk/ }));
    fireEvent.change(screen.getByLabelText(/Empresa/i), { target: { value: EMPRESAS[0]?.id } });
    await invitar();

    fireEvent.click(await screen.findByRole('button', { name: /Copiar dirección/i }));
    expect(await screen.findByRole('button', { name: /Copiada ✓/ })).toBeInTheDocument();
    const restaurar = timeout.mock.calls.find(([, ms]) => ms === 2500)?.[0];
    expect(typeof restaurar).toBe('function');
    act(() => {
      if (typeof restaurar === 'function') {
        restaurar();
      }
    });
    expect(screen.getByRole('button', { name: /Copiar dirección/i })).toBeInTheDocument();
  });

  it('copia el código', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ empresas: EMPRESAS });
    vi.spyOn(api, 'post').mockResolvedValue(RESPUESTA_CODIGO);
    const writeText = vi.fn(async () => undefined);
    stubClipboard(writeText);

    render(<InvitarMiembroEmpresa />);
    await waitFor(() => screen.getByRole('option', { name: /Transportes Van Oosterwyk/ }));
    fireEvent.change(screen.getByLabelText(/Empresa/i), { target: { value: EMPRESAS[0]?.id } });
    await invitar();

    fireEvent.click(await screen.findByRole('button', { name: /Copiar código/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('482915'));
    expect(await screen.findByRole('button', { name: /Copiado ✓/ })).toBeInTheDocument();
  });
});

/** acceso-usuarios-empresa-panel SC6 y SC7. */
describe('InvitarMiembroEmpresa — empresa recién creada e invitación (SC6, SC7)', () => {
  it('con la empresa recién creada la deja elegida y con rol dueño', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ empresas: [EMPRESAS[0], OTRA_EMPRESA] });

    render(<InvitarMiembroEmpresa preferEmpresaId={OTRA_EMPRESA.id} />);

    await waitFor(() => expect(screen.getByLabelText(/Empresa/i)).toHaveValue(OTRA_EMPRESA.id));
    expect(screen.getByLabelText(/Rol/i)).toHaveValue('dueno');
  });

  it('sin empresa preseleccionada el rol por defecto sigue siendo admin', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ empresas: [EMPRESAS[0], OTRA_EMPRESA] });

    render(<InvitarMiembroEmpresa />);

    await waitFor(() => screen.getByRole('option', { name: /Retail Norte SpA/ }));
    expect(screen.getByLabelText(/Empresa/i)).toHaveValue('');
    expect(screen.getByLabelText(/Rol/i)).toHaveValue('admin');
  });

  it('si la empresa preferida no está en la lista, no la elige y el rol sigue en admin', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ empresas: EMPRESAS });

    render(<InvitarMiembroEmpresa preferEmpresaId={OTRA_EMPRESA.id} />);

    await waitFor(() => screen.getByRole('option', { name: /Transportes Van Oosterwyk/ }));
    expect(screen.getByLabelText(/Empresa/i)).toHaveValue('');
    expect(screen.getByLabelText(/Rol/i)).toHaveValue('admin');
  });

  it('una recarga de la lista no le pisa el rol que eligió el admin', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ empresas: [EMPRESAS[0], OTRA_EMPRESA] });

    const { rerender } = render(
      <InvitarMiembroEmpresa preferEmpresaId={OTRA_EMPRESA.id} refreshToken={0} />,
    );
    await waitFor(() => expect(screen.getByLabelText(/Rol/i)).toHaveValue('dueno'));
    fireEvent.change(screen.getByLabelText(/Rol/i), { target: { value: 'despachador' } });

    rerender(<InvitarMiembroEmpresa preferEmpresaId={OTRA_EMPRESA.id} refreshToken={1} />);
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
    expect(screen.getByLabelText(/Rol/i)).toHaveValue('despachador');
  });

  it('después de invitar al dueño, la siguiente invitación a esa empresa vuelve al rol admin', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ empresas: [EMPRESAS[0], OTRA_EMPRESA] });
    const post = vi.spyOn(api, 'post').mockResolvedValue(RESPUESTA_CODIGO);

    render(<InvitarMiembroEmpresa preferEmpresaId={OTRA_EMPRESA.id} />);
    await waitFor(() => expect(screen.getByLabelText(/Rol/i)).toHaveValue('dueno'));
    await invitar();
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        `/admin/empresas/${OTRA_EMPRESA.id}/miembros`,
        expect.objectContaining({ rol: 'dueno' }),
      ),
    );

    await waitFor(() => expect(screen.getByLabelText(/Rol/i)).toHaveValue('admin'));
    expect(screen.getByLabelText(/Empresa/i)).toHaveValue(OTRA_EMPRESA.id);
    await invitar();
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(post).toHaveBeenLastCalledWith(
      `/admin/empresas/${OTRA_EMPRESA.id}/miembros`,
      expect.objectContaining({ rol: 'admin' }),
    );
  });

  it('al elegir otra empresa en el selector, el rol vuelve a admin', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ empresas: [EMPRESAS[0], OTRA_EMPRESA] });
    const post = vi.spyOn(api, 'post').mockResolvedValue(RESPUESTA_CODIGO);

    render(<InvitarMiembroEmpresa preferEmpresaId={OTRA_EMPRESA.id} />);
    await waitFor(() => expect(screen.getByLabelText(/Rol/i)).toHaveValue('dueno'));

    fireEvent.change(screen.getByLabelText(/Empresa/i), { target: { value: EMPRESAS[0]?.id } });
    expect(screen.getByLabelText(/Rol/i)).toHaveValue('admin');
    await invitar();
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        `/admin/empresas/${EMPRESAS[0]?.id}/miembros`,
        expect.objectContaining({ rol: 'admin' }),
      ),
    );
  });

  it('el rol que el admin elige a mano no se cambia al invitar', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ empresas: [EMPRESAS[0], OTRA_EMPRESA] });
    vi.spyOn(api, 'post').mockResolvedValue(RESPUESTA_CODIGO);

    render(<InvitarMiembroEmpresa preferEmpresaId={OTRA_EMPRESA.id} />);
    await waitFor(() => expect(screen.getByLabelText(/Rol/i)).toHaveValue('dueno'));
    fireEvent.change(screen.getByLabelText(/Rol/i), { target: { value: 'despachador' } });
    await invitar();

    await screen.findByTestId('invitar-entrega');
    expect(screen.getByLabelText(/Rol/i)).toHaveValue('despachador');
  });

  it('avisa con onInvitado cuando la invitación queda creada', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ empresas: EMPRESAS });
    vi.spyOn(api, 'post').mockResolvedValue(RESPUESTA_CODIGO);
    const onInvitado = vi.fn();

    render(<InvitarMiembroEmpresa onInvitado={onInvitado} />);
    await waitFor(() => screen.getByRole('option', { name: /Transportes Van Oosterwyk/ }));
    fireEvent.change(screen.getByLabelText(/Empresa/i), { target: { value: EMPRESAS[0]?.id } });
    await invitar();

    await waitFor(() => expect(onInvitado).toHaveBeenCalledTimes(1));
  });

  it('no avisa con onInvitado si la invitación falla', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ empresas: EMPRESAS });
    vi.spyOn(api, 'post').mockRejectedValue(
      Object.assign(new Error('conflict'), { code: 'email_already_registered', status: 409 }),
    );
    const onInvitado = vi.fn();

    render(<InvitarMiembroEmpresa onInvitado={onInvitado} />);
    await waitFor(() => screen.getByRole('option', { name: /Transportes Van Oosterwyk/ }));
    fireEvent.change(screen.getByLabelText(/Empresa/i), { target: { value: EMPRESAS[0]?.id } });
    await invitar();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Ese correo ya pertenece a otra persona.',
    );
    expect(onInvitado).not.toHaveBeenCalled();
  });
});
