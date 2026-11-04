# La pantalla Asignación no trata una flota legible como vacía

**Estado**: aceptada en este PR · **Fecha**: 2026-10-20 · **Pedido por**: PO (Mac: aviso «No tienes camiones activos» en BOO-TEST01 / TEST01; el iPhone muestra el camión y el conductor)

## 1. El problema

En `/app/asignaciones/:id` el Mac muestra «Conductor actual» y el aviso amarillo de flota vacía, sin selectores. El iPhone, con la misma carga, muestra el camión TEST01 y el conductor. El guardado está bien.

La card leía `GET /vehiculos` con la empresa activa de la sesión (`useEmpresaScope`) y la clave `['vehiculos', empresa]`, la misma que Inicio y Vehículos. Esas pantallas guardan un arreglo; la card leía `.vehicles` y, al no existir, trataba la flota como vacía (`isLoading` e `isError` en falso). Una respuesta ilegible caía en el mismo aviso. El camión ya asignado no se preseleccionaba si no estaba en la lista filtrada.

## 2. Entradas y salidas

- La card pide `/vehiculos` y `/conductores` con `X-Empresa-Id` de la empresa transportista del assignment (`empresa_id` en `GET /assignments/:id`). El POST de confirmar manda el mismo header. No cambia la validación del guardado.
- Clave propia `['vehiculos', empresa, 'asignacion']`. Acepta arreglo o `{ vehicles }`. Forma ilegible o fallo de red: error, no el aviso amarillo.
- El aviso amarillo solo si la lista terminó bien, no está refrescando, y no hay camiones elegibles ni un camión ya asignado.
- El camión ya asignado sale preseleccionado aunque no esté en la lista filtrada. Si hay que agregarlo a mano, usa `vehicle_status` del assignment cuando la API lo trae; si no viene, no se le pone `activo`. Siguen fuera del selector los de mantenimiento y los de arrastre que no son el camión de la carga. El camión solo se cambia en `asignado`.
- El header «Asignación» lleva `pt-safe` aunque no haya banner de push.

## 3. Criterios de salida

- [x] Tests de la card y de la ruta cubren caché en arreglo, empresa de la carga distinta de la sesión, camión asignado fuera de la lista, error, carga pendiente y respuesta ilegible.
- [x] `GET /assignments/:id` incluye `empresa_id` del transportista.
- [x] El header sin banner tiene la clase `pt-safe`.
- [x] No se toca el servicio de guardado ni archivos protegidos.
