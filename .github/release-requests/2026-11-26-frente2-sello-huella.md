# Release request — rediseño, frente 2: el sello de huella en toda la web

**Fecha**: 2026-11-26 · America/Santiago  
**Motivo**: llevar a producción lo fusionado en `main` desde el release del frente 8 (`14e885dc`, run 45741987240), hasta la punta de `main` al fusionar esta solicitud.  
**Pedido**: del PO — cerrar el frente 2 de `docs/design/rediseno-2026-11-25/FRENTES.md` (sin la parte que depende de T10-05) con una solicitud de release a producción fusionada.

## Qué entra

- Toda cifra de emisiones de la web lleva su sello de ADR-091: «Medido» solo con huella medida (`primario_verificable`), «Distancia medida con Teltonika · consumo modelado» o «Estimado». Certificados, el Inicio del generador, los indicadores del Inicio del panel, el detalle de carga, el resultado del conductor, rutas, la oferta y el observatorio (#1109).
- Los totales salen separados por presentación: ningún total mezcla medido con estimado (#1109).
- El API agrega `presentacion` a las métricas del viaje y a cada certificado, y `por_presentacion` al resumen de certificados. Campos nuevos; ninguno existente cambia (#1109).
- Certificados en el teléfono: cada certificado es una tarjeta con la cifra y su sello a la vista; en escritorio la tabla junta carga y trayecto y el ahorro va bajo la cifra. El sello intermedio corta en el «·» y no sale de su contenedor (#1109).
- Las zonas de organizaciones dejan de mostrar la cifra de CO₂e de demostración (#1109).
- Documentación del handoff (#1108 y esta solicitud).

## Qué no cambia

- Sin migraciones.
- `PRICING_V3_ACTIVATED` sigue apagado.
- El observatorio sigue sumando todos los viajes en una cifra: va «Estimado» hasta que su vista de BigQuery guarde la presentación.

## Qué mirar tras el deploy

Con una sesión de generador: Certificados muestra cada certificado con su sello y el total con un bloque por presentación, a 1.280 px y en un teléfono. En el panel, el Inicio cuenta las tres presentaciones. Si el web se despliega antes que el api, las cifras salen «Estimado» hasta que el api nuevo responda: nunca se afirma lo medido.

## Gate

Este archivo dispara `Release on request`. El Environment **production** sigue exigiendo aprobación humana (ADR-076). No usa la lane `release-deploy-main`.
