# Capacidades por rol

## Entradas

- Membresía activa: `rol`, `empresa.is_transportista`, `empresa.is_generador_carga`, `puede_aceptar_ofertas`.
- Usuario de la sesión: `id`, `rut`.
- Ficha viva en `conductores` de esa empresa (sin `eliminado_en`) con `usuario_id` del usuario de la sesión. El RUT se compara sobre esa ficha, no contra otras.
- Por viaje: `driver_user_id`.

## Salidas

Un módulo puro en `packages/shared-schemas` (`capacidades.ts`). La web arma el contexto desde `/me`. El API usa `requireCapability` / las mismas funciones.

`GET /me` devuelve `ficha_conductor_mismo_rut` y `puede_aceptar_ofertas` en cada membresía.

Migración 0067, aditiva: `membresias.puede_aceptar_ofertas boolean NOT NULL DEFAULT false`. 0065 y 0066 están reservadas por #795 y #799; el journal de esta rama las incluye con el mismo SQL para no dejar hueco de idx. `when` de 0067: 1780876800031.

## Reglas

1. `esOwnerOperator`: rol `dueno` y ficha viva propia. `/me` la busca con `conductores.usuario_id = user.id` y `LIMIT 1`, y después compara el RUT normalizado de esa ficha con el de la sesión. No recorre las fichas de la empresa ni matchea por RUT fichas de otros usuarios. La tarjeta de voz en Ofertas usa `puedeAceptarPorVoz`.
2. `/app/conductor` y `/app/conductor/configuracion` se abren si `puedeVerPanelConductor` (conductor empleado o dueño que conduce).
3. Entregar y reportar incidente: solo el usuario asignado (`puedeEjecutarViaje`). El API de esos dos endpoints lo cubre el PR #816. Este módulo no lo duplica. La web sigue usando esa comparación.
4. Liquidaciones, historial de Cobra hoy, cotización y pedir Cobra hoy: solo dueño y admin de un transportista. Despachador, conductor y visualizador no, ni en la UI ni en el API.
5. El conductor empleado ve solo su viaje. `GET /assignments`, `GET /assignments/:id`, `GET /vehiculos/flota` y `GET /vehiculos/:id/ubicacion` no le muestran la flota ni viajes ajenos. El dueño que conduce sí ve la flota: su rol es `dueno`.
6. El visualizador es solo lectura en toda la app y en los endpoints de escritura. En un generador no crea ni cancela cargas (`trip-requests-v2`). Confirmar recepción y abrir disputa quedan como en main: `requireShipperAuth`, sin exigir gestor. El link público de tracking no se toca.
7. El despachador puede asignar. Aceptar y rechazar ofertas exige `puede_aceptar_ofertas` en la membresía (default false). Dueño o admin lo editan en `/app/equipo`. El API lo exige en `POST /offers/:id/accept` y `/reject`. Dueño y admin siempre pueden. Conductor y visualizador nunca, aunque el flag esté en true.
8. «Agregar persona» solo dueño y admin. El menú de gestión no se muestra al conductor empleado. «Asignar» y «Cobra hoy» en el detalle de una asignación aparecen según la capacidad.

## Criterios de éxito

- La matriz rol × capacidad pasa en `shared-schemas`, y la web y el API usan esas funciones (tests propios).
- Un visualizador recibe 403 `read_only` al crear o cancelar una carga y al escribir en el chat.
- Un conductor empleado recibe 403 al aceptar una oferta, al leer liquidaciones o el historial de Cobra hoy, y no ve vehículos ajenos en `/flota` ni en `/:id/ubicacion`.
- Un despachador sin el flag recibe 403 al aceptar; con el flag, el API no lo rechaza por capacidad. Sigue sin ver la plata.
- La migración no tiene DDL destructivo.
- No se ejecuta nada contra producción.
