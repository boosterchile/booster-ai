import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../../lib/api-client.js';

const navigateMock = vi.fn();
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
}));

const { OnboardingForm } = await import('./OnboardingForm.js');

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

function renderForm(
  props: Partial<Parameters<typeof OnboardingForm>[0]> = {
    firebaseEmail: 'felipe@boosterchile.com',
  },
) {
  const Wrapper = makeWrapper();
  return render(
    <Wrapper>
      <OnboardingForm
        firebaseEmail={props.firebaseEmail ?? 'felipe@boosterchile.com'}
        firebaseName={props.firebaseName}
      />
    </Wrapper>,
  );
}

async function fillStep1AndAdvance() {
  fireEvent.change(screen.getByLabelText(/Nombre completo/), {
    target: { value: 'Felipe Vicencio' },
  });
  fireEvent.change(screen.getByLabelText(/Teléfono móvil/), { target: { value: '+56912345678' } });
  fireEvent.change(screen.getByLabelText(/^WhatsApp/), { target: { value: '+56912345678' } });
  // RUT marcado opcional pero el schema rechaza string vacío. Pasamos uno válido.
  fireEvent.change(screen.getByLabelText(/^RUT/), { target: { value: '11.111.111-1' } });
  fireEvent.click(screen.getByRole('button', { name: /Siguiente/ }));
  await screen.findByText('Tu empresa');
}

async function fillStep2AndAdvance() {
  fireEvent.change(screen.getByLabelText(/Razón social/), { target: { value: 'Booster SpA' } });
  fireEvent.change(screen.getByLabelText(/RUT empresa/), { target: { value: '76.123.456-0' } });
  fireEvent.change(screen.getByLabelText(/Email de contacto/), {
    target: { value: 'contacto@booster.cl' },
  });
  fireEvent.change(screen.getByLabelText(/Teléfono de contacto/), {
    target: { value: '+56912345678' },
  });
  fireEvent.change(screen.getByLabelText(/^Dirección/), {
    target: { value: 'Av. Apoquindo 4500' },
  });
  fireEvent.change(screen.getByLabelText(/^Comuna/), { target: { value: 'Las Condes' } });
  fireEvent.change(screen.getByLabelText(/^Ciudad/), { target: { value: 'Santiago' } });
  fireEvent.click(screen.getByRole('button', { name: /Siguiente/ }));
  await screen.findByText(/¿Cómo opera tu empresa?/);
}

async function fillStep3AndAdvance() {
  fireEvent.click(screen.getByRole('button', { name: /Generador de carga/ }));
  fireEvent.click(screen.getByRole('button', { name: /Siguiente/ }));
  await screen.findByText(/Resumen/);
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('OnboardingForm — render inicial', () => {
  it('arranca en step 1 con título "Tus datos"', () => {
    renderForm();
    expect(screen.getByText('Tus datos')).toBeInTheDocument();
    expect(screen.getByLabelText(/Nombre completo/)).toBeInTheDocument();
  });

  it('progress indicator marca step 1 como current', () => {
    renderForm();
    const stepLabels = screen.getAllByText(/^[1-4]$/);
    expect(stepLabels.length).toBeGreaterThanOrEqual(1);
  });

  it('botón Atrás invisible (disabled) en step 1', () => {
    renderForm();
    const backBtn = screen.getByRole('button', { name: /Atrás/ });
    expect(backBtn).toBeDisabled();
  });

  it('firebaseName prefill → input nombre tiene valor', () => {
    renderForm({ firebaseName: 'Felipe Pre' });
    expect(screen.getByLabelText(/Nombre completo/)).toHaveValue('Felipe Pre');
  });
});

describe('OnboardingForm — navegación entre steps', () => {
  it('step 1 con datos válidos → avanza a step 2', async () => {
    renderForm();
    await fillStep1AndAdvance();
    expect(screen.getByText('Tu empresa')).toBeInTheDocument();
  });

  it('step 1 con teléfono inválido → no avanza, muestra error', async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText(/Nombre completo/), { target: { value: 'Felipe' } });
    fireEvent.change(screen.getByLabelText(/Teléfono móvil/), { target: { value: 'no-tel' } });
    fireEvent.click(screen.getByRole('button', { name: /Siguiente/ }));
    // Se quedan al menos 2 errores (teléfono y RUT vacío). Validamos por el rol y que no haya avanzado.
    const alerts = await screen.findAllByRole('alert');
    expect(alerts.length).toBeGreaterThan(0);
    expect(screen.queryByText('Tu empresa')).not.toBeInTheDocument();
  });

  it('step 2 → 3 → 4 navegación completa', async () => {
    renderForm();
    await fillStep1AndAdvance();
    await fillStep2AndAdvance();
    await fillStep3AndAdvance();
    // En step 4 hay título h2 "Plan" + label de progreso "Plan" → buscar el heading.
    expect(screen.getByRole('heading', { name: 'Plan' })).toBeInTheDocument();
  });

  it('Atrás retrocede al step anterior', async () => {
    renderForm();
    await fillStep1AndAdvance();
    fireEvent.click(screen.getByRole('button', { name: /Atrás/ }));
    expect(await screen.findByText('Tus datos')).toBeInTheDocument();
  });
});

describe('OnboardingForm — step 3 toggles', () => {
  it('toggle "Generador" → aria-pressed=true', async () => {
    renderForm();
    await fillStep1AndAdvance();
    await fillStep2AndAdvance();
    const toggle = screen.getByRole('button', { name: /Generador de carga/ });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
  });

  it('toggle "Transportista" → aria-pressed=true independiente', async () => {
    renderForm();
    await fillStep1AndAdvance();
    await fillStep2AndAdvance();
    const toggle = screen.getByRole('button', { name: /^Transportista/ });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('OnboardingForm — step 4 plan + summary', () => {
  it('plan default "gratis" preseleccionado en summary', async () => {
    renderForm();
    await fillStep1AndAdvance();
    await fillStep2AndAdvance();
    await fillStep3AndAdvance();
    expect(screen.getByText(/gratis/)).toBeInTheDocument();
  });

  it('seleccionar plan Estándar → summary actualiza', async () => {
    renderForm();
    await fillStep1AndAdvance();
    await fillStep2AndAdvance();
    await fillStep3AndAdvance();
    fireEvent.click(screen.getByRole('button', { name: /Estándar/ }));
    expect(screen.getByText(/estandar/)).toBeInTheDocument();
  });

  it('summary muestra empresa + rut + operación + plan', async () => {
    renderForm();
    await fillStep1AndAdvance();
    await fillStep2AndAdvance();
    await fillStep3AndAdvance();
    expect(screen.getByText('Booster SpA')).toBeInTheDocument();
    expect(screen.getByText('76.123.456-0')).toBeInTheDocument();
    expect(screen.getAllByText(/Generador de carga/).length).toBeGreaterThan(0);
  });
});

describe('OnboardingForm — submit', () => {
  it('happy path: POST /empresas/onboarding + navigate /app', async () => {
    const postSpy = vi.spyOn(api, 'post').mockResolvedValueOnce({
      user: { id: 'u' },
      empresa: { id: 'emp-uuid' },
      membership: { id: 'm', role: 'dueno', status: 'activa' },
    });
    renderForm();
    await fillStep1AndAdvance();
    await fillStep2AndAdvance();
    await fillStep3AndAdvance();
    fireEvent.click(screen.getByRole('button', { name: /Crear empresa/ }));
    await waitFor(() =>
      expect(postSpy).toHaveBeenCalledWith('/empresas/onboarding', expect.any(Object)),
    );
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith({ to: '/app' }));
  });

  it('error rut_already_registered → mensaje específico', async () => {
    vi.spyOn(api, 'post').mockRejectedValueOnce(new ApiError(409, 'rut_already_registered', null));
    renderForm();
    await fillStep1AndAdvance();
    await fillStep2AndAdvance();
    await fillStep3AndAdvance();
    fireEvent.click(screen.getByRole('button', { name: /Crear empresa/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/RUT empresa ya está registrado/);
  });

  it('error 5xx → mensaje genérico', async () => {
    vi.spyOn(api, 'post').mockRejectedValueOnce(new ApiError(500, 'internal', null));
    renderForm();
    await fillStep1AndAdvance();
    await fillStep2AndAdvance();
    await fillStep3AndAdvance();
    fireEvent.click(screen.getByRole('button', { name: /Crear empresa/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/error en nuestro lado/);
  });

  for (const [code, regex] of [
    ['user_already_registered', /Ya tienes una empresa registrada/],
    ['email_in_use', /email ya está registrado/],
    ['invalid_plan', /plan seleccionado no está disponible/],
    ['firebase_email_missing', /sesión no tiene email/],
  ] as const) {
    it(`error ${code} → ${regex}`, async () => {
      vi.spyOn(api, 'post').mockRejectedValueOnce(new ApiError(400, code, null));
      renderForm();
      await fillStep1AndAdvance();
      await fillStep2AndAdvance();
      await fillStep3AndAdvance();
      fireEvent.click(screen.getByRole('button', { name: /Crear empresa/ }));
      expect(await screen.findByRole('alert')).toHaveTextContent(regex);
    });
  }
});
