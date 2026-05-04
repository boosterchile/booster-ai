# FIX-003 — AppHeader consistente en todas las rutas autenticadas

> **Severidad**: 🔴 Crítico (UX)
> **Issue**: [../issues/003-app-shell.md](../issues/003-app-shell.md)
> **Test**: `tests/bugs/layout-shell.spec.ts`

## 1. Resumen

El banner global (`Booster AI` + empresa + usuario + `Salir`) está ausente
en `/app/certificados` y `/app/admin/dispositivos`. El usuario pierde
navegación principal y acceso a "Salir" sin volver al home.

## 2. Localización

```bash
# Buscar el AppHeader / AppShell
grep -rn "AppHeader\|AppShell\|<Banner\|Salir" \
  apps/ src/ --include="*.tsx"

# Layouts del App Router
find apps/ src/ -name "layout.tsx" | xargs ls -la

# Las dos rutas afectadas
ls -la apps/*/app/certificados apps/*/app/admin/ 2>/dev/null
find apps/ src/ -path "*certificados*" -name "*.tsx"
find apps/ src/ -path "*admin/dispositivos*" -name "*.tsx"
```

## 3. Plan

Causa probable (Next App Router): existe un `app/(authenticated)/layout.tsx`
con el shell, pero `/app/certificados` y `/app/admin/dispositivos` viven
fuera del segmento `(authenticated)` o tienen su propio `layout.tsx` que
no lo extiende.

Pasos:
1. Ubicar el layout que aplica al resto de las rutas de `/app/*`.
2. Mover/anidar las dos rutas afectadas bajo el mismo segmento.
3. Si tienen layout propio, importar el `AppHeader` o eliminar el layout
   y dejar que herede.

## 4. Implementación

### Caso A: Next App Router con `(authenticated)`

Estructura objetivo:

```
app/
└── (authenticated)/
    ├── layout.tsx          ← contiene <AppHeader />
    └── app/
        ├── page.tsx        # /app
        ├── cargas/
        │   ├── page.tsx
        │   ├── nueva/page.tsx
        │   └── [id]/page.tsx
        ├── certificados/
        │   └── page.tsx    ← MOVER ACÁ si está fuera
        ├── admin/
        │   └── dispositivos/
        │       └── page.tsx   ← MOVER ACÁ
        └── perfil/page.tsx
```

Si las páginas tienen layouts propios:
```bash
# Ver si /app/certificados tiene layout.tsx propio
ls apps/web/app/app/certificados/
# → si hay layout.tsx, decidir: extenderlo o eliminarlo
```

### Caso B: layout propio que rompe el shell

Si existe `app/app/certificados/layout.tsx` o equivalente:

```tsx
// ANTES (mal)
export default function Layout({ children }: { children: React.ReactNode }) {
  return <main className="p-6">{children}</main>;  // sin header
}
```

```tsx
// DESPUÉS (correcto: heredar)
// Eliminar este archivo si no aporta nada propio.
// O si necesita styling extra:
export default function Layout({ children }: { children: React.ReactNode }) {
  return <div className="container mx-auto px-6 py-8">{children}</div>;
}
// El <AppHeader /> viene del layout superior.
```

### Caso C: rutas que escapan al middleware de auth

Verificar que `middleware.ts` proteja las rutas:

```ts
// middleware.ts
export const config = {
  matcher: ['/app/:path*'],  // debe cubrir /app/certificados y /app/admin/*
};
```

## 5. Verificación

### 5.1 Test automático

```bash
npm test -- bugs/layout-shell
```

Debe pasar de FAIL en 2 rutas a PASS en todas (10 tests: 5 generador + 5 transportista).

### 5.2 Manual

| Ruta | Esperado |
|---|---|
| `/app/certificados` | Banner global con logo + empresa + usuario + Salir. |
| `/app/admin/dispositivos` | Idem. |
| Resto de rutas | Sin cambios visibles. |

### 5.3 Verificación de regresión

Smoke test: navegar entre todas las rutas y confirmar que el banner persiste.

```bash
npm run test:smoke
```

## 6. Riesgos

- Si se mueven los archivos de path, los links existentes (`Link to=...`)
  no rompen porque las URLs no cambian (el segmento `(authenticated)` es
  silencioso en Next App Router — no aparece en la URL).
- Si se elimina un layout propio, verificar que no había estilos únicos
  que se pierden.

## 7. Rollback

`git revert`. Test vuelve a fallar.

## 8. Definition of Done

- [ ] Las 2 rutas viven bajo el mismo layout que el resto de `/app/*`.
- [ ] `tests/bugs/layout-shell.spec.ts` → 10/10 pass.
- [ ] Sin regresiones en `tests/smoke/`.
- [ ] Manual: navegar a las dos rutas y ver el banner.
- [ ] Commit `fix(layout): aplica AppShell en certificados y admin/dispositivos (BUG-003)`.
