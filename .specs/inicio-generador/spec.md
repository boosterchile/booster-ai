# Inicio del generador — Tu negocio hoy

**Estado**: aceptada por el pedido del PO · **Fecha**: 2026-10-19

Variante del Inicio para una empresa que solo es generador de carga. La mixta y el conductor van en PRs aparte. Platform-admin y stakeholder quedan fuera.

## Entradas

- `GET /trip-requests-v2`. La misma respuesta ahora trae, en esa consulta, `transportista_nombre`, `assignment_status`, `ofertas_pendientes` y `avance_pct`. El avance es un hito (50 asignada, 75 en ruta, 100 entregada), no la posición GPS.
- `GET /certificates` para la huella del mes y el aviso de certificados nuevos.

No se pide `GET /me/inicio-resumen`. El hook `useInicioData('generador')` es el punto que esa fase reemplaza.

## Salidas

1. Saludo con fecha y empresa en una línea, rol «Generador de carga».
2. Mis cargas: contadores buscando / asignadas / en camino. Se destaca la carga sin match cuyo retiro es el más próximo. CTA «Publicar carga». En cero: «Sin cargas publicadas».
3. Próximos retiros y entregas: hora, ruta, código, transportista y, si va en camino, el avance. 3 en móvil y tabla en desktop. En cero: «Sin retiros próximos».
4. Gasto del mes detrás de `INICIO_GASTO_GENERADOR_ACTIVO = false`: se ve la regla pendiente y no un monto. La huella del mes sale de los certificados.
5. Avisos: certificados nuevos (emitidos en 7 días). Retraso y «sin match hace X h» no se muestran: son fase 2.
6. Desktop: tres KPIs y la tabla a la izquierda; a la derecha el seguimiento de las cargas en camino (abre `/app/cargas/$id/track`) y los avisos.
7. Accesos de generador solo en móvil, desde `navSectionsForMe`.
8. Visualizador: la misma pantalla, con «Ver» en lugar de «Publicar carga» y sin montos.

## Criterios de éxito

- Cada bloque tiene cero, carga o error.
- Una CTA verde por bloque.
- Sentarse en el Inicio no repite los GET.
- El listado no hace una llamada por carga para saber el transportista ni el avance.
