# Plan: email real del conductor

## Orden

1. Schema Zod `conductorContactEmailSchema` (obligatorio, minúsculas, rechaza relleno) y tests.
2. Servicio `reconciliarIdentidadFirebaseConductor`: reusa el uid creado con el relleno, lo alinea al sintético `drivers+`, no toca cuentas ya activas, no fusiona dos sesiones vivas.
3. Migración aditiva `auditoria_email_conductor` + tabla Drizzle.
4. `POST /conductores`: unicidad del email. Si el RUT ya existe pendiente y su email es de relleno, se reemplaza, se audita y se reconcilia Firebase.
5. `POST /conductores/:id/email`: rol, empresa, pendiente vs activo, correo de activación existente, auditoría.
6. `login-rut` deja de pisar `usuarios.email` al promover el placeholder.
7. UI de alta (validación y duplicado) y ficha (corregir + reenviar). El PIN se muestra una vez, igual que en el alta.

## Comprobación

- Unitarios del schema, de la reconciliación Firebase y de `login-rut`.
- API de `POST /conductores` y `POST /conductores/:id/email` (roles, duplicado, pendiente, activo, conflicto).
- UI: alta rechaza relleno; la ficha pendiente postea el email y muestra el PIN.

## No hacer

No escribir datos de un conductor real en producción. No tocar archivos protegidos ni el flujo `driver-activate`.
