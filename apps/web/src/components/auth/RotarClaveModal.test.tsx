import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../../lib/api-client.js';
import { RotarClaveModal } from './RotarClaveModal.js';

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('RotarClaveModal', () => {
  it('renderiza con título y campos de clave', () => {
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <RotarClaveModal />
      </Wrapper>,
    );
    expect(screen.getByText('Crea tu clave numérica')).toBeInTheDocument();
    expect(screen.getByTestId('rotar-clave-input')).toBeInTheDocument();
    expect(screen.getByTestId('rotar-clave-confirm-input')).toBeInTheDocument();
    expect(screen.getByTestId('rotar-clave-submit')).toBeInTheDocument();
  });

  it('clave de 5 dígitos → error inline sin llamar al API', async () => {
    const postSpy = vi.spyOn(api, 'post');
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <RotarClaveModal />
      </Wrapper>,
    );
    fireEvent.change(screen.getByTestId('rotar-clave-input'), { target: { value: '12345' } });
    fireEvent.change(screen.getByTestId('rotar-clave-confirm-input'), {
      target: { value: '12345' },
    });
    fireEvent.click(screen.getByTestId('rotar-clave-submit'));
    await waitFor(() =>
      expect(screen.getByText(/La clave debe ser exactamente 6 dígitos/i)).toBeInTheDocument(),
    );
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('claves no coinciden → error inline sin llamar al API', async () => {
    const postSpy = vi.spyOn(api, 'post');
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <RotarClaveModal />
      </Wrapper>,
    );
    fireEvent.change(screen.getByTestId('rotar-clave-input'), { target: { value: '123456' } });
    fireEvent.change(screen.getByTestId('rotar-clave-confirm-input'), {
      target: { value: '654321' },
    });
    fireEvent.click(screen.getByTestId('rotar-clave-submit'));
    await waitFor(() =>
      expect(screen.getByText(/Las dos claves no coinciden/i)).toBeInTheDocument(),
    );
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('happy path: llama POST /me/clave-numerica + invoca onSuccess', async () => {
    const postSpy = vi.spyOn(api, 'post').mockResolvedValue(undefined);
    const onSuccess = vi.fn();
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <RotarClaveModal onSuccess={onSuccess} />
      </Wrapper>,
    );
    fireEvent.change(screen.getByTestId('rotar-clave-input'), { target: { value: '123456' } });
    fireEvent.change(screen.getByTestId('rotar-clave-confirm-input'), {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByTestId('rotar-clave-submit'));
    await waitFor(() =>
      expect(postSpy).toHaveBeenCalledWith('/me/clave-numerica', {
        clave_anterior: null,
        clave_nueva: '123456',
      }),
    );
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
  });

  it('error 403 invalid_clave_anterior → mensaje claro', async () => {
    vi.spyOn(api, 'post').mockRejectedValue(
      new ApiError(403, 'forbidden', { code: 'invalid_clave_anterior' }, 'invalid_clave_anterior'),
    );
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <RotarClaveModal />
      </Wrapper>,
    );
    fireEvent.change(screen.getByTestId('rotar-clave-input'), { target: { value: '123456' } });
    fireEvent.change(screen.getByTestId('rotar-clave-confirm-input'), {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByTestId('rotar-clave-submit'));
    await waitFor(() =>
      expect(screen.getByText(/clave anterior no es correcta/i)).toBeInTheDocument(),
    );
  });

  it('error 400 → mensaje claro sobre 6 dígitos', async () => {
    vi.spyOn(api, 'post').mockRejectedValue(new ApiError(400, 'bad request', null, 'invalid_body'));
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <RotarClaveModal />
      </Wrapper>,
    );
    fireEvent.change(screen.getByTestId('rotar-clave-input'), { target: { value: '123456' } });
    fireEvent.change(screen.getByTestId('rotar-clave-confirm-input'), {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByTestId('rotar-clave-submit'));
    await waitFor(() =>
      expect(screen.getByText(/exactamente 6 dígitos numéricos/i)).toBeInTheDocument(),
    );
  });

  it('letras en input → se filtran (solo dígitos quedan)', () => {
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <RotarClaveModal />
      </Wrapper>,
    );
    const input = screen.getByTestId('rotar-clave-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'abc123def' } });
    expect(input.value).toBe('123');
  });

  it('mensaje custom override del default', () => {
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <RotarClaveModal message="Mensaje custom desde el wrapper" />
      </Wrapper>,
    );
    expect(screen.getByText('Mensaje custom desde el wrapper')).toBeInTheDocument();
  });
});
