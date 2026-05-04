# FIX-011 — Mi cuenta: cambiar contraseña + selector de empresa

> **Severidad**: 🟡 Menor (UX)
> **Issue**: [../issues/011-cuenta-funcionalidades.md](../issues/011-cuenta-funcionalidades.md)
> **Test**: agregar tests durante el fix

## 1. Resumen

Dos ausencias funcionales en `/app/perfil` y header:
1. **No hay forma de cambiar la contraseña** sin desvincular el método.
2. **No hay selector de empresa** si el usuario pertenece a varias.

## 2. Parte A — Cambiar contraseña

### 2.1 UI

```tsx
// components/AuthMethodCard.tsx
<AuthMethodCard
  icon={<KeyIcon />}
  name="Email + contraseña"
  status="vinculado"
  description={`Vinculada con ${user.email}`}
  actions={[
    {
      label: 'Cambiar contraseña',
      onClick: () => setChangePasswordOpen(true),
      variant: 'primary',
    },
    {
      label: 'Quitar',
      onClick: openUnlinkConfirm,
      variant: 'ghost',
    },
  ]}
/>

<ChangePasswordModal
  open={changePasswordOpen}
  onClose={() => setChangePasswordOpen(false)}
/>
```

### 2.2 Modal con re-auth

```tsx
// components/ChangePasswordModal.tsx
'use client';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
} from 'firebase/auth';
import { auth } from '@/lib/firebase';

const schema = z.object({
  currentPassword: z.string().min(1, 'Ingresa tu contraseña actual'),
  newPassword: z.string()
    .min(8, 'Mínimo 8 caracteres')
    .regex(/[A-Z]/, 'Al menos una mayúscula')
    .regex(/[a-z]/, 'Al menos una minúscula')
    .regex(/\d/, 'Al menos un número'),
  confirmPassword: z.string(),
}).refine(
  (d) => d.newPassword === d.confirmPassword,
  { path: ['confirmPassword'], message: 'No coincide con la nueva contraseña' },
);

export function ChangePasswordModal({ open, onClose }: Props) {
  const { register, handleSubmit, formState: { errors, isSubmitting }, setError } = useForm({
    resolver: zodResolver(schema),
  });

  const onSubmit = handleSubmit(async ({ currentPassword, newPassword }) => {
    const user = auth.currentUser;
    if (!user || !user.email) return;
    try {
      // Reautenticar (Firebase requiere para cambios sensibles)
      const cred = EmailAuthProvider.credential(user.email, currentPassword);
      await reauthenticateWithCredential(user, cred);
      await updatePassword(user, newPassword);
      onClose();
      toast.success('Contraseña actualizada');
    } catch (err: any) {
      if (err.code === 'auth/wrong-password') {
        setError('currentPassword', { message: 'Contraseña incorrecta' });
      } else {
        setError('root', { message: err.message });
      }
    }
  });

  return (
    <Modal open={open} onClose={onClose} title="Cambiar contraseña">
      <form onSubmit={onSubmit} className="space-y-4">
        <FormField label="Contraseña actual" error={errors.currentPassword?.message}>
          <input type="password" autoComplete="current-password" {...register('currentPassword')} />
        </FormField>
        <FormField label="Nueva contraseña" error={errors.newPassword?.message}>
          <input type="password" autoComplete="new-password" {...register('newPassword')} />
          <p className="text-xs text-neutral-500">
            Mínimo 8 caracteres, con mayúscula, minúscula y número.
          </p>
        </FormField>
        <FormField label="Confirmar nueva contraseña" error={errors.confirmPassword?.message}>
          <input type="password" autoComplete="new-password" {...register('confirmPassword')} />
        </FormField>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose}>Cancelar</button>
          <button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Cambiando…' : 'Cambiar contraseña'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
```

> **Nota**: política de password (8+ chars, mayús+minús+número) se aplica
> también al registro. Ver FIX-009 si se decide elevar el mínimo de 6 → 8
> en `/registro` también.

## 3. Parte B — Selector de empresa

### 3.1 Backend — endpoint para listar empresas del usuario

```ts
// app/api/me/companies/route.ts
export async function GET(req: Request) {
  const userId = await getUserIdFromAuth(req);
  const companies = await db.companyMembers.findMany({
    where: { user_id: userId },
    include: { company: true },
  });
  return Response.json(companies.map(m => ({
    id: m.company.id,
    name: m.company.legal_name,
    role: m.role,  // 'shipper' | 'carrier' | 'admin'
    is_active: m.is_active,
  })));
}
```

```ts
// app/api/me/active-company/route.ts
export async function POST(req: Request) {
  const { company_id } = await req.json();
  const userId = await getUserIdFromAuth(req);
  // verificar membership
  const member = await db.companyMembers.findFirst({
    where: { user_id: userId, company_id },
  });
  if (!member) return Response.json({ error: 'no_membership' }, { status: 403 });
  await db.users.update({
    where: { id: userId },
    data: { active_company_id: company_id },
  });
  return Response.json({ success: true });
}
```

### 3.2 UI — dropdown en el header

```tsx
// components/CompanySwitcher.tsx
'use client';
import { useQuery, useMutation } from '@tanstack/react-query';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/ui';

export function CompanySwitcher({ activeCompany }: Props) {
  const { data: companies } = useQuery({
    queryKey: ['my-companies'],
    queryFn: () => fetch('/api/me/companies').then(r => r.json()),
  });

  const switchCompany = useMutation({
    mutationFn: (companyId: string) =>
      fetch('/api/me/active-company', {
        method: 'POST',
        body: JSON.stringify({ company_id: companyId }),
      }),
    onSuccess: () => location.reload(),  // recarga simple para refrescar contexto
  });

  if (!companies || companies.length <= 1) {
    return <Badge>{activeCompany.name}</Badge>;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-1">
          <Badge>{activeCompany.name}</Badge>
          <ChevronDown className="h-3 w-3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {companies.map((c) => (
          <DropdownMenuItem
            key={c.id}
            disabled={c.id === activeCompany.id}
            onSelect={() => switchCompany.mutate(c.id)}
          >
            <RoleBadge role={c.role} />
            {c.name}
            {c.id === activeCompany.id && <Check className="ml-auto" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

### 3.3 Header

Reemplazar el `<Badge>{company.name}</Badge>` por `<CompanySwitcher … />`.

## 4. Tests nuevos

```ts
// tests/bugs/cambiar-password.spec.ts
test('Modal de cambiar contraseña pide actual + nueva + confirmación', async ({ page }) => {
  await page.goto('/app/perfil');
  await page.getByRole('button', { name: 'Cambiar contraseña' }).click();
  await expect(page.getByRole('heading', { name: 'Cambiar contraseña' })).toBeVisible();
  await expect(page.getByLabel('Contraseña actual')).toBeVisible();
  await expect(page.getByLabel('Nueva contraseña')).toBeVisible();
  await expect(page.getByLabel('Confirmar nueva contraseña')).toBeVisible();
});

// tests/bugs/company-switcher.spec.ts
test('Si el usuario tiene una empresa, no aparece selector', async ({ page }) => {
  await page.goto('/app');
  // no debe haber un dropdown trigger
  await expect(page.locator('[aria-haspopup="menu"]').filter({ hasText: 'Fuera de la Caja' })).toHaveCount(0);
});
```

(Test "tiene >1 empresa muestra selector" requiere setup con fixture que
no es trivial — anotar como manual hasta tener cuenta de prueba.)

## 5. Verificación manual

| Caso | Esperado |
|---|---|
| Click "Cambiar contraseña" en perfil | Modal abre con 3 inputs. |
| Ingresar contraseña actual incorrecta | Error inline en ese campo. |
| Nueva password "abc" | Error: mínimo 8 caracteres. |
| Confirmación distinta | Error inline en confirm. |
| Todo OK | Modal cierra, toast "Contraseña actualizada", próximo login con la nueva funciona. |
| Click badge empresa con 1 sola empresa | Sin dropdown. |
| Click badge empresa con 2+ empresas | Dropdown con opciones. |

## 6. Riesgos

- Re-auth con Firebase puede fallar si el usuario está autenticado solo
  con Google (no tiene password). En ese caso, mostrar mensaje y
  ofrecer "Vincular contraseña" en lugar de "Cambiar".
- Cambiar empresa puede romper queries cacheadas. `location.reload()` es
  pragmático; refactor con SWR/React Query revalidate sería más fino.

## 7. Definition of Done

- [ ] Modal de cambiar contraseña funcional con re-auth.
- [ ] Política mínima 8 chars + mayús/minús/número.
- [ ] Endpoint `/api/me/companies` y `/api/me/active-company`.
- [ ] `CompanySwitcher` dropdown en header.
- [ ] Tests nuevos verdes.
- [ ] Manual de los 7 casos.
- [ ] Commit `feat(perfil): cambiar contrasena y selector de empresa (BUG-011)`.
