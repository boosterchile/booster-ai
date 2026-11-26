# Release request — rediseño, frente 8: un solo sistema visual

**Fecha**: 2026-11-25 · America/Santiago  
**Motivo**: llevar a producción lo fusionado en `main` desde el release del 2026-11-26 00:50Z (`251dfd1e`, arreglo de fechas de documentos), hasta la punta de `main` al fusionar esta solicitud.  
**Pedido**: del PO — cerrar el frente 8 de `docs/design/rediseno-2026-11-25/FRENTES.md` con una solicitud de release a producción fusionada.

## Qué entra

- Botón principal verde en toda la plataforma y sellos de huella: «Medido» solo cuando la huella misma fue medida (`primario_verificable`); la presentación intermedia conserva «Distancia medida con Teltonika · consumo modelado»; lo demás es «Estimado». Se ven en la huella de una ruta y en la ficha de Flota del panel (#1083).
- Armazón de las pantallas de operador: menú superior con pocas entradas (Inicio · Flota · Viajes · Ofertas · Empresa para el transportista; Inicio · Mis cargas · Huella y certificados · Empresa para el generador), pestañas con las pantallas de cada entrada, barra inferior fija bajo 640 px y menú de cuenta con el cambio de empresa, el perfil, el panel de Booster y Salir. Reemplaza la barra lateral (#1103).
- Todos los botones de `apps/web` salen de los componentes compartidos (`Button`, `PressableArea`), y una regla de `pnpm lint` falla si se pinta uno a mano. Los botones ámbar, azules y de éxito pasan al verde principal (#1104).
- Capturas de regresión visual de los Inicios, Flota y Certificados a 1.280 y a 390 px en el E2E del CI, y un arreglo: en un teléfono, Flota se ensanchaba a 640 px por el conteo de Cumplimiento en la fila de pestañas (#1105).
- Documentación del handoff (#1102 y esta solicitud).

## Qué no cambia

- Sin migraciones ni cambios de API.
- `PRICING_V3_ACTIVATED` sigue apagado.
- El conductor y el panel de administración conservan su armazón propio.

## Qué mirar tras el deploy

Con una sesión de dueño transportista y otra de generador: el menú superior a 1.280 px, la barra inferior en un teléfono, el cambio de empresa desde el menú de cuenta y que ningún botón haya quedado sin color.

## Gate

Este archivo dispara `Release on request`. El Environment **production** sigue exigiendo aprobación humana (ADR-076). No usa la lane `release-deploy-main`.
