# BUG-004 — RUT editable en perfil contradice la copy

| | |
|---|---|
| **Severidad** | 🔴 Crítico (defensa de identidad) |
| **Componente** | `/app/perfil` |
| **Detectado** | 2026-05-04 |
| **Test** | `tests/bugs/perfil-rut.spec.ts` |

## Descripción

El campo RUT muestra el copy:
> "Tu RUT no se puede modificar. Si necesitas cambiarlo, contacta a soporte."

Pero el `<input>` no tiene `readonly` ni `disabled`. Al editar el campo, el
botón **"Guardar cambios" se habilita** y la decisión de aceptar o no la
mutación queda en manos del servidor.

## Repro

1. Login como cualquier usuario.
2. Ir a `/app/perfil`.
3. Hacer click en el campo RUT.
4. Editarlo (escribir/borrar caracteres).
5. **Resultado esperado por la copy**: el campo no debería ser editable.
   **Resultado actual**: el campo se edita, y "Guardar cambios" pasa de
   deshabilitado a verde.

Verificación adicional vía DOM:
```js
const rut = document.querySelectorAll('input')[3];
rut.readOnly  // false
rut.disabled  // false
```

## Riesgo

El RUT es identificador tributario (clave) en Chile. Si el servidor no
valida estrictamente o se relaja en el futuro, el usuario puede cambiar su
identidad asociada.

## Fix

```tsx
<Input
  id="rut"
  value={user.rut}
  readOnly        // o disabled
  aria-describedby="rut-help"
/>
<p id="rut-help" className="text-sm text-neutral-500">
  Tu RUT no se puede modificar. Si necesitas cambiarlo,
  <a href="mailto:soporte@boosterchile.com">contacta a soporte</a>.
</p>
```

Y en la mutación servidor: `omit('rut')` del payload aceptable; cualquier
intento de cambio responder 403.
