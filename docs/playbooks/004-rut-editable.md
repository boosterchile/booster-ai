# FIX-004 — RUT readonly en perfil

> **Severidad**: 🔴 Crítico (defensa de identidad)
> **Issue**: [../issues/004-rut-editable.md](../issues/004-rut-editable.md)
> **Test**: `tests/bugs/perfil-rut.spec.ts`

## 1. Resumen

`/app/perfil` muestra "Tu RUT no se puede modificar" pero el `<input>` no
tiene `readOnly` ni `disabled`. El usuario lo edita libremente y "Guardar
cambios" se habilita.

## 2. Localización

```bash
grep -rn "Tu RUT no se puede modificar\|RUT.*readonly\|<RutInput\|rut.*input" \
  apps/ src/ --include="*.tsx"

# Buscar el form de perfil
grep -rn "Mi cuenta\|/app/perfil\|nombre completo\|Tel.fono m.vil" \
  apps/ src/ --include="*.tsx"
```

## 3. Plan

1. Añadir `readOnly` (o `disabled`) al `<input>` del RUT.
2. Cambiar el styling para indicar visualmente el estado no-editable
   (gris, sin focus ring).
3. Asegurar que `react-hook-form` (o el state local) excluya el RUT de
   los valores enviados al guardar.
4. Defensa en backend: en `PATCH /me`, omitir `rut` del body aceptable.

## 4. Implementación

### 4.1 Frontend

```tsx
// Antes
<Input
  id="rut"
  value={user.rut}
  onChange={(e) => setRut(e.target.value)}
/>

// Después
<Input
  id="rut"
  value={user.rut}
  readOnly
  className="bg-neutral-100 text-neutral-600 cursor-not-allowed"
  aria-describedby="rut-help"
/>
<p id="rut-help" className="text-xs text-neutral-500">
  Tu RUT no se puede modificar.{' '}
  <a href="mailto:soporte@boosterchile.com" className="underline">
    Contacta a soporte
  </a>{' '}
  si necesitas cambiarlo.
</p>
```

Si el form usa `react-hook-form`:

```tsx
const { register } = useForm({
  defaultValues: { rut: user.rut, /* … */ },
});

<input {...register('rut')} readOnly />
// Y al guardar, excluir rut del payload:
const onSubmit = handleSubmit(({ rut, ...rest }) => {
  fetch('/api/me', {
    method: 'PATCH',
    body: JSON.stringify(rest),  // sin rut
  });
});
```

### 4.2 Backend — defensa

```ts
// app/api/me/route.ts
export async function PATCH(req: Request) {
  const body = await req.json();
  // Schema explícito que NO incluye rut
  const profileUpdateSchema = z.object({
    full_name: z.string().min(2).max(100),
    phone: z.string().regex(/^\+56 ?9 ?\d{4} ?\d{4}$/).optional(),
    whatsapp: z.string().regex(/^\+56 ?9 ?\d{4} ?\d{4}$/).optional(),
    // rut: NO está
  });
  const parsed = profileUpdateSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error }, { status: 400 });
  await db.users.update({ where: { id }, data: parsed.data });
  return Response.json({ success: true });
}
```

Cualquier cliente que intente enviar `rut` recibe 400 (`unrecognized_keys`
en Zod si usás `.strict()`).

## 5. Verificación

### 5.1 Test automático

```bash
npm test -- bugs/perfil-rut
```

Debe pasar de FAIL a PASS (2 tests).

### 5.2 Manual

1. Login como Generador.
2. Ir a `/app/perfil`.
3. Click en el campo RUT → cursor no-allowed, no acepta input.
4. Modificar nombre → "Guardar cambios" se habilita; RUT no.
5. Inspector de red al guardar: payload no contiene `rut`.

## 6. Riesgos

Si algún flujo administrativo legítimo necesita cambiar el RUT (corrección
de errores), debería ser una acción aparte (endpoint con permisos elevados,
no el form general de perfil).

## 7. Rollback

`git revert`. Test vuelve a fallar.

## 8. Definition of Done

- [ ] Input `readOnly` con styling claro de estado.
- [ ] Texto de ayuda con link a soporte.
- [ ] Backend rechaza `rut` en `PATCH /me`.
- [ ] `tests/bugs/perfil-rut.spec.ts` → 2/2 pass.
- [ ] Commit `fix(perfil): RUT readonly en cliente y servidor (BUG-004)`.
