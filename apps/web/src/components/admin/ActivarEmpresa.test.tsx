import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../lib/api-client.js';
import { ActivarEmpresa } from './ActivarEmpresa.js';

const PENDIENTE = {
  id: 'e-1',
  razon_social: 'Transportes Sur SpA',
  rut: '76653720-0',
  estado: 'pendiente_verificacion' as const,
  es_transportista: true,
  es_generador_carga: false,
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

  it('muestra vacío si no hay empresas en el filtro', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ empresas: [] });
    render(<ActivarEmpresa />);
    expect(await screen.findByTestId('empresa-estado-empty')).toBeInTheDocument();
  });
});
