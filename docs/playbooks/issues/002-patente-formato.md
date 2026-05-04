# BUG-002 — Patente de vehículo no se valida contra formato chileno

| | |
|---|---|
| **Severidad** | 🔴 Crítico |
| **Componente** | `/app/vehiculos/nuevo` (cliente) + `POST /vehiculos` (servidor) |
| **Detectado** | 2026-05-04 |
| **Test** | `tests/bugs/vehiculos-validation-transportista.spec.ts` |

## Descripción

La validación de patente en cliente y servidor permite cualquier string de
4–12 caracteres. Patentes que no respetan ningún formato chileno (`AA·BB·CC`
nuevo o `AAAA·BB` legacy) se aceptan y se persisten como vehículos `Activo`.

## Repro

1. Login como Transportista.
2. Ir a `/app/vehiculos/nuevo`.
3. Patente: `....` (4 puntos). Capacidad: `1000`.
4. Submit.
5. **Resultado**: vehículo creado con patente `....` en estado `Activo`.

Otros valores que también fueron aceptados: `XXX-99`, `TEST-99`, `aabb12`,
`1234`.

## Constraints actuales

**Cliente** (form):
```html
<input id="plate" type="text" required maxlength="12" placeholder="AA·BB·CC o AAAA-BB" />
```
Sin `pattern`. El placeholder sugiere formato pero no se enforce.

**Servidor** (Zod schema en `POST https://api.boosterchile.com/vehiculos`):
```ts
plate: z.string().min(4)
```
Verificado mediante request directo:
- `plate: "A"` → 400 con `code: too_small, minimum: 4`.
- `plate: "AAAA"`, `"...."`, `"XXX-99"` → 201 (creados).

## Esperado

Regex chilena. Las dos formas vigentes son:
- **Nuevo (post-2007)**: `AA·BB·CC` (4 letras + 2 dígitos, sin distinción mayús/minús internamente).
- **Legacy**: `AAAA·BB` (4 letras + 2 dígitos en orden inverso).

Después del fix, deberían rechazarse las 5 patentes de prueba y aceptarse, por
ejemplo, `BCDF12` o `AABC23`.

## Fix sugerido

```ts
// Lib compartida cliente + servidor
const PLATE_NEW   = /^[A-Z]{2}[A-Z]{2}\d{2}$/;
const PLATE_LEGACY = /^[A-Z]{4}\d{2}$/;

export function isValidChileanPlate(raw: string): boolean {
  const norm = raw.replace(/[\s\-·\.]/g, '').toUpperCase();
  return PLATE_NEW.test(norm) || PLATE_LEGACY.test(norm);
}

export function normalizePlate(raw: string): string {
  return raw.replace(/[\s\-·\.]/g, '').toUpperCase();
}
```

En el form: validar al `onBlur` con feedback inline. Persistir en formato
canónico (`normalizePlate`). En la tabla, formatear con separador estético al
mostrar (`AA·BB·CC` con `·`).

## Datos de prueba creados

3 vehículos creados durante la exploración, todos en estado `Retirado`:
- `XXX-99`, `TEST-99`, `....` (en empresa Los Tres Chanchitos).

Limpieza dura requiere acceso a la base.
