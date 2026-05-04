# BUG-012 — Validación HTML5 nativa donde el resto de la app usa componentes propios

| | |
|---|---|
| **Severidad** | 🟡 Menor (consistencia visual) |
| **Componente** | `/app/vehiculos/nuevo` y similares |
| **Detectado** | 2026-05-04 |

## Descripción

Cuando un campo `required` está vacío y se hace submit, sale el tooltip
nativo del navegador con texto del UA (Chrome: "Completa este campo").

Esto contrasta con el resto de la app que usa componentes custom (modales
de confirmación inline en cancelar carga, badges de estado, etc.).

## Repro

1. Login como Transportista.
2. Ir a `/app/vehiculos/nuevo`.
3. Submit sin llenar nada.
4. **Resultado**: tooltip Chrome amarillo apuntando a "Patente *".

Captura: `.playwright-mcp/t-vehiculo-validacion-vacia.png`.

## Esperado

Validación con feedback inline (rojo bajo el campo) + scroll suave al
primer error + foco automático.

## Fix

Migrar los forms a `react-hook-form` + `zod` + componente `<FormField>`
custom. Plantilla:

```tsx
<FormField
  label="Patente"
  required
  error={errors.plate?.message}
>
  <Input
    {...register("plate", {
      required: "Ingresa la patente",
      pattern: { value: PLATE_REGEX, message: "Formato no válido (AABB12 o AAAA12)" },
    })}
    placeholder="AA·BB·CC o AAAA-BB"
  />
</FormField>
```

Y deshabilitar la validación nativa con `<form noValidate>` para no mezclar
ambos sistemas.
