# BUG-011 — Mi cuenta: ausencias funcionales

| | |
|---|---|
| **Severidad** | 🟡 Menor (UX) |
| **Componente** | `/app/perfil` |
| **Detectado** | 2026-05-04 |

## 1. No hay forma de cambiar la contraseña

En `/app/perfil > Acceso a tu cuenta` aparece el método "Email + contraseña"
con dos opciones: estado `Vinculado` y botón `Quitar`. **No hay opción
"Cambiar contraseña"**.

Workaround actual: el usuario debe hacer logout, ir a "Olvidé mi contraseña",
recibir email y seguir el flujo de reset. Innecesariamente largo para una
acción frecuente.

### Fix sugerido

```tsx
<AuthMethodCard
  icon={<KeyIcon />}
  name="Email + contraseña"
  description={`Vinculada con ${user.email}`}
  status="vinculado"
  actions={[
    { label: "Cambiar contraseña", onClick: openChangePasswordModal },
    { label: "Quitar", onClick: unlinkPassword, variant: "ghost" },
  ]}
/>
```

Modal con 3 campos: contraseña actual, nueva, confirmación. Reauthenticar
con Firebase antes del cambio.

## 2. No hay selector de empresa visible

El badge "Fuera de la Caja" / "Los Tres Chanchitos" en el header parece
clickeable pero solo es display. El home dice "Empresa activa: X" sin opción
de cambiar.

Si un usuario está asociado a múltiples empresas (por ejemplo: empleado de
Shipper Inc y conductor de Transport SA), no hay forma de cambiar el
contexto desde la UI.

### Fix sugerido

```tsx
<DropdownMenu>
  <DropdownMenuTrigger>
    <Badge>{currentCompany.name}</Badge>
  </DropdownMenuTrigger>
  <DropdownMenuContent>
    {availableCompanies.map(c => (
      <DropdownMenuItem
        key={c.id}
        onSelect={() => switchCompany(c.id)}
        disabled={c.id === currentCompany.id}
      >
        <RoleBadge>{c.role}</RoleBadge>
        {c.name}
      </DropdownMenuItem>
    ))}
    <DropdownMenuSeparator />
    <DropdownMenuItem onSelect={openCreateCompanyModal}>
      + Nueva empresa
    </DropdownMenuItem>
  </DropdownMenuContent>
</DropdownMenu>
```

Si el modelo de datos ya soporta multi-empresa por usuario (que parece sí
por el JWT que vi), el back-end probablemente ya tiene el endpoint listo.
