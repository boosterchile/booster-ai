import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api-client.js';
import type { InstruccionesRetiro } from '../../lib/instrucciones-retiro-api.js';

const getMock = vi.fn<(tripId: string) => Promise<InstruccionesRetiro | null>>();
const guardarMock =
  vi.fn<
    (
      tripId: string,
      campos: { file: File | null; lugar: string; nota: string },
    ) => Promise<InstruccionesRetiro>
  >();

vi.mock('../../lib/instrucciones-retiro-api.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../lib/instrucciones-retiro-api.js')>();
  return {
    ...real,
    getInstruccionesRetiro: (tripId: string) => getMock(tripId),
    guardarInstruccionesRetiro: (
      tripId: string,
      campos: { file: File | null; lugar: string; nota: string },
    ) => guardarMock(tripId, campos),
  };
});

const { InstruccionesRetiroPanel } = await import('./InstruccionesRetiroPanel.js');
const { InstruccionesRetiroConductor } = await import('./InstruccionesRetiroConductor.js');

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const CON_QR: InstruccionesRetiro = {
  lugar: 'Bodega Sur, Quilicura',
  nota: 'Andén 4, preguntar por Juan',
  archivo: { mime: 'image/png', url: 'https://signed.example/qr.png' },
  actualizado_en: '2026-11-09T15:00:00Z',
};

beforeEach(() => {
  getMock.mockReset();
  guardarMock.mockReset();
});

describe('InstruccionesRetiroPanel (generador)', () => {
  it('sin instrucciones invita a cargarlas', async () => {
    getMock.mockResolvedValue(null);
    render(<InstruccionesRetiroPanel tripId="t-1" canWrite />, { wrapper });
    expect(await screen.findByText(/Sin instrucciones/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cargar' })).toBeInTheDocument();
  });

  it('muestra lugar, nota y enlace al QR', async () => {
    getMock.mockResolvedValue(CON_QR);
    render(<InstruccionesRetiroPanel tripId="t-1" canWrite />, { wrapper });
    expect(await screen.findByText('Bodega Sur, Quilicura')).toBeInTheDocument();
    expect(screen.getByText('Andén 4, preguntar por Juan')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Ver QR/ })).toHaveAttribute(
      'href',
      'https://signed.example/qr.png',
    );
  });

  it('sin permiso de publicar no ofrece cargar ni reemplazar', async () => {
    getMock.mockResolvedValue(CON_QR);
    render(<InstruccionesRetiroPanel tripId="t-1" canWrite={false} />, { wrapper });
    expect(await screen.findByText('Bodega Sur, Quilicura')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Reemplazar|Cargar/ })).not.toBeInTheDocument();
  });

  it('guarda archivo, lugar y nota, y vuelve al resumen', async () => {
    getMock.mockResolvedValue(null);
    guardarMock.mockResolvedValue(CON_QR);
    render(<InstruccionesRetiroPanel tripId="t-1" canWrite />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: 'Cargar' }));
    const qr = new File([new Uint8Array([0x89, 0x50])], 'qr.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText(/QR o comprobante/), { target: { files: [qr] } });
    fireEvent.change(screen.getByLabelText('Lugar de retiro'), {
      target: { value: 'Bodega Sur, Quilicura' },
    });
    fireEvent.change(screen.getByLabelText('Nota para el conductor'), {
      target: { value: 'Andén 4, preguntar por Juan' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() =>
      expect(guardarMock).toHaveBeenCalledWith('t-1', {
        file: qr,
        lugar: 'Bodega Sur, Quilicura',
        nota: 'Andén 4, preguntar por Juan',
      }),
    );
    expect(await screen.findByRole('link', { name: /Ver QR/ })).toBeInTheDocument();
  });

  it('sin archivo ni nota no llama al API y lo explica', async () => {
    getMock.mockResolvedValue(null);
    render(<InstruccionesRetiroPanel tripId="t-1" canWrite />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: 'Cargar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/QR o comprobante, o una nota/);
    expect(guardarMock).not.toHaveBeenCalled();
  });

  it('un tipo de archivo no permitido se explica sin llamar al API', async () => {
    getMock.mockResolvedValue(null);
    render(<InstruccionesRetiroPanel tripId="t-1" canWrite />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: 'Cargar' }));
    const txt = new File(['hola'], 'qr.txt', { type: 'text/plain' });
    fireEvent.change(screen.getByLabelText(/QR o comprobante/), { target: { files: [txt] } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/no sirve/);
    expect(guardarMock).not.toHaveBeenCalled();
  });

  it('un error del API se muestra en español', async () => {
    getMock.mockResolvedValue(null);
    guardarMock.mockRejectedValue(new ApiError(503, 'storage_unavailable', null));
    render(<InstruccionesRetiroPanel tripId="t-1" canWrite />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: 'Cargar' }));
    fireEvent.change(screen.getByLabelText('Nota para el conductor'), {
      target: { value: 'Andén 4' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/no se pudo guardar/);
  });
});

describe('InstruccionesRetiroConductor', () => {
  it('muestra el QR como imagen grande con lugar y nota', async () => {
    getMock.mockResolvedValue(CON_QR);
    render(<InstruccionesRetiroConductor tripId="t-1" />, { wrapper });
    const img = await screen.findByRole('img', { name: /QR o comprobante/ });
    expect(img).toHaveAttribute('src', 'https://signed.example/qr.png');
    expect(screen.getByText('Bodega Sur, Quilicura')).toBeInTheDocument();
    expect(screen.getByText('Andén 4, preguntar por Juan')).toBeInTheDocument();
  });

  it('un PDF se abre con un enlace, no como imagen', async () => {
    getMock.mockResolvedValue({
      ...CON_QR,
      archivo: { mime: 'application/pdf', url: 'https://signed.example/c.pdf' },
    });
    render(<InstruccionesRetiroConductor tripId="t-1" />, { wrapper });
    expect(await screen.findByRole('link', { name: /Ver comprobante/ })).toHaveAttribute(
      'href',
      'https://signed.example/c.pdf',
    );
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('sin instrucciones no muestra nada', async () => {
    getMock.mockResolvedValue(null);
    const { container } = render(<InstruccionesRetiroConductor tripId="t-1" />, { wrapper });
    await waitFor(() => expect(getMock).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
