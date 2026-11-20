import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api-client.js';
import type { TransportDocumentListItem } from '../../lib/transport-documents-api.js';

const listMock = vi.fn<(tripId: string) => Promise<TransportDocumentListItem[]>>();
const openMock = vi.fn<(documentId: string) => Promise<void>>();

vi.mock('../../lib/transport-documents-api.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../lib/transport-documents-api.js')>();
  return {
    ...real,
    listTransportDocuments: (tripId: string) => listMock(tripId),
    openTransportDocumentDownload: (documentId: string) => openMock(documentId),
  };
});

const { DocumentosViajeConductor } = await import('./DocumentosViajeConductor.js');

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function doc(over: Partial<TransportDocumentListItem> = {}): TransportDocumentListItem {
  return {
    id: 'd-1',
    docType: '52',
    folio: '12345',
    fileMime: 'application/pdf',
    extractionStatus: 'decodificado',
    source: 'pdf_upload',
    fechaEmision: '2026-11-08',
    montoTotal: null,
    retentionUntil: null,
    createdAt: '2026-11-08T12:00:00Z',
    ...over,
  };
}

beforeEach(() => {
  listMock.mockReset();
  openMock.mockReset();
});

describe('DocumentosViajeConductor', () => {
  it('lista los documentos del viaje con tipo y folio', async () => {
    listMock.mockResolvedValue([doc(), doc({ id: 'd-2', docType: '33', folio: null })]);
    render(<DocumentosViajeConductor tripId="t-1" />, { wrapper });
    expect(await screen.findByText('Guía de despacho 52')).toBeInTheDocument();
    expect(screen.getByText(/Folio 12345/)).toBeInTheDocument();
    expect(screen.getByText('Factura 33')).toBeInTheDocument();
    expect(listMock).toHaveBeenCalledWith('t-1');
  });

  it('«Ver» abre el documento', async () => {
    listMock.mockResolvedValue([doc()]);
    openMock.mockResolvedValue(undefined);
    render(<DocumentosViajeConductor tripId="t-1" />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: /Ver Guía de despacho 52/ }));
    await waitFor(() => expect(openMock).toHaveBeenCalledWith('d-1'));
  });

  it('si no abre, lo dice sin tumbar la lista', async () => {
    listMock.mockResolvedValue([doc()]);
    openMock.mockRejectedValue(new ApiError(503, 'storage_unavailable', null));
    render(<DocumentosViajeConductor tripId="t-1" />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: /Ver Guía de despacho 52/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/no se pudo abrir/i);
    expect(screen.getByText('Guía de despacho 52')).toBeInTheDocument();
  });

  it('sin documentos explica que la oficina todavía no los carga', async () => {
    listMock.mockResolvedValue([]);
    render(<DocumentosViajeConductor tripId="t-1" />, { wrapper });
    expect(await screen.findByText(/todavía no carga/i)).toBeInTheDocument();
  });

  it('si el listado falla, avisa y deja reintentar', async () => {
    listMock.mockRejectedValueOnce(new ApiError(500, undefined, null));
    listMock.mockResolvedValueOnce([doc()]);
    render(<DocumentosViajeConductor tripId="t-1" />, { wrapper });
    expect(await screen.findByRole('alert')).toHaveTextContent(/no pudimos cargar/i);
    fireEvent.click(screen.getByRole('button', { name: /Reintentar/ }));
    expect(await screen.findByText('Guía de despacho 52')).toBeInTheDocument();
  });
});
