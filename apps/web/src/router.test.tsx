import { describe, expect, it } from 'vitest';
import { router } from './router.js';

describe('router', () => {
  it('exporta un Router de TanStack válido', () => {
    expect(router).toBeDefined();
    expect(router.options.routeTree).toBeDefined();
  });

  it('defaultPreload="intent" para link prefetch on hover', () => {
    expect(router.options.defaultPreload).toBe('intent');
  });

  it('routeTree tiene paths esperados', () => {
    // Extrae los paths de los hijos del root.
    const root = router.routeTree;
    const children = (root.children ?? []) as ReadonlyArray<{ path?: string }>;
    const paths = children.map((c) => c.path).filter(Boolean);
    expect(paths).toEqual(
      expect.arrayContaining([
        '/',
        'login',
        'onboarding',
        'app',
        'app/ofertas',
        'app/perfil',
        'app/admin/dispositivos',
        'app/vehiculos',
        'app/vehiculos/nuevo',
        'app/vehiculos/$id',
        'app/vehiculos/$id/live',
        'app/cargas',
        'app/cargas/nueva',
        'app/cargas/$id',
        'app/cargas/$id/track',
        'app/certificados',
        'app/asignaciones/$id',
      ]),
    );
  });
});
