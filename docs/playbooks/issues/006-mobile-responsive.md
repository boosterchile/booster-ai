# BUG-006 — Mobile: tabla "Mis cargas" hace overflow + header se rompe

| | |
|---|---|
| **Severidad** | 🔴 Crítico (target principal: celular) |
| **Componente** | `AppHeader`, `/app/cargas` (tablas) |
| **Detectado** | 2026-05-04 |
| **Test** | `tests/bugs/mobile-responsive.spec.ts` |

## Descripción

En viewport móvil (verificado en iPhone SE 375×667 e iPhone 13 390×844), la
app tiene dos problemas de layout:

### 1. Tabla `/app/cargas` hace overflow horizontal

`document.body.scrollWidth = 391` > `clientWidth = 375` → scroll horizontal.
Las columnas `Pickup` y `Estado` se cortan o salen del viewport.

### 2. Header se rompe

- "Booster AI" se rompe en 2 líneas: "Booster" + "AI".
- Badge "Fuera de la Caja" se parte en 3 líneas.
- Botón "Salir" se trunca a "Sali..." en `/app/cargas/nueva`.
- Botón "Nueva carga" innecesariamente partido en 2 líneas.

## Repro

1. DevTools → modo responsive → iPhone SE.
2. Login + ir a `/app/cargas`.
3. Observar overflow en eje X.
4. Ir a `/app/cargas/nueva`. Observar header roto.

## Esperado

- Tablas de listado se transforman en cards apiladas en breakpoint `<md`
  (Tailwind: `<768px`).
- Header colapsa el nombre de empresa o lo mueve a un menú hamburguesa.
- "Salir" siempre visible y completo.

## Fix sugerido

### Tabla → cards en mobile

```tsx
<div className="hidden md:block">
  {/* tabla actual */}
  <table>...</table>
</div>
<div className="md:hidden space-y-3">
  {cargas.map(c => (
    <Card key={c.id}>
      <div className="flex justify-between">
        <span className="font-mono text-sm">{c.tracking_code}</span>
        <Badge>{c.status}</Badge>
      </div>
      <p className="mt-2 text-sm">{c.origin} → {c.destination}</p>
      <p className="text-xs text-neutral-500">{formatDate(c.pickup_start)}</p>
    </Card>
  ))}
</div>
```

### Header responsive

```tsx
<header className="flex items-center justify-between px-4 py-2">
  <Logo className="shrink-0" />
  {/* En desktop: nombre+empresa+salir */}
  <div className="hidden sm:flex items-center gap-3">
    <CompanyBadge />
    <UserMenu />
    <LogoutButton />
  </div>
  {/* En mobile: avatar + menú colapsado */}
  <button className="sm:hidden" aria-label="Abrir menú" onClick={...}>
    <MenuIcon />
  </button>
</header>
```

## Capturas

`.playwright-mcp/mobile-cargas-nueva.png`, `mobile-mis-cargas.png`.
