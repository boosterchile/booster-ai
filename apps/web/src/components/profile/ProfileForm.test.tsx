import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../../lib/api-client.js';
import { ProfileForm } from './ProfileForm.js';

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

function renderForm(initial: Parameters<typeof ProfileForm>[0]['initial']) {
  const Wrapper = makeWrapper();
  return render(
    <Wrapper>
      <ProfileForm initial={initial} />
    </Wrapper>,
  );
}

const INITIAL_DEFAULT = {
  full_name: 'Felipe Vicencio',
  phone: '+56912345678',
  whatsapp_e164: '+56912345678',
  rut: '12.345.678-5',
};

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('ProfileForm — render', () => {
  it('precarga valores iniciales en los inputs', () => {
    renderForm(INITIAL_DEFAULT);
    expect(screen.getByLabelText(/Nombre completo/)).toHaveValue('Felipe Vicencio');
    expect(screen.getByLabelText(/Teléfono móvil/)).toHaveValue('+56912345678');
    expect(screen.getByLabelText(/WhatsApp/)).toHaveValue('+56912345678');
  });

  it('RUT existente → input deshabilitado y muestra hint de inmutable', () => {
    renderForm(INITIAL_DEFAULT);
    expect(screen.getByLabelText(/RUT/)).toBeDisabled();
    expect(screen.getByText(/no se puede modificar/)).toBeInTheDocument();
  });

  it('RUT null → input habilitado', () => {
    renderForm({ ...INITIAL_DEFAULT, rut: null });
    expect(screen.getByLabelText(/RUT/)).not.toBeDisabled();
    expect(screen.getByText(/Una vez declarado/)).toBeInTheDocument();
  });
});

describe('ProfileForm — validación', () => {
  it('teléfono inválido → error onBlur', async () => {
    renderForm(INITIAL_DEFAULT);
    const input = screen.getByLabelText(/Teléfono móvil/);
    fireEvent.change(input, { target: { value: 'no-es-tel' } });
    fireEvent.blur(input);
    expect(await screen.findByText(/Número de teléfono Chile inválido/)).toBeInTheDocument();
  });

  it('full_name vacío al blur → error', async () => {
    renderForm(INITIAL_DEFAULT);
    const input = screen.getByLabelText(/Nombre completo/);
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    expect(await screen.findByText(/El nombre debe tener entre 1 y 200/)).toBeInTheDocument();
  });
});

describe('ProfileForm — submit', () => {
  it('sin cambios (no dirty) → no PATCH al API + muestra mensaje guardado', async () => {
    const spy = vi.spyOn(api, 'patch').mockResolvedValue({});
    renderForm(INITIAL_DEFAULT);
    fireEvent.click(screen.getByRole('button', { name: /Guardar cambios/ }));
    await waitFor(() => expect(screen.getByText(/Cambios guardados/)).toBeInTheDocument());
    expect(spy).not.toHaveBeenCalled();
  });

  it('cambia full_name → PATCH solo con full_name', async () => {
    const spy = vi.spyOn(api, 'patch').mockResolvedValueOnce({});
    renderForm(INITIAL_DEFAULT);
    fireEvent.change(screen.getByLabelText(/Nombre completo/), {
      target: { value: 'Felipe Updated' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Guardar cambios/ }));
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith('/me/profile', { full_name: 'Felipe Updated' }),
    );
  });

  it('cambia phone (válido) → PATCH solo con phone', async () => {
    const spy = vi.spyOn(api, 'patch').mockResolvedValueOnce({});
    renderForm(INITIAL_DEFAULT);
    fireEvent.change(screen.getByLabelText(/Teléfono móvil/), {
      target: { value: '+56987654321' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Guardar cambios/ }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith('/me/profile', { phone: '+56987654321' }));
  });

  it('cambia whatsapp_e164 → PATCH', async () => {
    const spy = vi.spyOn(api, 'patch').mockResolvedValueOnce({});
    renderForm({ ...INITIAL_DEFAULT, whatsapp_e164: null });
    fireEvent.change(screen.getByLabelText(/WhatsApp/), { target: { value: '+56987654321' } });
    fireEvent.click(screen.getByRole('button', { name: /Guardar cambios/ }));
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith('/me/profile', { whatsapp_e164: '+56987654321' }),
    );
  });

  it('completa RUT (cuando estaba null) → PATCH con rut', async () => {
    const spy = vi.spyOn(api, 'patch').mockResolvedValueOnce({});
    renderForm({ ...INITIAL_DEFAULT, rut: null });
    fireEvent.change(screen.getByLabelText(/RUT/), { target: { value: '12.345.678-5' } });
    fireEvent.click(screen.getByRole('button', { name: /Guardar cambios/ }));
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith(
        '/me/profile',
        expect.objectContaining({ rut: expect.any(String) }),
      ),
    );
  });

  it('PATCH succeede → mensaje "Cambios guardados"', async () => {
    vi.spyOn(api, 'patch').mockResolvedValueOnce({});
    renderForm(INITIAL_DEFAULT);
    fireEvent.change(screen.getByLabelText(/Nombre completo/), {
      target: { value: 'Nuevo nombre' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Guardar cambios/ }));
    expect(await screen.findByText(/Cambios guardados/)).toBeInTheDocument();
  });
});

describe('ProfileForm — translateApiError', () => {
  it('rut_immutable → mensaje específico', async () => {
    vi.spyOn(api, 'patch').mockRejectedValueOnce(new ApiError(409, 'rut_immutable', null));
    renderForm(INITIAL_DEFAULT);
    fireEvent.change(screen.getByLabelText(/Nombre completo/), {
      target: { value: 'Otro nombre' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Guardar cambios/ }));
    expect(await screen.findByText(/No se puede modificar el RUT/)).toBeInTheDocument();
  });

  it('user_not_found → mensaje vuelve al onboarding', async () => {
    vi.spyOn(api, 'patch').mockRejectedValueOnce(new ApiError(404, 'user_not_found', null));
    renderForm(INITIAL_DEFAULT);
    fireEvent.change(screen.getByLabelText(/Nombre completo/), {
      target: { value: 'Otro nombre' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Guardar cambios/ }));
    expect(await screen.findByText(/Vuelve al onboarding/)).toBeInTheDocument();
  });

  it('error 5xx → mensaje genérico de servidor', async () => {
    vi.spyOn(api, 'patch').mockRejectedValueOnce(new ApiError(500, 'internal', null));
    renderForm(INITIAL_DEFAULT);
    fireEvent.change(screen.getByLabelText(/Nombre completo/), {
      target: { value: 'Otro nombre' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Guardar cambios/ }));
    expect(await screen.findByText(/Error del servidor/)).toBeInTheDocument();
  });

  it('ApiError 4xx con message → muestra el message', async () => {
    vi.spyOn(api, 'patch').mockRejectedValueOnce(
      new ApiError(400, 'unknown_thing', null, 'mensaje del backend'),
    );
    renderForm(INITIAL_DEFAULT);
    fireEvent.change(screen.getByLabelText(/Nombre completo/), {
      target: { value: 'Otro nombre' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Guardar cambios/ }));
    expect(await screen.findByText(/mensaje del backend/)).toBeInTheDocument();
  });
});
