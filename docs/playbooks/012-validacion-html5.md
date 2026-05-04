# FIX-012 — Migrar validación HTML5 nativa a componentes propios

> **Severidad**: 🟡 Menor (consistencia visual)
> **Issue**: [../issues/012-validacion-html5.md](../issues/012-validacion-html5.md)
> **Test**: agregar test al fix

## 1. Resumen

Cuando un campo `required` está vacío y se hace submit, sale el tooltip
nativo del navegador (Chrome amarillo: "Completa este campo"). Esto rompe
la consistencia visual con el resto de la app (modales, banners, badges
custom).

## 2. Plan

1. Crear/asegurar componente `<FormField>` con error inline + foco automático.
2. Aplicar `noValidate` al `<form>` para deshabilitar tooltips nativos.
3. Migrar todos los forms a `react-hook-form` + `zodResolver` (este fix
   se beneficia de los schemas creados en FIX-001, FIX-002, FIX-009).
4. Validar al `onBlur`, mostrar error inline + scroll suave al primer
   error en submit.

## 3. Implementación

### 3.1 Componente `FormField`

```tsx
// components/FormField.tsx
import { ReactNode } from 'react';

interface FormFieldProps {
  label: string;
  required?: boolean;
  error?: string;
  hint?: string;
  children: ReactNode;
}

export function FormField({ label, required, error, hint, children }: FormFieldProps) {
  const id = useId();
  return (
    <div className="space-y-1">
      <label
        htmlFor={id}
        className={`block text-sm font-medium ${error ? 'text-rose-700' : 'text-neutral-900'}`}
      >
        {label}
        {required && <span aria-label="requerido"> *</span>}
      </label>
      <div className={error ? '[&>input]:border-rose-500 [&>select]:border-rose-500' : ''}>
        {/* clonar children para inyectar id y aria-* */}
        {React.cloneElement(children as React.ReactElement, {
          id,
          'aria-invalid': !!error,
          'aria-describedby': error ? `${id}-error` : hint ? `${id}-hint` : undefined,
        })}
      </div>
      {hint && !error && (
        <p id={`${id}-hint`} className="text-xs text-neutral-500">{hint}</p>
      )}
      {error && (
        <p
          id={`${id}-error`}
          role="alert"
          className="text-sm text-rose-600"
        >
          {error}
        </p>
      )}
    </div>
  );
}
```

### 3.2 Usage pattern

```tsx
'use client';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { vehiculoInputSchema } from '@/shared/schemas/vehiculo';
import { FormField } from '@/components/FormField';

export function NuevoVehiculoForm() {
  const {
    register, handleSubmit,
    formState: { errors, isSubmitting, isValid },
  } = useForm({
    resolver: zodResolver(vehiculoInputSchema),
    mode: 'onBlur',
  });

  return (
    <form
      onSubmit={handleSubmit(submit)}
      noValidate    // ← deshabilita tooltips nativos
      className="space-y-6"
    >
      <FormField
        label="Patente"
        required
        error={errors.plate?.message}
        hint="Ej: BCDF·12 o AAAA·12"
      >
        <input {...register('plate')} placeholder="BCDF12" />
      </FormField>

      <FormField label="Tipo de vehículo" required error={errors.vehicle_type?.message}>
        <select {...register('vehicle_type')}>
          <option value="">— Seleccionar —</option>
          <option value="camioneta">Camioneta</option>
          {/* … */}
        </select>
      </FormField>

      {/* … resto de campos … */}

      <button type="submit" disabled={!isValid || isSubmitting}>
        Crear vehículo
      </button>
    </form>
  );
}
```

### 3.3 Scroll y foco al primer error

```tsx
// hook útil
import { useFormContext } from 'react-hook-form';

export function useScrollToFirstError() {
  const { formState: { errors, submitCount } } = useFormContext();
  useEffect(() => {
    if (submitCount === 0) return;
    const firstError = Object.keys(errors)[0];
    if (!firstError) return;
    const el = document.getElementById(firstError) ||
               document.querySelector(`[name="${firstError}"]`);
    if (el && el instanceof HTMLElement) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.focus();
    }
  }, [errors, submitCount]);
}
```

## 4. Forms a migrar

Lista priorizada:

| Form | Estado actual | Schema |
|---|---|---|
| Crear carga | HTML5 nativo | FIX-001 ya define schema |
| Nuevo vehículo | HTML5 nativo | FIX-002 ya define schema |
| Editar vehículo | HTML5 nativo | mismo schema (PATCH) |
| Mi cuenta | sin validación | FIX-009 define schema |
| Login | parcial (type=email) | aceptable, puede quedar simple |
| Registro | parcial (minLength=6) | crear schema con política fuerte |
| Forgot password | type=email simple | aceptable |

## 5. Test nuevo

```ts
// tests/bugs/forms-validation-style.spec.ts
import { test, expect } from '@playwright/test';

test.describe('FIX-012: validación con componentes propios @bug', () => {
  test('vehículo nuevo: submit vacío muestra error inline custom', async ({ page }) => {
    await page.goto('/app/vehiculos/nuevo');
    await page.getByRole('button', { name: 'Crear vehículo' }).click();
    // Error inline custom
    await expect(page.getByRole('alert').first()).toBeVisible();
    // No debe usar tooltip nativo
    const validationMsg = await page.locator('#plate').evaluate((el: HTMLInputElement) => el.validationMessage);
    expect(validationMsg).toBe('');  // porque tenemos noValidate
  });
});
```

> Como `tests/bugs/vehiculos-validation-transportista.spec.ts` (FIX-002)
> ya cubre patentes inválidas con error visible, este test se enfoca en
> el "submit vacío".

## 6. Verificación manual

| Form | Acción | Esperado |
|---|---|---|
| Crear carga | submit vacío | Sin tooltip nativo. Errores inline rojos. Scroll/foco al primero. |
| Nuevo vehículo | submit vacío | Idem. |
| Mi cuenta | teléfono inválido | Error inline al blur. |
| Cualquier form | Tab navigation | Foco visible (`focus-ring`). |

## 7. Riesgos

- Si algún form depende de la validación nativa para deshabilitar
  submit, refactorizar para usar `formState.isValid`.
- `noValidate` rompe la accesibilidad si no se sustituye con
  `aria-invalid` y `role="alert"`. El componente `FormField` arriba lo
  cubre.

## 8. Definition of Done

- [ ] Componente `FormField` reutilizable.
- [ ] Hook `useScrollToFirstError`.
- [ ] Forms críticos migrados (cargas, vehiculos, perfil).
- [ ] `noValidate` aplicado.
- [ ] Test nuevo verde.
- [ ] Sin tooltips nativos visibles.
- [ ] Commit `feat(forms): valida con FormField custom (BUG-012)`.
