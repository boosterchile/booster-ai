# Inicio del generador — Tu negocio hoy

**Estado**: aceptada por el pedido del PO · **Fecha**: 2026-10-19

Variante del Inicio para una empresa que solo es generador de carga. La mixta y el conductor van en PRs aparte. Platform-admin y stakeholder quedan fuera.

## Entradas

- `GET /trip-requests-v2`. La misma respuesta trae, en esa consulta, `transportista_nombre`, `assignment_status`, `ofertas_pendientes` y `avance_pct`. El avance es un hito (50 asignada, 75 en ruta, 100 entregada), no la posición GPS. `ofertas_pendientes` no se omite del payload: es el conteo de ofertas en estado `pendiente` de esa carga. La consulta filtra por `generadorCargaEmpresaId` de la empresa activa y devuelve una fila por viaje (la asignación y las métricas son 1:1; las ofertas entran como subconsulta, no como join que duplique filas).
- `GET /certificates` para la huella del mes y el aviso de certificados nuevos.

No se pide `GET /me/inicio-resumen`. El hook `useInicioData('generador')` es el punto que esa fase reemplaza.

## Salidas

1. Saludo con fecha y empresa en una línea, rol «Generador de carga».
2. Mis cargas: contadores buscando / asignadas / en camino. Se destaca la carga sin match cuyo retiro es el más próximo. Si tiene ofertas pendientes, el detalle dice «ofertas enviadas a N». Felipe cerró el 2026-10-19 17:41 CLT que el generador sí las ve; no hay flag para esconderlas. CTA «Publicar carga». En cero: «Sin cargas publicadas».
3. Próximos retiros y entregas: hora, ruta, código, transportista y, si va en camino, el avance. 3 en móvil y tabla en desktop. En cero: «Sin retiros próximos».
4. Gasto del mes detrás de `INICIO_GASTO_GENERADOR_ACTIVO = false`: se ve la regla pendiente y no un monto. La huella del mes sale de los certificados.
5. Avisos: certificados nuevos (emitidos en 7 días). Retraso y «sin match hace X h» no se muestran: son fase 2.
6. Desktop: tres KPIs y la tabla a la izquierda; a la derecha el seguimiento de las cargas en camino (abre `/app/cargas/$id/track`) y los avisos.
7. Accesos de generador solo en móvil, desde `navSectionsForMe`.
8. Visualizador: la misma pantalla, con «Ver» en lugar de «Publicar carga» y sin montos.

## Flags

Siguen apagadas en `apps/web/src/components/inicio/flags.ts`. Prender una es cambiar la constante. Apagadas no muestran un monto inventado.

- `INICIO_GASTO_GENERADOR_ACTIVO`: gasto del mes.
- `INICIO_RETRASO_ACTIVO`: aviso de retraso. Fase 2, no se muestra.
- `INICIO_MONTOS_VISUALIZADOR`: montos para el rol visualizador.

`INICIO_FACTURADO_IVA_ACTIVO`, `INICIO_COBRA_HOY_DISPONIBLE_ACTIVO` y `INICIO_LICENCIA_CONDUCTOR_ACTIVA` son de otras variantes del Inicio y también siguen apagadas. Ver las ofertas pendientes del generador no está en esa lista.

## Criterios de éxito

- Cada bloque tiene cero, carga o error.
- Una CTA verde por bloque.
- Sentarse en el Inicio no repite los GET.
- El listado no hace una llamada por carga para saber el transportista, el avance ni las ofertas pendientes.
- La respuesta de `GET /trip-requests-v2` incluye `ofertas_pendientes` en cada fila y no repite un viaje.
