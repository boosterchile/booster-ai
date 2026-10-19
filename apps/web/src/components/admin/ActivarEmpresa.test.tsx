import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../../lib/api-client.js';
import { ActivarEmpresa } from './ActivarEmpresa.js';

const MEMBERSHIP_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

const PENDIENTE = {
  id: 'e-1',
  razon_social: 'Transportes Sur SpA',
  rut: '76653720-0',
  estado: 'pendiente_verificacion' as const,
  es_transportista: true,
  es_generador_carga: false,
  miembros_pendientes: [] as Array<{
    user_id: string;
    membership_id: string;
    nombre: string;
    rut: string;
    email: string;
    rol: string;
    invitado_en: string;
    expira_en: string;
  }>,
  dueno_pendiente: null,
};

const MIEMBRO_PENDIENTE = {
  user_id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  membership_id: MEMBERSHIP_ID,
  nombre: 'Javier Vicencio',
  rut: '12345678-5',
  email: 'fvicencio@me.com',
  rol: 'dueno',
  invitado_en: '2026-09-21T15:00:00.000Z',
  expira_en: '2026-09-28T15:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ActivarEmpresa', () => {
  it('lista pendientes y activa sin SQL', async () => {
    const getSpy = vi.spyOn(api, 'get').mockResolvedValue({ empresas: [PENDIENTE] });
    const patchSpy = vi.spyOn(api, 'patch').mockResolvedValue({
      ok: true,
      estado: 'activa',
      unchanged: false,
    });

    render(<ActivarEmpresa />);

    expect(await screen.findByText('Transportes Sur SpA')).toBeInTheDocument();
    expect(getSpy).toHaveBeenCalledWith('/admin/empresas?estado=pendiente_verificacion');

    fireEvent.click(screen.getByTestId('empresa-activar-e-1'));

    await waitFor(() => {
      expect(patchSpy).toHaveBeenCalledWith('/admin/empresas/e-1', { estado: 'activa' });
    });
  });

  it('Suspender manda estado suspendida', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      empresas: [{ ...PENDIENTE, estado: 'activa' as const }],
    });
    const patchSpy = vi.spyOn(api, 'patch').mockResolvedValue({ ok: true });

    render(<ActivarEmpresa />);
    fireEvent.click(await screen.findByTestId('empresa-filtro-activa'));

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/admin/empresas?estado=activa');
    });

    fireEvent.click(await screen.findByTestId('empresa-suspender-e-1'));
    await waitFor(() => {
      expect(patchSpy).toHaveBeenCalledWith('/admin/empresas/e-1', { estado: 'suspendida' });
    });
  });

  it('Generar carga prende el rol en un transportista y no se ofrece si ya lo tiene', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      empresas: [
        { ...PENDIENTE, id: 'e-trans', estado: 'activa' as const },
        {
          ...PENDIENTE,
          id: 'e-dual',
          razon_social: 'Ya Genera SpA',
          estado: 'activa' as const,
          es_generador_carga: true,
        },
        {
          ...PENDIENTE,
          id: 'e-gen',
          razon_social: 'Solo Generador SpA',
          estado: 'activa' as const,
          es_transportista: false,
          es_generador_carga: true,
        },
      ],
    });
    const postSpy = vi.spyOn(api, 'post').mockResolvedValue({
      ok: true,
      id: 'e-trans',
      es_generador_carga: true,
      es_transportista: true,
      unchanged: false,
    });

    render(<ActivarEmpresa />);
    fireEvent.click(await screen.findByTestId('empresa-filtro-activa'));

    expect(await screen.findByTestId('empresa-generar-carga-e-trans')).toBeInTheDocument();
    expect(screen.queryByTestId('empresa-generar-carga-e-dual')).not.toBeInTheDocument();
    expect(screen.queryByTestId('empresa-generar-carga-e-gen')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('empresa-generar-carga-e-trans'));
    await waitFor(() => {
      expect(postSpy).toHaveBeenCalledWith('/admin/empresas/e-trans/activar-generador-carga');
    });
  });

  it('muestra vacío si no hay empresas en el filtro', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ empresas: [] });
    render(<ActivarEmpresa />);
    expect(await screen.findByTestId('empresa-estado-empty')).toBeInTheDocument();
  });

  it('muestra la persona pendiente y el botón de código nuevo', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      empresas: [{ ...PENDIENTE, miembros_pendientes: [MIEMBRO_PENDIENTE] }],
    });

    render(<ActivarEmpresa />);

    expect(await screen.findByText('Javier Vicencio')).toBeInTheDocument();
    expect(screen.getByText('12345678-5')).toBeInTheDocument();
    expect(screen.getByText(/fvicencio@me.com/)).toBeInTheDocument();
    expect(screen.getByText(/Dueño/)).toBeInTheDocument();
    expect(screen.getByTestId(`reemitir-codigo-${MEMBERSHIP_ID}`)).toBeInTheDocument();
  });

  it('al generar el código llama al POST sin body, lo muestra una vez y deja la fila', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      empresas: [{ ...PENDIENTE, miembros_pendientes: [MIEMBRO_PENDIENTE] }],
    });
    const postSpy = vi.spyOn(api, 'post').mockResolvedValue({
      codigo_activacion: '482915',
      expira_en: '2026-10-05T12:00:00.000Z',
      membership_id: MEMBERSHIP_ID,
      user_id: MIEMBRO_PENDIENTE.user_id,
      rol: 'dueno',
      estado: 'pendiente_invitacion',
    });

    render(<ActivarEmpresa />);
    fireEvent.click(await screen.findByTestId(`reemitir-codigo-${MEMBERSHIP_ID}`));

    await waitFor(() => {
      expect(postSpy).toHaveBeenCalledTimes(1);
    });
    expect(postSpy.mock.calls[0]).toEqual([`/admin/empresas/e-1/miembros/${MEMBERSHIP_ID}/codigo`]);
    expect(await screen.findByText('482915')).toBeInTheDocument();
    expect(
      screen.getByText(/El anterior deja de servir y no se vuelve a mostrar/),
    ).toBeInTheDocument();
    expect(screen.getByText('Javier Vicencio')).toBeInTheDocument();
    expect(screen.getByTestId(`reemitir-codigo-${MEMBERSHIP_ID}`)).toBeInTheDocument();
  });

  it('sin pendientes no muestra el botón de código nuevo', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ empresas: [PENDIENTE] });
    render(<ActivarEmpresa />);
    expect(await screen.findByText('Transportes Sur SpA')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Generar código nuevo' })).not.toBeInTheDocument();
  });

  it('Generar carga muestra un error en español, sin el código HTTP', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      empresas: [{ ...PENDIENTE, id: 'e-trans', estado: 'activa' as const }],
    });
    vi.spyOn(api, 'post').mockRejectedValue(
      new ApiError(409, 'not_a_transportista', {}, 'conflict'),
    );

    render(<ActivarEmpresa />);
    fireEvent.click(await screen.findByTestId('empresa-filtro-activa'));
    fireEvent.click(await screen.findByTestId('empresa-generar-carga-e-trans'));

    expect(
      await screen.findByText('Solo una empresa transportista puede generar carga.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/409/)).not.toBeInTheDocument();
  });

  it('cambiar el estado no muestra el status crudo', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      empresas: [{ ...PENDIENTE, estado: 'activa' as const }],
    });
    vi.spyOn(api, 'patch').mockRejectedValue(
      new ApiError(403, 'forbidden_platform_admin', {}, 'forbidden_platform_admin'),
    );

    render(<ActivarEmpresa />);
    fireEvent.click(await screen.findByTestId('empresa-filtro-activa'));
    fireEvent.click(await screen.findByTestId('empresa-suspender-e-1'));

    expect(await screen.findByText('No tienes permiso para hacer esto.')).toBeInTheDocument();
    expect(screen.queryByText(/403/)).not.toBeInTheDocument();
  });

  it('traduce already_activated y membership_not_found', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      empresas: [{ ...PENDIENTE, miembros_pendientes: [MIEMBRO_PENDIENTE] }],
    });
    const postSpy = vi
      .spyOn(api, 'post')
      .mockRejectedValueOnce(new ApiError(409, 'already_activated', {}, 'conflict'));

    render(<ActivarEmpresa />);
    fireEvent.click(await screen.findByTestId(`reemitir-codigo-${MEMBERSHIP_ID}`));
    expect(await screen.findByText('Esa persona ya activó su cuenta.')).toBeInTheDocument();

    postSpy.mockRejectedValueOnce(new ApiError(404, 'membership_not_found', {}, 'not_found'));
    fireEvent.click(screen.getByTestId(`reemitir-codigo-${MEMBERSHIP_ID}`));
    expect(
      await screen.findByText('No encontramos esa invitación en esta empresa.'),
    ).toBeInTheDocument();
  });
});
