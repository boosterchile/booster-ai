# FIX-010 — Componente EmptyState consistente

> **Severidad**: 🟡 Menor (cosmético)
> **Issue**: [../issues/010-empty-states.md](../issues/010-empty-states.md)
> **Test**: agregar test en `tests/bugs/empty-states.spec.ts` durante el fix

## 1. Resumen

`/app/admin/dispositivos` muestra solo texto plano cuando está vacío,
mientras `/app/ofertas` y `/app/certificados` tienen icono + descripción
+ CTA. Inconsistencia.

## 2. Plan

1. Crear componente reutilizable `<EmptyState />`.
2. Migrar las 3 páginas existentes a usarlo.
3. Documentar el componente para uso futuro.

## 3. Implementación

### 3.1 Componente

```tsx
// components/EmptyState.tsx
import { ReactNode } from 'react';

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: {
    label: string;
    href?: string;
    onClick?: () => void;
  };
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-12 px-4 rounded-lg border border-dashed border-neutral-300">
      {icon && (
        <div className="mb-4 text-neutral-400">
          {icon}
        </div>
      )}
      <h3 className="text-lg font-semibold text-neutral-900">{title}</h3>
      {description && (
        <p className="mt-2 max-w-md text-sm text-neutral-600">{description}</p>
      )}
      {action && (
        <div className="mt-6">
          {action.href ? (
            <Link href={action.href} className="btn-primary">
              {action.label}
            </Link>
          ) : (
            <button onClick={action.onClick} className="btn-primary">
              {action.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
```

### 3.2 `/app/admin/dispositivos`

```tsx
// antes
{devices.length === 0 && (
  <p>No hay dispositivos pendientes.</p>
)}

// después
{devices.length === 0 && (
  <EmptyState
    icon={<DeviceIcon className="h-12 w-12" />}
    title="Aún no hay dispositivos pendientes"
    description="Cuando un dispositivo Teltonika se conecte por primera vez al gateway, aparecerá aquí esperando que lo asocies a un vehículo."
    action={{ label: 'Ver mis vehículos', href: '/app/vehiculos' }}
  />
)}
```

### 3.3 Refactor de `/app/ofertas` y `/app/certificados`

Reemplazar la implementación actual ad-hoc por el componente compartido:

```tsx
// /app/ofertas
<EmptyState
  icon={<InboxIcon className="h-12 w-12" />}
  title="No hay ofertas activas ahora"
  description="Cuando un generador de carga publique una compatible con tus zonas y vehículos, la verás aquí. Mantenemos esta vista actualizada cada 30 segundos."
/>

// /app/certificados
<EmptyState
  icon={<MedalIcon className="h-12 w-12" />}
  title="Aún no tienes certificados emitidos"
  description="Cuando un viaje entregado se confirme como recibido, el sistema genera el certificado automáticamente. Te avisaremos por email."
  action={{ label: 'Ver mis cargas', href: '/app/cargas' }}
/>
```

> **Nota**: el copy de ejemplo arriba ya aplica los fixes BUG-007 (jerga)
> y BUG-008 (tuteo). Si esos están pendientes, considerar hacerlos en el
> mismo PR.

## 4. Test nuevo

```ts
// tests/bugs/empty-states.spec.ts
import { test, expect } from '@playwright/test';

const ROUTES_GENERADOR = ['/app/cargas', '/app/certificados'];

test.describe('FIX-010: empty states consistentes @bug', () => {
  test('certificados muestra EmptyState completo', async ({ page }) => {
    await page.goto('/app/certificados');
    await expect(page.getByRole('heading', { name: /Aún no tienes certificados/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /Ver mis cargas/ })).toBeVisible();
  });
});

test.describe('FIX-010 — admin/dispositivos @bug @transportista', () => {
  test.use({ storageState: '.auth/transportista.json' });

  test('dispositivos pendientes muestra EmptyState completo', async ({ page }) => {
    await page.goto('/app/admin/dispositivos');
    await expect(page.getByRole('heading', { name: /Aún no hay dispositivos/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /Ver mis vehículos/ })).toBeVisible();
  });
});
```

## 5. Storybook (opcional)

Si el repo usa Storybook, agregar story:

```tsx
// EmptyState.stories.tsx
export const Sencilla = () => <EmptyState title="Sin resultados" />;
export const ConDescripcion = () => (
  <EmptyState title="Sin elementos" description="Cuando agregues uno, aparece aquí." />
);
export const ConCTA = () => (
  <EmptyState
    title="Sin cargas"
    description="Crea tu primera carga para comenzar."
    action={{ label: 'Crear carga', href: '/app/cargas/nueva' }}
  />
);
```

## 6. Verificación

### 6.1 Test automático

```bash
npm test -- bugs/empty-states
```

### 6.2 Manual

| Ruta | Esperado |
|---|---|
| `/app/admin/dispositivos` | Card centrada con icono, título, descripción, botón "Ver mis vehículos". |
| `/app/ofertas` (vacío) | Mismo pattern visual. |
| `/app/certificados` (vacío) | Mismo pattern visual. |

## 7. Definition of Done

- [ ] Componente `EmptyState` creado.
- [ ] 3 páginas migradas.
- [ ] Test nuevo verde.
- [ ] Story en Storybook (si aplica).
- [ ] Commit `feat(ui): EmptyState consistente en 3 vistas (BUG-010)`.
