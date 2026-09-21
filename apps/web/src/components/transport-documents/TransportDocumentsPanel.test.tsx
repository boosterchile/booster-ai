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

  it('error de lista → mensaje vos, no crash', async () => {
    listMock.mockRejectedValue(new ApiError(403, 'forbidden', null));
    renderPanel();
    expect(await screen.findByText(/No tenés permiso para este viaje/)).toBeInTheDocument();
  });

  it('Descargá con storage null → banner de error', async () => {
    listMock.mockResolvedValue([makeDoc()]);
    downloadMock.mockRejectedValue(new ApiError(503, 'storage_unavailable', null));
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Descargá' }));
    expect(
      await screen.findByText('El archivo no se pudo guardar (storage). Reintentá más tarde.'),
    ).toBeInTheDocument();
  });

  it('manual-entry llena ruts/fecha/monto y cambia tipo; error se muestra', async () => {
    listMock.mockResolvedValue([makeDoc({ extractionStatus: 'fallido' })]);
    manualMock.mockRejectedValue(new ApiError(500, 'update_failed', null));
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Completar a mano' }));
    fireEvent.change(screen.getByLabelText('Tipo'), { target: { value: '33' } });
    fireEvent.change(screen.getByLabelText('Folio'), { target: { value: '9' } });
    fireEvent.change(screen.getByLabelText('RUT emisor'), { target: { value: '76.000.000-0' } });
    fireEvent.change(screen.getByLabelText('RUT receptor'), { target: { value: '11.111.111-1' } });
    fireEvent.change(screen.getByLabelText('Fecha de emisión'), {
      target: { value: '2026-09-01' },
    });
    fireEvent.change(screen.getByLabelText('Monto'), { target: { value: '1500.50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardá' }));
    await waitFor(() =>
      expect(manualMock).toHaveBeenCalledWith(
        DOC_ID,
        expect.objectContaining({
          doc_type: '33',
          folio: '9',
          rut_emisor: '76.000.000-0',
          rut_receptor: '11.111.111-1',
          fecha_emision: '2026-09-01',
          monto_total: '1500.50',
        }),
      ),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(/No se pudo guardar/);
  });

  it('Cancelar cierra el form manual', async () => {
    listMock.mockResolvedValue([makeDoc({ extractionStatus: 'pendiente' })]);
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Completar a mano' }));
    expect(screen.getByTestId('manual-entry-form')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByTestId('manual-entry-form')).toBeNull();
  });

  it('compacto con docs muestra el conteo en el summary', async () => {
    listMock.mockResolvedValue([
      makeDoc(),
      makeDoc({ id: '33333333-3333-4333-8333-333333333333' }),
    ]);
    renderPanel({ compact: true });
    expect(await screen.findByText(/Documentos de transporte \(2\)/)).toBeInTheDocument();
  });
});
