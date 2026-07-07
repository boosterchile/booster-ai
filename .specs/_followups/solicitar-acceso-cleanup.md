# solicitar-acceso.tsx — SubmitState 'error' muerto + FIELD_ERROR_COPY duplicado

**Dimensión**: web / cleanup · **Estado**: pendiente, bajo riesgo, no bloqueante.
**Fuente**: fix round final-review W1 (2026-07-06), hallazgos menores del review de `apps/web/src/routes/solicitar-acceso.tsx`.

## Problema 1 — `SubmitState = 'idle' | 'success' | 'error'`, pero `'error'` nunca se lee

`apps/web/src/routes/solicitar-acceso.tsx:44` declara `type SubmitState = 'idle' | 'success' | 'error';` y `onSubmit` (línea ~85) hace `setState('error')` en el catch. Pero el JSX (línea ~113) solo compara `state === 'success'` para decidir qué renderizar — el estado `'error'` nunca se lee en ninguna condición. El manejo real de errores pasa enteramente por `errorMessage`/`setError` (banner + campos del form), no por `state`. `state === 'error'` es dead code: setearlo no tiene efecto observable distinto de dejarlo en `'idle'`.

Confirmar con:
```bash
grep -n "state ===" apps/web/src/routes/solicitar-acceso.tsx
```

## Problema 2 — `FIELD_ERROR_COPY` duplica los mensajes de `solicitarAccesoFormSchema`

`apps/web/src/routes/solicitar-acceso.tsx:221-224` declara:
```typescript
const FIELD_ERROR_COPY: Record<keyof SolicitarAccesoFormValues, string> = {
  nombreCompleto: 'Ingresa tu nombre completo (máx. 200 caracteres).',
  email: 'Ingresa un correo válido.',
};
```
Estos DOS strings son copia literal de los mensajes ya declarados en los `.refine()` de `solicitarAccesoFormSchema` (líneas 30-42, mismo archivo) — una para validación client-side (zodResolver), otra para cuando el backend rechaza el body (mapeo vía `mapValidationIssuesToForm`). Si el copy cambia en un lugar (ej. copy-guide ajusta la redacción), hay que recordar tocar el otro — no hay single source of truth.

## Por qué no se resolvió en este fix round

Ninguno de los dos es un bug funcional (el form funciona correctamente en ambos casos); son limpieza de código que no forma parte del scope de B1/R1/R2 de este fix round. Tocar `SubmitState` implica decidir si eliminar el estado `'error'` completo (simplifica el hook) o si dejarlo por si a futuro se quiere un render distinto para error vs idle (ej. deshabilitar el submit mientras `state === 'error'`) — decisión de producto menor que no amerita bloquear este PR.

## Plan de pago

1. `SubmitState`: eliminar `'error'` del union type y el `setState('error')` del catch (dejar solo `'idle' | 'success'`), O si se prefiere mantenerlo, agregar el render condicional que le dé uso real (ej. estilo distinto del banner). Decisión trivial, sin trade-offs reales — cualquiera de las dos opciones es correcta.
2. `FIELD_ERROR_COPY`: derivar los 2 strings desde `solicitarAccesoFormSchema` en vez de repetirlos — ej. extraer las 2 refine-messages a constantes compartidas (`NOMBRE_COMPLETO_ERROR_COPY`, `EMAIL_ERROR_COPY`) usadas tanto en el `.refine()` como en `FIELD_ERROR_COPY`.
3. Tests: ajustar `apps/web/src/routes/solicitar-acceso.test.tsx` si existía alguna aserción sobre `state` internamente (no debería, ya que los tests deberían aserir sobre el DOM, no sobre estado interno).

## Trigger

Baja prioridad. Resolver en el próximo PR que toque `solicitar-acceso.tsx` por otro motivo, o en un barrido de limpieza dedicado.
