# FIX-006 — Responsive móvil: tabla de cargas + header

> **Severidad**: 🔴 Crítico (target principal: celular)
> **Issue**: [../issues/006-mobile-responsive.md](../issues/006-mobile-responsive.md)
> **Test**: `tests/bugs/mobile-responsive.spec.ts`

## 1. Resumen

En viewport `375×667` (iPhone SE) y `390×844` (iPhone 13):
- `/app/cargas`: tabla genera scroll horizontal (overflow), columnas se cortan.
- Header: `Booster AI` se rompe en 2 líneas, badge empresa en 3, `Salir`
  truncado a `Sali...`.
- Botones partidos innecesariamente.

## 2. Plan

1. Tabla de cargas → cards apiladas en `<md` (Tailwind `md:` = ≥768px).
2. Header: colapsar nombre+empresa+salir en menú hamburguesa en `<sm`.
3. Reducir padding y typography en mobile.

## 3. Localización

```bash
# Componente de tabla de cargas
grep -rn "Mis cargas\|Cargas activas\|Historial" apps/ src/ --include="*.tsx"

# AppHeader
grep -rn "AppHeader\|<header.*Salir\|Cerrar sesión" apps/ src/ --include="*.tsx"
```

## 4. Implementación

### 4.1 Tabla → cards

```tsx
// components/CargasList.tsx
import { formatDate } from '@/lib/date';
import { Badge, Card } from '@/ui';

export function CargasList({ cargas }: { cargas: Carga[] }) {
  if (cargas.length === 0) return <EmptyState … />;
  return (
    <>
      {/* Desktop: tabla */}
      <div className="hidden md:block">
        <table className="w-full">
          <thead>
            <tr>
              <th>Código</th>
              <th>Origen → Destino</th>
              <th>Carga</th>
              <th>Pickup</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {cargas.map((c) => <CargaRow key={c.id} carga={c} />)}
          </tbody>
        </table>
      </div>

      {/* Mobile: cards apiladas */}
      <ul className="md:hidden space-y-3">
        {cargas.map((c) => (
          <li key={c.id}>
            <Card className="p-4">
              <Link href={`/app/cargas/${c.id}`} className="block">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-sm font-semibold">
                    {c.tracking_code}
                  </span>
                  <Badge variant={statusVariant(c.status)}>
                    {statusLabel(c.status)}
                  </Badge>
                </div>
                <p className="mt-2 text-sm text-neutral-700">
                  {c.origin_address_raw}
                </p>
                <p className="text-xs text-neutral-500">
                  → {c.destination_address_raw}
                </p>
                <div className="mt-2 flex items-center gap-3 text-xs text-neutral-500">
                  <span>{c.cargo_type_label}</span>
                  <span>•</span>
                  <span>{c.cargo_weight_kg.toLocaleString('es-CL')} kg</span>
                  <span>•</span>
                  <span>{formatDate(c.pickup_window_start)}</span>
                </div>
              </Link>
            </Card>
          </li>
        ))}
      </ul>
    </>
  );
}
```

### 4.2 AppHeader responsive

```tsx
// components/AppHeader.tsx
'use client';
import { useState } from 'react';
import { LogOut, Menu, X } from 'lucide-react';

export function AppHeader({ user, company }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <header className="border-b bg-white">
      <div className="flex items-center justify-between px-4 py-3 sm:px-6">
        <Link href="/app" className="flex items-center gap-2 shrink-0">
          <Logo className="h-6 w-6" />
          <span className="font-semibold">Booster AI</span>
        </Link>

        {/* Desktop */}
        <div className="hidden sm:flex items-center gap-3">
          <Badge>{company.name}</Badge>
          <Link href="/app/perfil" className="flex items-center gap-2">
            <UserIcon />
            <span>{user.full_name}</span>
          </Link>
          <button onClick={signOut} aria-label="Cerrar sesión">
            <LogOut /> Salir
          </button>
        </div>

        {/* Mobile: hamburguesa */}
        <button
          className="sm:hidden p-2"
          aria-label={open ? 'Cerrar menú' : 'Abrir menú'}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <X /> : <Menu />}
        </button>
      </div>

      {/* Mobile: panel desplegado */}
      {open && (
        <div className="sm:hidden border-t bg-white px-4 py-3 space-y-3">
          <div className="text-xs text-neutral-500">Empresa activa</div>
          <Badge>{company.name}</Badge>
          <Link
            href="/app/perfil"
            className="flex items-center gap-2 py-2"
            onClick={() => setOpen(false)}
          >
            <UserIcon /> {user.full_name}
          </Link>
          <button
            onClick={signOut}
            className="flex items-center gap-2 py-2 text-rose-600"
          >
            <LogOut /> Salir
          </button>
        </div>
      )}
    </header>
  );
}
```

### 4.3 Tweaks adicionales

- Botón "Nueva carga": `whitespace-nowrap` para que no se parta.
- Badge "Cargado" / "Asignado": tamaño `xs` en mobile.
- Tablas en `/app/vehiculos` aplicar el mismo patrón cards-en-mobile.

```tsx
<Link href="/app/cargas/nueva" className="whitespace-nowrap">
  <PlusIcon /> Nueva carga
</Link>
```

## 5. Verificación

### 5.1 Test automático

```bash
npm test -- bugs/mobile-responsive
```

3 tests, debe pasar de FAIL a PASS.

### 5.2 Manual

DevTools → modo responsive:

| Viewport | Verificar |
|---|---|
| iPhone SE 375×667 | Sin scroll horizontal en `/app/cargas`. Header muestra hamburguesa. |
| iPhone 13 390×844 | Idem. |
| iPad Mini 768×1024 | Tabla normal (no cards). Header normal. |
| Desktop 1440 | Sin cambios visibles. |

## 6. Riesgos

- Romper layouts desktop si las clases `md:` se aplican al revés.
- Dropdowns/menús que dependían de hover desktop deben tener variante touch.

## 7. Rollback

`git revert`.

## 8. Definition of Done

- [ ] Tabla de cargas tiene vista cards en mobile.
- [ ] Tabla de vehículos también (consistencia).
- [ ] AppHeader colapsa a hamburguesa en `<sm`.
- [ ] `tests/bugs/mobile-responsive.spec.ts` → 3/3 pass.
- [ ] Smoke desktop sigue verde.
- [ ] Verificación manual en 4 viewports.
- [ ] Commit `fix(mobile): tabla responsive y header con menu (BUG-006)`.
