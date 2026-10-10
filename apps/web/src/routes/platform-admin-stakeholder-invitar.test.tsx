import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

/**
 * Invitación a una organización stakeholder: el código de activación se
 * entrega SOLO por esta pantalla (no hay correo), así que tiene que quedar
 * visible después de invitar. Regresión hallada por el E2E de T10-10: el
 * formulario se cerraba al terminar y se llevaba el código con él.
 */
vi.mock('../components/ProtectedRoute.js', () => ({
  ProtectedRoute: ({ children }: { children: (ctx: { kind: 'unmanaged' }) => ReactNode }) => (
    <>{children({ kind: 'unmanaged' })}</>
  ),
}));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, ...rest }: { children: ReactNode; to: string }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('../components/ImpersonationPicker.js', () => ({
  ImpersonationPicker: () => <div />,
}));

const ORG_ID = '00000000-0000-4000-8000-0000000000a1';
const ORG = {
  id: ORG_ID,
  nombre_legal: 'Observatorio Uno',
  tipo: 'observatorio_academico',
  region_ambito: 'CL-CO',
  sector_ambito: null,
  creado_por_admin_id: '00000000-0000-4000-8000-0000000000a2',
  creado_en: '2026-10-09T12:00:00.000Z',
  actualizado_en: '2026-10-09T12:00:00.000Z',
  eliminado_en: null,
};

const post = vi.fn();
vi.mock('../lib/api-client.js', () => ({
  api: {
    get: vi.fn(async (path: string) =>
      path === `/admin/stakeholder-orgs/${ORG_ID}`
        ? { ...ORG, miembros: [] }
        : { organizations: [ORG] },
    ),
    post: (...args: unknown[]) => post(...args),
    patch: vi.fn(),
  },
  ApiError: class ApiError extends Error {},
}));

const { PlatformAdminStakeholdersRoute } = await import('./platform-admin.js');

async function invitar() {
  const user = userEvent.setup();
  render(<PlatformAdminStakeholdersRoute />);
  await user.click(await screen.findByTestId(`stakeholder-org-toggle-${ORG_ID}`));
  await user.click(await screen.findByTestId(`stakeholder-org-invite-toggle-${ORG_ID}`));
  await user.type(screen.getByTestId(`stakeholder-org-invite-rut-${ORG_ID}`), '75757575-2');
  await user.type(
    screen.getByTestId(`stakeholder-org-invite-email-${ORG_ID}`),
    'analista@observatorio.cl',
  );
  await user.type(screen.getByTestId(`stakeholder-org-invite-name-${ORG_ID}`), 'Analista Uno');
  await user.click(screen.getByTestId(`stakeholder-org-invite-submit-${ORG_ID}`));
}

describe('invitar miembro stakeholder', () => {
  it('el código de activación queda visible tras invitar', async () => {
    post.mockResolvedValueOnce({ codigo_activacion: '482915', expira_en: '2026-10-16' });
    await invitar();
    const aviso = await screen.findByTestId('stakeholder-codigo');
    expect(aviso).toHaveTextContent('482915');
    // WCAG 4.1.3 (T10-11): el resultado se anuncia desde una región viva.
    expect(aviso.closest('output, [role="status"]')).not.toBeNull();
    // Sigue visible después de recargar la lista de miembros.
    await waitFor(() => expect(screen.getByTestId('stakeholder-codigo')).toBeInTheDocument());
  });

  it('si la persona ya tiene cuenta, el aviso de vínculo queda visible', async () => {
    post.mockResolvedValueOnce({ vinculo: 'cuenta_activa', status: 'activa' });
    await invitar();
    const vinculo = await screen.findByTestId('stakeholder-vinculo');
    expect(vinculo).toHaveTextContent('Esta persona ya tiene cuenta');
    expect(vinculo.closest('output, [role="status"]')).not.toBeNull();
  });
});
