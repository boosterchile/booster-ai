# FIX-001 — Validación completa de Crear carga

> **Severidad**: 🔴 Crítico
> **Issue**: [../issues/001-cargas-validacion.md](../issues/001-cargas-validacion.md)
> **Test**: `tests/bugs/cargas-validation.spec.ts` (5 casos)

## 1. Resumen

El form `/app/cargas/nueva` acepta cargas con ventanas de pickup imposibles
(Hasta < Desde, ventana 0s, en el pasado, 1 año), direcciones de 1 carácter
y dispara el `matching_engine` real, generando ofertas a transportistas con
datos basura.

## 2. Evidencia (verificada externamente)

Constraints HTML detectadas:
```ts
pickup_start_local: { type: 'datetime-local', required: true }
pickup_end_local:   { type: 'datetime-local', required: true }
origin_address_raw: { type: 'text', required: true, maxLength: 500 }
destination_address_raw: { type: 'text', required: true, maxLength: 500 }
cargo_weight_kg: { type: 'number', required: true, min: 1, max: 100000 }
```

Ningún campo tiene `pattern`, `min`/`max` para fechas, ni `minLength` para
direcciones. Servidor (Zod en `POST /trip-requests-v2`) tampoco enforce
estas reglas — devolvió 201 en los 5 casos malos.

## 3. Localización en el repo

```bash
# Frontend: encontrar la página
grep -rn "Nueva carga" apps/ src/ --include="*.tsx" --include="*.ts"

# Por ID de inputs (estables)
grep -rn "pickup_start_local\|origin_address_raw\|cargo_weight_kg" \
  apps/ src/ --include="*.tsx" --include="*.ts"

# Backend: encontrar el endpoint y el schema Zod
grep -rn "trip-requests-v2\|tripRequestSchema\|cargo_weight_kg" \
  apps/ src/ packages/ --include="*.ts"
```

Pistas estructurales (Next App Router típico):
- Page: `app/(authenticated)/app/cargas/nueva/page.tsx` (o similar).
- Schema compartido: `packages/shared/schemas/cargas.ts` o `lib/schemas/cargas.ts`.
- Endpoint: `app/api/trip-requests-v2/route.ts` o servicio Express en
  paquete `api/`.

## 4. Plan

1. Crear/actualizar **schema Zod compartido** que expresa todas las reglas.
2. Conectar el schema al form (cliente) via `react-hook-form` + `zodResolver`.
3. Aplicar el mismo schema en el handler servidor.
4. Mostrar mensajes inline bajo cada campo con error.
5. Deshabilitar "Crear carga" mientras el form sea inválido.
6. Correr `tests/bugs/cargas-validation.spec.ts` — debe pasar de FAIL a PASS.

## 5. Implementación

### 5.1 Schema compartido (`packages/shared/schemas/cargas.ts` o similar)

```ts
import { z } from 'zod';

const MIN_PICKUP_LEAD_MINUTES = 60;        // 1h en el futuro mínimo
const MAX_PICKUP_WINDOW_DAYS = 30;          // ventana máxima de 30 días
const MIN_ADDRESS_LENGTH = 5;
const MAX_ADDRESS_LENGTH = 500;

export const REGION_CODES = [
  'XV', 'I', 'II', 'III', 'IV', 'V', 'XIII', 'VI',
  'VII', 'XVI', 'VIII', 'IX', 'XIV', 'X', 'XI', 'XII',
] as const;

export const CARGO_TYPES = [
  'carga_seca', 'perecible', 'refrigerada', 'congelada',
  'fragil', 'peligrosa', 'liquida', 'construccion',
  'agricola', 'ganado', 'otra',
] as const;

export const cargaInputSchema = z.object({
  origin_address_raw: z.string()
    .trim()
    .min(MIN_ADDRESS_LENGTH, `Mínimo ${MIN_ADDRESS_LENGTH} caracteres`)
    .max(MAX_ADDRESS_LENGTH),
  origin_region_code: z.enum(REGION_CODES, {
    errorMap: () => ({ message: 'Selecciona una región' }),
  }),
  destination_address_raw: z.string()
    .trim()
    .min(MIN_ADDRESS_LENGTH, `Mínimo ${MIN_ADDRESS_LENGTH} caracteres`)
    .max(MAX_ADDRESS_LENGTH),
  destination_region_code: z.enum(REGION_CODES, {
    errorMap: () => ({ message: 'Selecciona una región' }),
  }),
  cargo_type: z.enum(CARGO_TYPES),
  cargo_weight_kg: z.number().int().min(1).max(100000),
  cargo_volume_m3: z.number().positive().max(500).optional(),
  cargo_description: z.string().max(2000).optional(),
  pickup_window_start: z.string()
    .refine(
      (s) => !isNaN(Date.parse(s)),
      'Fecha inválida',
    )
    .refine(
      (s) => Date.parse(s) > Date.now() + MIN_PICKUP_LEAD_MINUTES * 60_000,
      `La ventana debe empezar al menos ${MIN_PICKUP_LEAD_MINUTES} minutos en el futuro`,
    ),
  pickup_window_end: z.string().refine(
    (s) => !isNaN(Date.parse(s)),
    'Fecha inválida',
  ),
  proposed_price_clp: z.number().int().min(0).max(50_000_000).optional(),
})
.refine(
  (d) => Date.parse(d.pickup_window_end) > Date.parse(d.pickup_window_start),
  {
    path: ['pickup_window_end'],
    message: '"Hasta" debe ser posterior a "Desde"',
  },
)
.refine(
  (d) => {
    const ms = Date.parse(d.pickup_window_end) - Date.parse(d.pickup_window_start);
    return ms <= MAX_PICKUP_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  },
  {
    path: ['pickup_window_end'],
    message: `La ventana no puede exceder ${MAX_PICKUP_WINDOW_DAYS} días`,
  },
);

export type CargaInput = z.infer<typeof cargaInputSchema>;
```

### 5.2 Frontend — cambiar el form a `react-hook-form`

Si el repo no usa `react-hook-form` aún, instalarlo:

```bash
npm install react-hook-form @hookform/resolvers
```

Refactor del componente del form:

```tsx
'use client';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { cargaInputSchema, type CargaInput } from '@/shared/schemas/cargas';

export function NuevaCargaForm() {
  const {
    register, handleSubmit, formState: { errors, isValid, isSubmitting },
  } = useForm<CargaInput>({
    resolver: zodResolver(cargaInputSchema),
    mode: 'onBlur',
  });

  const onSubmit = handleSubmit(async (data) => {
    const res = await fetch('/api/trip-requests-v2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const body = await res.json();
      // mapear errores Zod del servidor a setError(...)
      return;
    }
    const { id } = await res.json();
    router.push(`/app/cargas/${id}`);
  });

  return (
    <form onSubmit={onSubmit} noValidate>
      {/* Origen */}
      <FormField label="Dirección de recogida" required error={errors.origin_address_raw?.message}>
        <input id="origin_address_raw" {...register('origin_address_raw')} placeholder="Av. Apoquindo 5550, Las Condes" />
      </FormField>
      {/* …el resto de campos siguiendo el mismo patrón… */}

      <button type="submit" disabled={!isValid || isSubmitting}>
        Crear carga
      </button>
    </form>
  );
}
```

> **Nota**: el componente `<FormField>` no existe — créalo si no está, ver
> [FIX-012](./012-validacion-html5.md) que cubre la migración general.

### 5.3 Backend — aplicar el mismo schema

```ts
// app/api/trip-requests-v2/route.ts (Next App Router)
import { cargaInputSchema } from '@/shared/schemas/cargas';

export async function POST(req: Request) {
  const body = await req.json();
  const parsed = cargaInputSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { success: false, error: parsed.error },
      { status: 400 },
    );
  }
  const { data } = parsed;
  const carga = await db.cargas.create({ data: { /* … */ } });
  return Response.json({ id: carga.id }, { status: 201 });
}
```

Si el backend es Express/Fastify separado, aplicar el mismo schema en el
handler equivalente.

### 5.4 Mensajes en el form

Cuando un campo tiene error:
```tsx
{errors.pickup_window_end && (
  <p role="alert" className="mt-1 text-sm text-rose-600">
    {errors.pickup_window_end.message}
  </p>
)}
```

## 6. Verificación

### 6.1 Test automático

```bash
npm test -- bugs/cargas-validation
```

Debe ir de **5 fail** a **5 pass**.

### 6.2 Manual

| Caso | Acción | Esperado |
|---|---|---|
| 1 | Llenar todo OK + Hasta=2026-12-15 10:00, Desde=2026-12-15 14:00 | Error inline bajo "Hasta": "debe ser posterior a Desde". Botón disabled. |
| 2 | Hasta = Desde idénticos | Mismo error. |
| 3 | Desde = 2020-01-01 | Error: "debe empezar al menos 60 min en el futuro". |
| 4 | Ventana de 1 año | Error: "no puede exceder 30 días". |
| 5 | Origen = "." | Error: "Mínimo 5 caracteres". |
| 6 | Todo válido | Botón se habilita, submit OK, redirige a /app/cargas/<id>. |

## 7. Riesgos

- **Cargas legacy**: si en producción hay cargas viejas con ventanas
  inválidas, las queries deberían seguir funcionando. La validación es
  solo en el `POST`, no afecta `GET`/migrations.
- **Zona horaria**: `datetime-local` envía sin offset. El servidor debe
  interpretar consistentemente (asumir `America/Santiago` si no hay tz).
  Validar: `pickup_window_start` debería persistirse como UTC con
  conocimiento del tz del usuario.
- **Default proposed_price_clp**: el placeholder dice "Dejar vacío si querés
  que pricing-engine sugiera"; respetá la opcionalidad — si no envía precio,
  el servidor calcula.

## 8. Rollback

```bash
git revert <commit>
```

El test `tests/bugs/cargas-validation.spec.ts` volvería a fallar (queda
como guard contra regresión).

## 9. Definition of Done

- [ ] Schema Zod existe y se importa cliente y servidor.
- [ ] Form usa `react-hook-form` + `zodResolver`.
- [ ] Mensajes de error inline visibles para cada campo.
- [ ] Botón "Crear carga" `disabled` mientras inválido.
- [ ] `tests/bugs/cargas-validation.spec.ts` → 5/5 pass.
- [ ] `npm run test:smoke` no se rompe.
- [ ] Verificación manual de los 6 casos.
- [ ] Commit con mensaje `fix(cargas): valida ventana de pickup y direccion (BUG-001)`.
- [ ] Issue cerrado con link al PR.
