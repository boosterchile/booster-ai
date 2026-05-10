import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mockear use-chat-messages — no queremos correr SSE/queries reales aquí.
const useChatMessagesMock = vi.fn();
vi.mock('../../hooks/use-chat-messages.js', () => ({
  useChatMessages: useChatMessagesMock,
}));

// Mockear chat-api — los mutations de send se prueban acá.
const sendChatMessageMock = vi.fn();
const sendPhotoMessageMock = vi.fn();
const sendLocationMessageMock = vi.fn();
const fetchPhotoDownloadUrlMock = vi.fn();
vi.mock('../../lib/chat-api.js', () => ({
  sendChatMessage: sendChatMessageMock,
  sendPhotoMessage: sendPhotoMessageMock,
  sendLocationMessage: sendLocationMessageMock,
  fetchPhotoDownloadUrl: fetchPhotoDownloadUrlMock,
}));

// VehicleMap usa Google Maps; reemplazamos por stub.
vi.mock('../map/VehicleMap.js', () => ({
  VehicleMap: ({ latitude, longitude }: { latitude: number; longitude: number }) => (
    <div data-testid="vehicle-map">{`map ${latitude},${longitude}`}</div>
  ),
}));

const { ChatPanel } = await import('./ChatPanel.js');

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

function renderPanel(props: Partial<Parameters<typeof ChatPanel>[0]> = {}) {
  const Wrapper = makeWrapper();
  return render(
    <Wrapper>
      <ChatPanel assignmentId="a1" {...props} />
    </Wrapper>,
  );
}

const SAMPLE_TEXT_MSG = {
  id: 'm1',
  type: 'texto',
  text: 'hola',
  created_at: '2026-05-10T10:00:00Z',
  sender_role: 'carrier',
  sender_name: 'Felipe',
  read_at: null,
  photo_gcs_uri: null,
  location_lat: null,
  location_lng: null,
};

const SAMPLE_LOCATION_MSG = {
  id: 'm2',
  type: 'ubicacion',
  text: null,
  created_at: '2026-05-10T10:01:00Z',
  sender_role: 'shipper',
  sender_name: 'Ana',
  read_at: null,
  photo_gcs_uri: null,
  location_lat: -33.45,
  location_lng: -70.65,
};

const SAMPLE_PHOTO_MSG = {
  id: 'm3',
  type: 'foto',
  text: null,
  created_at: '2026-05-10T10:02:00Z',
  sender_role: 'shipper',
  sender_name: 'Ana',
  read_at: null,
  photo_gcs_uri: 'gs://bucket/foo.jpg',
  location_lat: null,
  location_lng: null,
};

function defaultHookReturn(over: Record<string, unknown> = {}) {
  return {
    messages: [],
    viewerRole: 'carrier' as const,
    isLoading: false,
    error: null,
    hasMore: false,
    loadMore: vi.fn(),
    isLive: true,
    isLoadingMore: false,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useChatMessagesMock.mockReturnValue(defaultHookReturn());
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('ChatPanel — header', () => {
  it('default title "Chat" + status En vivo', () => {
    renderPanel();
    expect(screen.getByText('Chat')).toBeInTheDocument();
    expect(screen.getByText('En vivo')).toBeInTheDocument();
  });

  it('title + subtitle custom', () => {
    renderPanel({ title: 'Chat con Ana', subtitle: 'Carga BST-001' });
    expect(screen.getByText('Chat con Ana')).toBeInTheDocument();
    expect(screen.getByText('Carga BST-001')).toBeInTheDocument();
  });

  it('isLive=false → muestra "Reconectando…"', () => {
    useChatMessagesMock.mockReturnValue(defaultHookReturn({ isLive: false }));
    renderPanel();
    expect(screen.getByText('Reconectando…')).toBeInTheDocument();
  });

  it('onClose presente → renderiza X', () => {
    const onClose = vi.fn();
    renderPanel({ onClose });
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar chat' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('sin onClose → no X', () => {
    renderPanel();
    expect(screen.queryByRole('button', { name: 'Cerrar chat' })).not.toBeInTheDocument();
  });
});

describe('ChatPanel — estados de la lista', () => {
  it('isLoading → muestra "Cargando mensajes"', () => {
    useChatMessagesMock.mockReturnValue(defaultHookReturn({ isLoading: true }));
    renderPanel();
    expect(screen.getByText(/Cargando mensajes/)).toBeInTheDocument();
  });

  it('error → mensaje de fallo de carga', () => {
    useChatMessagesMock.mockReturnValue(defaultHookReturn({ error: new Error('boom') }));
    renderPanel();
    expect(screen.getByText(/No pudimos cargar/)).toBeInTheDocument();
  });

  it('lista vacía + readOnly=false → empezar conversación', () => {
    renderPanel();
    expect(screen.getByText(/Empezá la conversación/)).toBeInTheDocument();
  });

  it('lista vacía + readOnly=true → "Este chat ya está cerrado"', () => {
    renderPanel({ readOnly: true });
    expect(screen.getByText(/Este chat ya está cerrado/)).toBeInTheDocument();
  });
});

describe('ChatPanel — render mensajes', () => {
  it('mensaje texto del otro lado → muestra body + nombre', () => {
    useChatMessagesMock.mockReturnValue(
      defaultHookReturn({
        messages: [{ ...SAMPLE_TEXT_MSG, sender_role: 'shipper' }],
      }),
    );
    renderPanel();
    expect(screen.getByText('hola')).toBeInTheDocument();
    expect(screen.getByText('Felipe')).toBeInTheDocument();
  });

  it('mensaje propio (mismo rol que viewer) → no muestra nombre del sender', () => {
    useChatMessagesMock.mockReturnValue(
      defaultHookReturn({
        messages: [{ ...SAMPLE_TEXT_MSG, sender_role: 'carrier' }],
      }),
    );
    renderPanel();
    expect(screen.getByText('hola')).toBeInTheDocument();
    expect(screen.queryByText('Felipe')).not.toBeInTheDocument();
  });

  it('mensaje propio leído → muestra "Leído"', () => {
    useChatMessagesMock.mockReturnValue(
      defaultHookReturn({
        messages: [
          {
            ...SAMPLE_TEXT_MSG,
            sender_role: 'carrier',
            read_at: '2026-05-10T10:01:00Z',
          },
        ],
      }),
    );
    renderPanel();
    expect(screen.getByText(/Leído/)).toBeInTheDocument();
  });

  it('mensaje ubicacion → renderiza VehicleMap stub', () => {
    useChatMessagesMock.mockReturnValue(defaultHookReturn({ messages: [SAMPLE_LOCATION_MSG] }));
    renderPanel();
    expect(screen.getByTestId('vehicle-map')).toBeInTheDocument();
    expect(screen.getByText(/Ubicación compartida/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Abrir en Google Maps/ })).toHaveAttribute(
      'href',
      expect.stringContaining('-33.45,-70.65'),
    );
  });

  it('mensaje sin contenido → fallback "Mensaje sin contenido"', () => {
    useChatMessagesMock.mockReturnValue(
      defaultHookReturn({
        messages: [{ ...SAMPLE_TEXT_MSG, type: 'desconocido', text: null }],
      }),
    );
    renderPanel();
    expect(screen.getByText('Mensaje sin contenido')).toBeInTheDocument();
  });
});

describe('ChatPanel — paginación', () => {
  it('hasMore=true → botón "Cargar más viejos"', () => {
    const loadMore = vi.fn();
    useChatMessagesMock.mockReturnValue(
      defaultHookReturn({ messages: [SAMPLE_TEXT_MSG], hasMore: true, loadMore }),
    );
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /Cargar más viejos/ }));
    expect(loadMore).toHaveBeenCalled();
  });

  it('isLoadingMore=true → botón disabled + texto "Cargando…"', () => {
    useChatMessagesMock.mockReturnValue(
      defaultHookReturn({
        messages: [SAMPLE_TEXT_MSG],
        hasMore: true,
        isLoadingMore: true,
      }),
    );
    renderPanel();
    const btn = screen.getByRole('button', { name: /Cargando…/ });
    expect(btn).toBeDisabled();
  });
});

describe('ChatPanel — composer texto', () => {
  it('readOnly=true → no muestra composer', () => {
    renderPanel({ readOnly: true });
    expect(screen.queryByPlaceholderText(/Escribe un mensaje/)).not.toBeInTheDocument();
  });

  it('escribir + click enviar → sendChatMessage llamado', async () => {
    sendChatMessageMock.mockResolvedValueOnce({ id: 'm-new' });
    renderPanel();
    const textarea = screen.getByPlaceholderText(/Escribe un mensaje/);
    fireEvent.change(textarea, { target: { value: 'hola mundo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));
    await waitFor(() =>
      expect(sendChatMessageMock).toHaveBeenCalledWith({
        assignmentId: 'a1',
        body: { type: 'texto', text: 'hola mundo' },
      }),
    );
  });

  it('Enter sin Shift → submit', async () => {
    sendChatMessageMock.mockResolvedValueOnce({ id: 'm-new' });
    renderPanel();
    const textarea = screen.getByPlaceholderText(/Escribe un mensaje/);
    fireEvent.change(textarea, { target: { value: 'enter test' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    await waitFor(() => expect(sendChatMessageMock).toHaveBeenCalled());
  });

  it('Enter+Shift → no submit (newline)', () => {
    renderPanel();
    const textarea = screen.getByPlaceholderText(/Escribe un mensaje/);
    fireEvent.change(textarea, { target: { value: 'no submit' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });
    expect(sendChatMessageMock).not.toHaveBeenCalled();
  });

  it('texto vacío → botón disabled', () => {
    renderPanel();
    expect(screen.getByRole('button', { name: 'Enviar' })).toBeDisabled();
  });

  it('texto solo whitespace → no submit aunque clickee Enviar', () => {
    renderPanel();
    const textarea = screen.getByPlaceholderText(/Escribe un mensaje/);
    fireEvent.change(textarea, { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));
    expect(sendChatMessageMock).not.toHaveBeenCalled();
  });
});

describe('ChatPanel — composer foto + ubicación', () => {
  it('seleccionar archivo → sendPhotoMessage llamado', async () => {
    sendPhotoMessageMock.mockResolvedValueOnce({ id: 'm-photo' });
    renderPanel();
    const file = new File(['x'], 'foo.jpg', { type: 'image/jpeg' });
    // El input de archivo está oculto; lo encontramos por type=file.
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput).not.toBeNull();
    fireEvent.change(fileInput, { target: { files: [file] } });
    await waitFor(() =>
      expect(sendPhotoMessageMock).toHaveBeenCalledWith({ assignmentId: 'a1', file }),
    );
  });

  it('seleccionar archivo (sin file) → no llama send', () => {
    renderPanel();
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [] } });
    expect(sendPhotoMessageMock).not.toHaveBeenCalled();
  });

  it('click ubicación → sendLocationMessage', async () => {
    sendLocationMessageMock.mockResolvedValueOnce({ id: 'm-loc' });
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Compartir ubicación' }));
    await waitFor(() => expect(sendLocationMessageMock).toHaveBeenCalledWith('a1'));
  });

  it('error al enviar foto → window.alert', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    sendPhotoMessageMock.mockRejectedValueOnce(new Error('upload boom'));
    renderPanel();
    const file = new File(['x'], 'foo.jpg', { type: 'image/jpeg' });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [file] } });
    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
  });

  it('error al compartir ubicación → window.alert', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    sendLocationMessageMock.mockRejectedValueOnce(new Error('geo denied'));
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Compartir ubicación' }));
    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
  });
});

describe('ChatPanel — PhotoMessage', () => {
  it('foto loading → spinner visible', () => {
    fetchPhotoDownloadUrlMock.mockImplementation(() => new Promise<never>(() => undefined));
    useChatMessagesMock.mockReturnValue(defaultHookReturn({ messages: [SAMPLE_PHOTO_MSG] }));
    renderPanel();
    expect(screen.getByText(/Cargando foto/)).toBeInTheDocument();
  });

  it('foto OK → renderiza <img>', async () => {
    fetchPhotoDownloadUrlMock.mockResolvedValueOnce({ download_url: 'https://x/foo.jpg' });
    useChatMessagesMock.mockReturnValue(defaultHookReturn({ messages: [SAMPLE_PHOTO_MSG] }));
    renderPanel();
    expect(await screen.findByRole('img', { name: /Foto adjunta/ })).toHaveAttribute(
      'src',
      'https://x/foo.jpg',
    );
  });

  it('foto falla → mensaje "No se pudo cargar la foto"', async () => {
    fetchPhotoDownloadUrlMock.mockRejectedValue(new Error('signed url failed'));
    useChatMessagesMock.mockReturnValue(defaultHookReturn({ messages: [SAMPLE_PHOTO_MSG] }));
    renderPanel();
    // PhotoMessage tiene retry:1 → 2 intentos antes de mostrar error.
    expect(
      await screen.findByText(/No se pudo cargar la foto/, undefined, { timeout: 3000 }),
    ).toBeInTheDocument();
  });
});
