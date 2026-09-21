import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api-client.js';
import type { TransportDocumentListItem } from '../../lib/transport-documents-api.js';

const listMock = vi.fn();
const uploadMock = vi.fn();
const downloadMock = vi.fn();
const manualMock = vi.fn();

vi.mock('../../lib/transport-documents-api.js', async () => {
  const actual = await vi.importActual<typeof import('../../lib/transport-documents-api.js')>(
    '../../lib/transport-documents-api.js',
  );
  return {
    ...actual,
    listTransportDocuments: (...args: unknown[]) => listMock(...args),
    uploadTransportDocument: (...args: unknown[]) => uploadMock(...args),
    openTransportDocumentDownload: (...args: unknown[]) => downloadMock(...args),
    submitManualEntry: (...args: unknown[]) => manualMock(...args),
  };
});

const { TransportDocumentsPanel } = await import('./TransportDocumentsPanel.js');

const TRIP_ID = '11111111-1111-4111-8111-111111111111';
const DOC_ID = '22222222-2222-4222-8222-222222222222';

function makeDoc(over: Partial<TransportDocumentListItem> = {}): TransportDocumentListItem {
  return {
    id: DOC_ID,
    docType: 'other',
    folio: null,
    fileMime: 'application/pdf',
    extractionStatus: 'pendiente',
    source: 'pdf_upload',
    fechaEmision: null,
    montoTotal: null,
    retentionUntil: null,
    createdAt: '2026-09-21T04:00:00.000Z',
    ...over,
  };
}

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

function renderPanel(props: { canWrite?: boolean; compact?: boolean } = {}) {
  const Wrapper = makeWrapper();
  return render(
    <Wrapper>
      <TransportDocumentsPanel
        tripId={TRIP_ID}
        canWrite={props.canWrite ?? true}
        {...(props.compact ? { compact: true } : {})}
      />
    </Wrapper>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  listMock.mockResolvedValue([]);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('TransportDocumentsPanel', () => {
  it('vacío + CTA vos de subida', async () => {
    renderPanel();
    expect(await screen.findByText(/Todavía no hay documentos/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Subí un PDF o una foto/ })).toBeInTheDocument();
    expect(screen.getByTestId('transport-docs-panel')).toHaveAttribute('data-trip-id', TRIP_ID);
  });

  it('lista un doc pendiente con status humano y Descargá', async () => {
    listMock.mockResolvedValue([makeDoc({ folio: '100', docType: '52' })]);
    renderPanel();
    expect(await screen.findByText(/Guía de despacho 52/)).toBeInTheDocument();
    expect(screen.getByText('Pendiente')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Descargá' })).toBeInTheDocument();
  });

  it('subí un PDF → llama upload con tripId y muestra pendiente tras refetch', async () => {
    uploadMock.mockResolvedValue({ documentId: DOC_ID, extractionStatus: 'pendiente' });
    listMock.mockResolvedValueOnce([]).mockResolvedValueOnce([makeDoc()]);
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText(/Todavía no hay documentos/);
    const input = screen.getByTestId('transport-doc-file') as HTMLInputElement;
    const file = new File(['%PDF'], 'guia.pdf', { type: 'application/pdf' });
    await user.upload(input, file);
    await waitFor(() => expect(uploadMock).toHaveBeenCalledWith(TRIP_ID, file));
    expect(await screen.findByText(/Documento subido/)).toBeInTheDocument();
    expect(await screen.findByText('Pendiente')).toBeInTheDocument();
  });

  it('503 storage_unavailable → copy contratado, no crash', async () => {
    uploadMock.mockRejectedValue(new ApiError(503, 'storage_unavailable', null));
    const user = userEvent.setup();
    renderPanel();
    await screen.findByRole('button', { name: /Subí/ });
    const input = screen.getByTestId('transport-doc-file') as HTMLInputElement;
    await user.upload(input, new File(['%PDF'], 'guia.pdf', { type: 'application/pdf' }));
    expect(
      await screen.findByText('El archivo no se pudo guardar (storage). Reintentá más tarde.'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('transport-docs-panel')).toBeInTheDocument();
  });

  it('sin canWrite no muestra Subí ni Completar a mano', async () => {
    listMock.mockResolvedValue([makeDoc({ extractionStatus: 'fallido' })]);
    renderPanel({ canWrite: false });
    expect(await screen.findByText('Falló la lectura')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Subí/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Completar a mano/ })).toBeNull();
  });

  it('fallido → Completar a mano → Guardá llama manual-entry', async () => {
    listMock.mockResolvedValue([makeDoc({ extractionStatus: 'fallido' })]);
    manualMock.mockResolvedValue({
      documentId: DOC_ID,
      extractionStatus: 'ingreso_manual',
      retentionUntil: '2032-09-01',
    });
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Completar a mano' }));
    expect(screen.getByTestId('manual-entry-form')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Folio'), { target: { value: '555' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardá' }));
    await waitFor(() =>
      expect(manualMock).toHaveBeenCalledWith(
        DOC_ID,
        expect.objectContaining({ doc_type: '52', folio: '555' }),
      ),
    );
  });

  it('Descargá abre el helper de signed URL', async () => {
    listMock.mockResolvedValue([makeDoc()]);
    downloadMock.mockResolvedValue(undefined);
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Descargá' }));
    await waitFor(() => expect(downloadMock).toHaveBeenCalledWith(DOC_ID));
  });

  it('compacto usa details con el mismo tripId', async () => {
    renderPanel({ compact: true });
    const panel = await screen.findByTestId('transport-docs-panel');
    expect(panel.tagName).toBe('DETAILS');
    expect(panel).toHaveAttribute('data-trip-id', TRIP_ID);
    expect(screen.getByText(/Documentos de transporte/)).toBeInTheDocument();
  });
});
