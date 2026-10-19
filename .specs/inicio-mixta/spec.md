# Inicio mixto — Tu negocio hoy

**Estado**: aceptada por el pedido del PO · **Fecha**: 2026-10-19

Variante del Inicio para una empresa que es transportista y generador de carga. El conductor va en un PR aparte. Platform-admin y stakeholder quedan fuera.

## Entradas

- Las mismas del inicio transportista: ofertas pendientes, asignaciones, flota, cumplimiento.
- Las mismas del inicio generador: `GET /trip-requests-v2` y `GET /certificates`.
- `useInicioData('mixta')` pide los viajes y los certificados. Fase 2 cambia ese hook a `GET /me/inicio-resumen`.

No se inventan montos. Facturado (fecha e IVA) y gasto (propuesto contra acordado) siguen con la regla pendiente.

## Salidas

1. Filtro Todo / Transporte / Generador, armado en el cliente.
2. Orden con Todo: ofertas para tu flota, mis cargas publicadas, agenda única, plata, avisos, accesos.
3. La agenda junta retiros de la flota y cargas propias, ordenados por ventana. La etiqueta es «Transporte» o «Mi carga». El primer retiro sin conductor trae Asignar; el visualizador ve Ver.
4. Plata en dos lados, sin fila de neto. Cada lado muestra la regla pendiente y no un monto.
5. Avisos de los dos lados. Si hay alguno urgente, los «al día» no se muestran.
6. Accesos de Transporte y de Generador, desde `navSectionsForMe`. El filtro deja solo el lado elegido.
7. El filtro Transporte esconde mis cargas y el gasto. El filtro Generador esconde las ofertas y el facturado.

## Criterios de éxito

- Cada bloque tiene cero, carga o error. Si un lado de la agenda falla, el otro sigue.
- Sentarse en el Inicio no repite los GET.
- La pantalla no muestra un neto ni un monto de plata.
