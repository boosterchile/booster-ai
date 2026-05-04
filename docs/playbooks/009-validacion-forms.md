# FIX-009 — Validación de forms en perfil (teléfono, WhatsApp, RUT, nombre)

> **Severidad**: 🟡 Menor
> **Issue**: [../issues/009-validacion-forms.md](../issues/009-validacion-forms.md)
> **Test**: agregar `tests/bugs/perfil-validacion.spec.ts` durante el fix

## 1. Resumen

`/app/perfil` no valida ningún campo en cliente. Los inputs son `type="text"`
sin `pattern`, sin `required`, sin `minLength`. Riesgos:
- Teléfono y WhatsApp aceptan cualquier string.
- RUT con formato libre (placeholder con puntos pero el valor sin puntos).

> **Nota**: el RUT readonly se trata en [FIX-004](./004-rut-editable.md).

## 2. Reglas a aplicar

```ts
// packages/shared/schemas/profile.ts
import { z } from 'zod';

const CHILE_PHONE = /^\+56 ?9 ?\d{4} ?\d{4}$/;

export const profileUpdateSchema = z.object({
  full_name: z.string().trim()
    .min(2, 'Mínimo 2 caracteres')
    .max(100),
  phone: z.string()
    .regex(CHILE_PHONE, 'Formato esperado: +56 9 XXXX XXXX'),
  whatsapp: z.string()
    .regex(CHILE_PHONE, 'Formato esperado: +56 9 XXXX XXXX')
    .optional(),
  // rut: NO está — readonly, ver FIX-004
});
```

## 3. Implementación

### 3.1 Frontend

Migrar a `react-hook-form` + `zodResolver` (mismo patrón que FIX-001).

Inputs específicos:

```tsx
<FormField label="Teléfono móvil" error={errors.phone?.message}>
  <input
    {...register('phone')}
    type="tel"
    inputMode="tel"
    autoComplete="tel"
    placeholder="+56 9 1234 5678"
  />
  <p className="text-xs text-neutral-500">
    Lo usamos para notificaciones críticas.
  </p>
</FormField>

<FormField label="WhatsApp" error={errors.whatsapp?.message}>
  <input
    {...register('whatsapp')}
    type="tel"
    inputMode="tel"
    autoComplete="tel"
    placeholder="+56 9 1234 5678"
  />
  <p className="text-xs text-neutral-500">
    Te enviaremos cada nueva oferta a este WhatsApp.
  </p>
</FormField>
```

### 3.2 Normalización del RUT (display)

Aunque el input es readonly, mostrar siempre con puntos:

```ts
// lib/rut.ts
export function formatRut(raw: string): string {
  const digits = raw.replace(/[^0-9kK]/g, '').toUpperCase();
  if (digits.length < 2) return raw;
  const body = digits.slice(0, -1);
  const dv = digits.slice(-1);
  // Formatear con puntos
  const withDots = body.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${withDots}-${dv}`;
}

// validar (algoritmo Módulo 11)
export function isValidRut(raw: string): boolean {
  const clean = raw.replace(/[^0-9kK]/g, '').toUpperCase();
  if (clean.length < 2) return false;
  const body = clean.slice(0, -1);
  const expectedDv = clean.slice(-1);
  let sum = 0;
  let multiplier = 2;
  for (let i = body.length - 1; i >= 0; i--) {
    sum += parseInt(body[i], 10) * multiplier;
    multiplier = multiplier === 7 ? 2 : multiplier + 1;
  }
  const mod = 11 - (sum % 11);
  const dv = mod === 11 ? '0' : mod === 10 ? 'K' : String(mod);
  return dv === expectedDv;
}
```

```tsx
<input
  id="rut"
  value={formatRut(user.rut)}  // muestra 14.289.398-3
  readOnly
/>
```

### 3.3 Backend

Aplicar `profileUpdateSchema` en `PATCH /api/me`. Si `phone` o `whatsapp`
no matchean el regex, devolver 400 con detalle del error.

## 4. Test nuevo

Agregar `tests/bugs/perfil-validacion.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test.describe('FIX-009: validación de perfil @bug', () => {
  test('teléfono sin formato chileno muestra error', async ({ page }) => {
    await page.goto('/app/perfil');
    const phoneInput = page.getByLabel(/Teléfono móvil/);
    await phoneInput.fill('123');
    await phoneInput.blur();
    await expect(page.getByText(/Formato esperado: \+56/)).toBeVisible();
  });

  test('WhatsApp con formato chileno se acepta', async ({ page }) => {
    await page.goto('/app/perfil');
    const wa = page.getByLabel(/WhatsApp/);
    await wa.fill('+56 9 9876 5432');
    await wa.blur();
    await expect(page.getByText(/Formato esperado/)).toBeHidden();
  });

  test('teléfono usa input type=tel', async ({ page }) => {
    await page.goto('/app/perfil');
    const phoneInput = page.getByLabel(/Teléfono móvil/);
    await expect(phoneInput).toHaveAttribute('type', 'tel');
  });
});
```

## 5. Verificación

```bash
npm test -- bugs/perfil-validacion
```

### Manual

| Caso | Esperado |
|---|---|
| Teléfono `123` | Error inline visible. Botón disabled. |
| Teléfono `+56 9 1234 5678` | OK. Botón habilita. |
| WhatsApp vacío | OK (es opcional). |
| WhatsApp `abc` | Error inline. |
| Mobile: focus en teléfono | Teclado numérico. |
| RUT mostrado | `14.289.398-3` (con puntos). |

## 6. Riesgos

Datos existentes pueden estar guardados sin formato consistente. Hacer
audit query y normalizar en migration:

```sql
-- Pseudocódigo
UPDATE users SET phone = normalize_phone(phone)
WHERE phone NOT LIKE '+56%';
```

## 7. Definition of Done

- [ ] Schema `profileUpdateSchema` creado y compartido cliente/servidor.
- [ ] Inputs con `type="tel"`, `pattern`, `autoComplete="tel"`.
- [ ] RUT mostrado formateado con puntos.
- [ ] Test nuevo `tests/bugs/perfil-validacion.spec.ts` creado y verde.
- [ ] Commit `fix(perfil): valida telefono, whatsapp y formatea rut (BUG-009)`.
