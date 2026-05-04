# FIX-002 — Validación de patente chilena

> **Severidad**: 🔴 Crítico
> **Issue**: [../issues/002-patente-formato.md](../issues/002-patente-formato.md)
> **Test**: `tests/bugs/vehiculos-validation-transportista.spec.ts`

## 1. Resumen

`/app/vehiculos/nuevo` acepta patentes que no respetan el formato chileno
(`AA·BB·CC` nuevo o `AAAA·BB` legacy). Cliente solo valida `required` +
`maxLength=12`; servidor solo valida `z.string().min(4)`. Patentes como
`....`, `XXX-99`, `aabb12` se persisten como vehículos `Activo`.

## 2. Evidencia

- Cliente:
  ```html
  <input id="plate" type="text" required maxlength="12" placeholder="AA·BB·CC o AAAA-BB" />
  ```
  Sin `pattern`.
- Servidor (verificado vía intercept de red):
  ```ts
  // POST https://api.boosterchile.com/vehiculos
  plate: z.string().min(4)  // único enforce
  ```
  Verificado: `plate: "A"` → 400 con `code: too_small, minimum: 4`.
  `plate: "AAAA"` o `"...."` → 201.

## 3. Localización

```bash
# Frontend
grep -rn "id=\"plate\"\|Nuevo vehículo\|patente" \
  apps/ src/ --include="*.tsx" --include="*.ts"

# Backend
grep -rn "plate.*z\.string\|vehicleSchema" \
  apps/ src/ packages/ --include="*.ts"

# Endpoint
grep -rn "POST.*vehiculos\|/api/vehiculos\|/vehiculos.*router" \
  apps/ src/ packages/ --include="*.ts"
```

## 4. Plan

1. Crear util compartido `isValidChileanPlate(raw)` y `normalizePlate(raw)`.
2. Aplicar en cliente (regex en `register` + feedback inline).
3. Aplicar en servidor (refinar el Zod schema).
4. Persistir en formato canónico (sin separadores, mayúsculas).
5. Formatear a `AA·BB·CC` solo en display.

## 5. Implementación

### 5.1 Util compartido (`packages/shared/lib/plate.ts`)

```ts
/**
 * Patente chilena.
 * - Nueva (post-2007): 4 letras + 2 dígitos. Ej: BCDF12 → mostrado BCDF·12.
 * - Legacy: 4 letras + 2 dígitos también (AAAA-BB). Compatibles a regex.
 *
 * Aceptamos input con o sin separadores (·, -, espacio, .) y minúsculas.
 * Persistimos canónico: 6 chars [A-Z0-9].
 */
const PLATE_CANONICAL = /^[A-Z]{2}[A-Z]{2}\d{2}$|^[A-Z]{4}\d{2}$/;

export function normalizePlate(raw: string): string {
  return raw.replace(/[\s\-·.]/g, '').toUpperCase();
}

export function isValidChileanPlate(raw: string): boolean {
  return PLATE_CANONICAL.test(normalizePlate(raw));
}

export function formatPlateForDisplay(canonical: string): string {
  if (!PLATE_CANONICAL.test(canonical)) return canonical;
  // Insertar separador estético: AABB12 → AA·BB·12
  return `${canonical.slice(0, 2)}·${canonical.slice(2, 4)}·${canonical.slice(4)}`;
}
```

### 5.2 Frontend — form de nuevo vehículo

```tsx
import { isValidChileanPlate, normalizePlate } from '@/shared/lib/plate';

// con react-hook-form (recomendado, ver FIX-012)
{...register('plate', {
  required: 'Ingresa la patente',
  validate: (raw) =>
    isValidChileanPlate(raw) || 'Formato inválido (ej: BCDF12 o AAAA12)',
  setValueAs: (raw) => normalizePlate(raw),
})}
```

Sin `react-hook-form` (validación nativa custom):

```tsx
const [plateError, setPlateError] = useState<string | null>(null);

<input
  id="plate"
  required
  maxLength={12}
  placeholder="BCDF·12 o AABB12"
  onBlur={(e) => {
    const v = e.target.value;
    setPlateError(isValidChileanPlate(v) ? null : 'Formato inválido');
  }}
/>
{plateError && <p role="alert" className="text-rose-600 text-sm">{plateError}</p>}
```

### 5.3 Backend — Zod schema

```ts
import { isValidChileanPlate, normalizePlate } from '@shared/lib/plate';

export const vehiculoInputSchema = z.object({
  plate: z.string()
    .transform(normalizePlate)
    .refine(isValidChileanPlate, {
      message: 'Patente chilena inválida (formato esperado: AABB12 o AAAA12)',
    }),
  vehicle_type: z.enum([
    'camioneta', 'furgon_pequeno', 'furgon_mediano',
    'camion_pequeno', 'camion_mediano', 'camion_pesado',
    'semi_remolque', 'refrigerado', 'tanque',
  ]),
  capacity_kg: z.number().int().min(1).max(100000),
  capacity_m3: z.number().positive().max(500).optional(),
  year: z.number().int().min(1980).max(new Date().getFullYear() + 2).optional(),
  fuel_type: z.enum([
    'diesel', 'gasolina', 'glp', 'gnc',
    'electrico', 'hibrido_diesel', 'hibrido_gasolina', 'hidrogeno',
  ]).optional(),
  brand: z.string().max(50).optional(),
  model: z.string().max(100).optional(),
  curb_weight_kg: z.number().int().min(1).max(50000).optional(),
  consumption_l_per_100km_baseline: z.number().min(0.1).max(99.99).optional(),
});
```

### 5.4 Display: tabla y vista detalle

Donde se muestra la patente, usar `formatPlateForDisplay()`:

```tsx
import { formatPlateForDisplay } from '@/shared/lib/plate';

<td>{formatPlateForDisplay(vehiculo.plate)}</td>
```

### 5.5 Migración de datos existentes

Ya hay vehículos en producción con patentes inválidas (3 de prueba en
"Los Tres Chanchitos": `XXX-99`, `TEST-99`, `....`, todos `Retirado`).

Decidir entre:
- **Soft-fix**: solo validar en nuevos `POST`/`PATCH`. Los existentes
  quedan como están.
- **Hard-fix**: query SQL para identificar inválidos, contactar a los
  transportistas para corregir.

Se recomienda **soft-fix** + dashboard interno con vehículos inválidos
para revisión manual.

## 6. Verificación

### 6.1 Test automático

```bash
npm test -- bugs/vehiculos-validation
```

5 patentes inválidas + 1 válida. Debe pasar de **6 fail** a **6 pass**.

### 6.2 Manual

| Patente | Resultado esperado |
|---|---|
| `BCDF12` | ✅ Crea vehículo, se muestra como `BC·DF·12`. |
| `AAAA12` | ✅ Acepta legacy. |
| `aabb12` | ✅ Acepta (se normaliza a `AABB12`). |
| `AA-BB-12` | ✅ Acepta (se normaliza a `AABB12`). |
| `....` | ❌ Error inline. |
| `XXX-99` | ❌ Error inline. |
| `123456` | ❌ Error inline. |

## 7. Riesgos

- **Patentes existentes inválidas** quedan en la base. Si una mutación
  posterior pasa por el mismo schema, fallaría. Solución: en `PATCH`,
  hacer transformación pero solo validar el formato si la patente cambió,
  o aceptar grandfathered.
- **Patentes con caracteres especiales aceptados antes**: hacer audit
  query previo.

## 8. Rollback

`git revert` del commit. Test vuelve a fallar.

## 9. Definition of Done

- [ ] `lib/plate.ts` con 3 funciones exportadas.
- [ ] Form aplica regex en cliente.
- [ ] Schema servidor refinado y aplicado en `POST` y `PATCH /vehiculos/:id`.
- [ ] Display usa `formatPlateForDisplay`.
- [ ] `tests/bugs/vehiculos-validation-transportista.spec.ts` → 6/6 pass.
- [ ] Audit query corrida (informativo): cuántos vehículos con patente
      inválida hay en prod.
- [ ] Commit `fix(vehiculos): valida formato chileno de patente (BUG-002)`.
