import { CONFIGURACION_COMERCIAL_INICIAL } from '@booster-ai/shared-schemas';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../lib/api-client.js';

vi.mock('../components/ProtectedRoute.js', () => ({
  ProtectedRoute: ({ children }: { children: () => ReactNode }) => <>{children()}</>,
}));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, ...rest }: { children: ReactNode; to: string }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('../hooks/use-auth.js', () => ({ signOutUser: vi.fn(async () => undefined) }));

const { PlatformAdminConfiguracionComercialRoute } = await import(
  './platform-admin-configuracion-comercial.js'
);

const version = (n: number, spot = 20) => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  version: n,
  config: {
    ...CONFIGURACION_COMERCIAL_INICIAL,
    comisiones: { ...CONFIGURACION_COMERCIAL_INICIAL.comisiones, spot_pct: spot },
  },
  vigenteDesde: '2026-10-08T12:00:00.000Z',
  notaCambio: `nota v${n}`,
  creadoPorEmail: 'admin@boosterchile.com',
  creadoEn: '2026-10-08T12:00:00.000Z',
});

let getSpy: ReturnType<typeof vi.spyOn>;
let putSpy: ReturnType<typeof vi.spyOn>;

const GEN = {
  empresaId: '00000000-0000-4000-8000-0000000000e1',
  razonSocial: 'Exportadora Uno SpA',
  rut: '76.111.111-1',
  activadoEn: null as string | null,
  activadoPor: null as string | null,
};

beforeEach(() => {
  getSpy = vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
    if (path === '/admin/configuracion-comercial/contrato-programado') {
      return { generadores: [GEN] };
    }
    return { publicada: version(2), historial: [version(2), version(1, 22)] };
  });
  putSpy = vi.spyOn(api, 'put').mockResolvedValue({ ok: true, publicada: version(3, 18) });
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('PlatformAdminConfiguracionComercialRoute (ADR-079 §3)', () => {
  it('muestra la versión vigente, el historial y el ejemplo del viaje de $700.000', async () => {
    render(<PlatformAdminConfiguracionComercialRoute />);
    expect(await screen.findByText(/Versión vigente: 2/)).toBeInTheDocument();
    expect(getSpy).toHaveBeenCalledWith('/admin/configuracion-comercial');
    expect(screen.getByText('nota v1')).toBeInTheDocument();
    // Spot 20 %: comisión $140.000, total generador $840.000.
    const ejemplo = screen.getByTestId('ejemplo-spot');
    expect(ejemplo).toHaveTextContent('140.000');
    expect(ejemplo).toHaveTextContent('840.000');
  });

  it('el ejemplo se recalcula al editar la tasa spot', async () => {
    const user = userEvent.setup();
    render(<PlatformAdminConfiguracionComercialRoute />);
    const spot = await screen.findByLabelText('Comisión carga spot (%)');
    await user.clear(spot);
    await user.type(spot, '18');
    expect(screen.getByTestId('ejemplo-spot')).toHaveTextContent('126.000');
  });

  it('invariante rota (spot ≤ programada) → muestra el error y no deja publicar', async () => {
    const user = userEvent.setup();
    render(<PlatformAdminConfiguracionComercialRoute />);
    const spot = await screen.findByLabelText('Comisión carga spot (%)');
    await user.clear(spot);
    await user.type(spot, '9');
    await user.type(screen.getByLabelText('Nota del cambio'), 'prueba');
    expect(screen.getByText(/spot_pct debe ser mayor que programada_pct/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publicar versión nueva' })).toBeDisabled();
  });

  it('sin nota no deja publicar; con nota publica y recarga', async () => {
    const user = userEvent.setup();
    render(<PlatformAdminConfiguracionComercialRoute />);
    const boton = await screen.findByRole('button', { name: 'Publicar versión nueva' });
    expect(boton).toBeDisabled();

    await user.type(screen.getByLabelText('Nota del cambio'), 'ajuste de prueba');
    await user.click(boton);

    await waitFor(() =>
      expect(putSpy).toHaveBeenCalledWith('/admin/configuracion-comercial', {
        config: version(2).config,
        nota_cambio: 'ajuste de prueba',
      }),
    );
    expect(await screen.findByText(/Versión 3 publicada/)).toBeInTheDocument();
    expect(getSpy).toHaveBeenCalledWith('/admin/configuracion-comercial');
  });

  it('error del servidor al publicar se muestra', async () => {
    putSpy.mockRejectedValueOnce(new ApiError(422, 'configuracion_invalida', {}));
    const user = userEvent.setup();
    render(<PlatformAdminConfiguracionComercialRoute />);
    await user.type(await screen.findByLabelText('Nota del cambio'), 'x');
    await user.click(screen.getByRole('button', { name: 'Publicar versión nueva' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo publicar');
  });

  it('403 → acceso restringido', async () => {
    getSpy.mockRejectedValue(new ApiError(403, 'forbidden_platform_admin', {}));
    render(<PlatformAdminConfiguracionComercialRoute />);
    expect(await screen.findByText(/Solo el equipo de plataforma/)).toBeInTheDocument();
  });

  it('otro error al cargar se muestra', async () => {
    getSpy.mockRejectedValue(new Error('red'));
    render(<PlatformAdminConfiguracionComercialRoute />);
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo cargar');
  });
});

describe('contrato programado (ADR-079 §2)', () => {
  it('lista generadores y habilita uno', async () => {
    putSpy.mockResolvedValueOnce({
      ok: true,
      generador: {
        ...GEN,
        activadoEn: '2026-10-08T12:00:00.000Z',
        activadoPor: 'admin@boosterchile.com',
      },
    });
    const user = userEvent.setup();
    render(<PlatformAdminConfiguracionComercialRoute />);
    expect(await screen.findByText('Exportadora Uno SpA')).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'Habilitar contrato programado de Exportadora Uno SpA' }),
    );
    await waitFor(() =>
      expect(putSpy).toHaveBeenCalledWith(
        `/admin/configuracion-comercial/contrato-programado/${GEN.empresaId}`,
        { activo: true },
      ),
    );
  });

  it('un generador habilitado muestra quién lo habilitó y permite deshabilitar', async () => {
    getSpy.mockImplementation(async (path: string) =>
      path === '/admin/configuracion-comercial/contrato-programado'
        ? {
            generadores: [
              {
                ...GEN,
                activadoEn: '2026-10-08T12:00:00.000Z',
                activadoPor: 'admin@boosterchile.com',
              },
            ],
          }
        : { publicada: version(2), historial: [version(2)] },
    );
    render(<PlatformAdminConfiguracionComercialRoute />);
    expect(await screen.findByText(/Habilitado por admin@boosterchile.com/)).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: 'Deshabilitar contrato programado de Exportadora Uno SpA',
      }),
    ).toBeInTheDocument();
  });

  it('error al cambiar se muestra', async () => {
    putSpy.mockRejectedValueOnce(new Error('red'));
    const user = userEvent.setup();
    render(<PlatformAdminConfiguracionComercialRoute />);
    await user.click(
      await screen.findByRole('button', {
        name: 'Habilitar contrato programado de Exportadora Uno SpA',
      }),
    );
    expect(
      await screen.findByText(/No se pudo cambiar el contrato programado/),
    ).toBeInTheDocument();
  });
});
