# Capacidades por rol

## Entradas

- Membresía activa: `rol`, `empresa.is_transportista`, `empresa.is_generador_carga`, `puede_aceptar_ofertas`.
- Usuario de la sesión: `id`, `rut`.
- Ficha viva en `conductores` de esa empresa (sin `eliminado_en`) cuyo usuario tiene el mismo RUT.
- Por viaje: `driver_user_id`.

## Salidas

Un módulo puro en `packages/shared-schemas` (`capacidades.ts`). La web arma el contexto desde `/me`. El API usa `requireCapability` / las mismas funciones.

`GET /me` devuelve `ficha_conductor_mismo_rut` y `puede_aceptar_ofertas` en cada membresía.

Migración 0065, aditiva: `membresias.puede_aceptar_ofertas boolean NOT NULL DEFAULT false`.

## Reglas

1. `esOwnerOperator`: rol `dueno` y ficha viva del mismo RUT. Reemplaza `tiene_ficha_conductor` (comparación por `usuario_id` de #814). La tarjeta de voz en Ofertas usa `puedeAceptarPorVoz`.
2. `/app/conductor` y `/app/conductor/configuracion` se abren si `puedeVerPanelConductor` (conductor empleado o dueño que conduce).
3. Entregar y reportar incidente: solo el usuario asignado (`puedeEjecutarViaje`). El API de esos dos endpoints lo cubre el PR #816. Este módulo no lo duplica. La web sigue usando esa comparación.
4. Liquidaciones, historial de Cobra hoy, cotización y pedir Cobra hoy: solo dueño y admin de un transportista. Despachador, conductor y visualizador no, ni en la UI ni en el API.
5. El conductor empleado ve solo su viaje. `GET /assignments`, `GET /assignments/:id`, `GET /vehiculos/flota` y `GET /vehiculos/:id/ubicacion` no le muestran la flota ni viajes ajenos. El dueño que conduce sí ve la flota: su rol es `dueno`.
6. El visualizador es solo lectura en toda la app y en los endpoints de escritura. En un generador no crea ni cancela cargas (`trip-requests-v2`). El link público de tracking no se toca.
7. El despachador puede asignar. Aceptar y rechazar ofertas exige `puede_aceptar_ofertas` en la membresía (default false). Dueño o admin lo editan en `/app/equipo`. El API lo exige en `POST /offers/:id/accept` y `/reject`. Dueño y admin siempre pueden. Conductor y visualizador nunca, aunque el flag esté en true.
8. «Agregar persona» solo dueño y admin. El menú de gestión no se muestra al conductor empleado. «Asignar» y «Cobra hoy» en el detalle de una asignación aparecen según la capacidad.

## Criterios de éxito

- La matriz rol × capacidad pasa en `shared-schemas`, y la web y el API usan esas funciones (tests propios).
- Un visualizador recibe 403 `read_only` al crear o cancelar una carga y al escribir en el chat.
- Un conductor empleado recibe 403 al aceptar una oferta, al leer liquidaciones o el historial de Cobra hoy, y no ve vehículos ajenos en `/flota` ni en `/:id/ubicacion`.
- Un despachador sin el flag recibe 403 al aceptar; con el flag, el API no lo rechaza por capacidad. Sigue sin ver la plata.
- La migración no tiene DDL destructivo.
- No se ejecuta nada contra producción.
