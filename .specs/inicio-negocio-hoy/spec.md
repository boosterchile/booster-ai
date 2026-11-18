# Inicio del transportista — Tu negocio hoy

**Estado**: aceptada por el pedido del PO en este PR · **Fecha**: 2026-10-19

Reemplaza el layout de «Requiere tu atención» del inicio transportista. El generador no cambia. `GET /me/inicio-resumen` queda para una fase siguiente.

## Entradas

Las mismas lecturas que ya usa el inicio, con la forma de la pantalla dueña:

- `GET /offers/mine?status=pendiente` (ruta, precio, vencimiento)
- `GET /assignments` (hora, ruta, patente, conductor)
- `GET /vehiculos/flota` y el estado de dispositivo ya calculado en el cliente
- `GET /cumplimiento`

No se pide `GET /me/cobra-hoy/historial` ni `GET /me/inicio-resumen`.

## Salidas

En `/app`, si la empresa activa es transportista:

1. Saludo compacto. La fecha y la empresa van en una sola línea.
2. «Tu negocio hoy», siempre con contenido:
   - Ofertas: cuántas nuevas, con ruta, precio y vencimiento. En cero: «Sin ofertas nuevas». Una CTA verde «Ver ofertas» solo si hay alguna.
   - Próximos retiros: 3 en móvil y tabla de hasta 5 en desktop (hora, ruta, patente, conductor). Sin conductor: «Sin conductor» y un solo botón «Asignar». En cero: «Sin retiros próximos».
   - Plata: el componente existe y `INICIO_PLATA_ACTIVA` está en `false`. No se monta y no muestra montos.
3. Avisos de sin señal y documentos: chips en móvil y una card en desktop. En cero, el aviso calmo («Flota al día», «Documentos al día»).
4. Grilla de accesos solo en móvil.
5. Desde `md`, dos columnas: el negocio a la izquierda; a la derecha el mapa de `/app/flota` (`FleetMap`) y los avisos.
6. Skeleton y error por bloque. Un bloque caído no esconde el resto.
7. Empresa nueva conserva el alta y, debajo, los bloques en cero.

## Criterios de éxito

- La pantalla no queda vacía: cada bloque tiene cero, carga o error.
- Una sola CTA verde por bloque.
- En desktop no queda la columna derecha en blanco: mapa y avisos ocupan ese lado.
- Tests de cero, carga y error, de los 5 retiros con un solo Asignar, y de que sentarse en el Inicio no vuelve a pedir los mismos GET.
