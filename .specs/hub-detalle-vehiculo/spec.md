# Hub de detalle de vehículo

Superficie: `/app/vehiculos/$id`. Complementa el listado; no lo rediseña.

## Entradas

- Vehículo cargado (`plate`, marca, modelo, tipo, `status`, IMEI).
- Ubicación (`GET /vehiculos/:id/ubicacion`) si hay IMEI.
- Resumen de trayectos de 30 días si el rol es dueño o admin de un transportista.
- Rol de la membresía activa.

## Salidas

- Chrome: volver a `/app/vehiculos` como «Vehículos». Retirar solo dentro del menú ⋯, y solo para dueño o admin si el vehículo no está retirado.
- Hero: H1 = patente. Píldora Dispositivo (Conectado / Sin señal / Sin dispositivo) y píldora Flota (Activo / Mantención / Retirado). Subtítulo «Marca Modelo · Tipo».
- Con IMEI: un botón lleno «Ver en vivo», «Recorrido» en contorno y «Ver trayectos» en texto (solo dueño|admin transportista).
- Sin IMEI: botón lleno «Configurar dispositivo» abre `#configuracion` y enfoca el IMEI. No hay vivo ni recorrido.
- Operación (dueño|admin transportista): tarjetas Último, Consumo y Alertas; mapa ~200px en escritorio y ~160px en móvil; lista de trayectos; vacíos con CTA o Reintentar.
- Roles limitados: texto «El historial lo ve el admin de tu flota». Conservan vivo y recorrido si hay IMEI.
- Configuración cerrada al entrar. Secciones Dispositivo, Datos, Documentos. El subtítulo de Datos no repite Teltonika.
- Alertas: badges cortos Combustible / Hormiga. Borde ámbar suave si hay alertas.

## Criterios de éxito

1. El enlace «Vehículos» navega al listado.
2. El hero muestra dos píldoras con etiquetas distintas.
3. Con IMEI hay exactamente un botón lleno en las acciones del hub; sin IMEI no aparecen vivo ni recorrido.
4. Un conductor no ve un muro de «no tenés permiso».
5. La configuración entra cerrada y Retirar no queda fijo en el encabezado.
6. En 375px el hero y la acción primaria no desbordan en horizontal, y los vacíos ofrecen recuperación.
