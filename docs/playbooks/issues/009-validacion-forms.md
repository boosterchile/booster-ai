# BUG-009 — Validación de forms inconsistente entre pantallas

| | |
|---|---|
| **Severidad** | 🟡 Menor |
| **Componente** | `/app/perfil`, varios |
| **Detectado** | 2026-05-04 |

## Resumen

| Form | Validación cliente | Validación servidor |
|---|---|---|
| Crear carga | required + min/max peso (sin fechas/dirección) | sin reglas observables — ver BUG-001 |
| Nuevo vehículo | required + maxLength=12 patente | Zod `min(4)` — ver BUG-002 |
| **Mi cuenta (perfil)** | **ninguna** | desconocido |
| Login | required + type="email" | Firebase |
| Registro | required + type="email" + minLength=6 password | Firebase |

## Mi cuenta — sin reglas

Inputs en `/app/perfil` (4):
```ts
{ id: ":r0:", type: "text" }        // Nombre
{ id: ":r1:", type: "text" }        // Teléfono móvil
{ id: ":r2:", type: "text" }        // WhatsApp
{ id: ":r3:", type: "text" }        // RUT
```
Ningún `required`, ningún `pattern`, ningún `minLength`, ningún `maxLength`.

## Hallazgos puntuales

1. **Teléfono móvil** y **WhatsApp** son `type="text"`, deberían ser
   `type="tel"` para abrir teclado numérico en móvil.
2. **Sin pattern** para teléfono (`+56 9 XXXX XXXX`). El placeholder lo
   sugiere pero no lo enforce.
3. **RUT placeholder** muestra `12.345.678-9` (con puntos) pero el valor
   guardado es `14289398-3` (sin puntos). Inconsistencia visual.
4. **IDs de inputs** son `:r0:`, `:r1:`... — son auto-generados por React
   `useId`. El `<label htmlFor>` está bien aplicado pero los IDs no son
   estables para tests (el test depende de orden DOM).

## Fix sugerido

```tsx
<Input
  id="phone"
  type="tel"
  inputMode="tel"
  required
  pattern="^\+56 ?9 ?\d{4} ?\d{4}$"
  placeholder="+56 9 1234 5678"
  defaultValue={user.phone}
/>
<p className="text-xs">Lo usamos para notificaciones críticas.</p>
```

Para RUT: parsear y formatear con la lib `rut.js` o equivalente — input
acepta cualquier formato (`12345678-9`, `12.345.678-9`, `123456789`) y se
normaliza a canónico al persistir, pero al display siempre muestra
`12.345.678-9`.
