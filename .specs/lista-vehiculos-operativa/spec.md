# Spec — Lista operativa de vehículos (`/app/vehiculos`)

## Problema

El operador entra a Vehículos para ver señales de operación (quién reporta, quién no tiene dispositivo, quién está en mantención) y la lista le muestra primero inventario: capacidad, combustible e IMEI crudo. El seguimiento en mapa vive en `/app/flota`.

## Audiencia

Operador de la empresa de transporte (dueño, admin, despachador y roles de solo lectura que ya entran a la lista).

## Entradas

- `GET /vehiculos` — ficha de inventario (patente, tipo, marca, modelo, capacidad, estado, IMEI).
- `GET /vehiculos/flota` — última posición por vehículo. Misma fuente que `/app/flota`. No hay endpoint nuevo.

El estado del dispositivo reutiliza la ventana del hub: con IMEI y último punto de menos de 30 minutos → conectado; con IMEI y sin punto fresco → sin señal; sin IMEI → sin dispositivo. El IMEI no se renderiza.

## Salidas

1. Encabezado con «Nuevo vehículo» (si el rol puede escribir) y enlace «Ver mapa» a `/app/flota`.
2. Búsqueda por patente, marca o modelo, y chips Todos / Activos / Mantención / Retirados / Sin dispositivo / Sin señal, cada uno con su conteo sobre la flota completa.
3. Tabla (desde 1024px): Patente | Tipo + marca/modelo | Capacidad | Dispositivo | Estado | Abrir + menú (Ver en vivo si hay IMEI, Editar si puede escribir).
4. Bajo 1024px: cards que abren el hub del vehículo. «Ver en vivo» solo si hay IMEI.
5. Vacío de flota con frase corta y CTA. Carga en skeleton. Error con Reintentar. Filtro sin resultados con Limpiar.

## Criterios de éxito

- A 1024px la lista no exige scroll horizontal.
- A 375px no se usa layout de tabla.
- Sin IMEI el pill dice «Sin dispositivo» y el IMEI no aparece en la lista.
- Los chips muestran conteos.
- La acción principal es Abrir (y Ver en vivo cuando hay dispositivo), no Editar.
- Hay enlace a `/app/flota` desde la lista.

## Fuera de alcance

Formulario de alta y el 409 de IMEI. Página hub del detalle. Mapa de `/app/flota`. Tokens de diseño D1/D2.
