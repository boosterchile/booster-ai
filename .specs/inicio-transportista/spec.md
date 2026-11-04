# Inicio del transportista — fase 1

**Estado**: aceptada por el pedido del PO en este PR · **Fecha**: 2026-10-19

Layout «Hoy / pendientes» (opción A) con los indicadores de flota y cumplimiento de la opción B. «Por cobrar» no entra: ni placeholder, ni raya, ni número.

## Entradas

- `me` ya resuelto (nombre, empresa activa, rol). Sin empresa, o empresa que no es transportista, el inicio no cambia.
- Datos ya servidos por la API actual, leídos con las mismas claves de caché que las pantallas de origen:
  - `GET /offers/mine?status=pendiente`
  - `GET /assignments`
  - `GET /cumplimiento`
  - `GET /vehiculos/flota`
  - `GET /vehiculos`
  - `GET /conductores`
- Cada clave guarda la forma de la pantalla dueña (`{offers}`, el arreglo de asignaciones, la respuesta de cumplimiento, la flota con `position`, los arreglos de vehículos y conductores). El inicio deriva su vista con `select` y no reemplaza ese valor.
- Un vehículo `retirado` no entra en los conteos de flota. Una posición `browser_gps` se clasifica por su frescura, no como «sin GPS».

## Salidas

En `/app`, solo si `activeEmpresa.is_transportista`:

1. Saludo según la hora de America/Santiago y fecha larga en español. Chip de la empresa activa.
2. «Requiere tu atención»: ofertas por responder, servicios sin conductor, documentos vencidos, vehículos sin señal. Conteo 0 no se muestra. Todo en 0 → estado calmo.
3. «Tu operación hoy»: dos KPIs (en ruta, conectados). Sin tercera columna.
4. «Accesos»: todos los destinos de `TRANSPORTISTA_CARDS`, más servicios, más trayectos y dispositivos para dueño/admin. Solo en mobile (`md:hidden`): desde `md` la barra lateral ya muestra esos destinos y la grilla no se duplica. El espacio lo ocupan «Requiere tu atención» y los KPIs, en dos columnas desde `md`. Los `data-testid` `dashboard-link-flota`, `dashboard-link-conductores` y `dashboard-link-cumplimiento` siguen en la grilla mobile. Los badges de ofertas, servicios y cumplimiento se repiten en la barra lateral con las mismas consultas.
5. Empresa nueva (sin vehículos, sin conductores y sin documentos observados): bienvenida, checklist de 4 pasos y estado calmo.
6. Skeleton por bloque y error aislado con «Reintentar». Los accesos se pintan sin esperar a la API.

Conductor, platform-admin y stakeholder siguen redirigiendo. La sección «Como generador de carga» queda debajo, igual que hoy.

## Fuera de alcance

- Endpoints, migraciones, `apps/api`, `infra/**` y archivos protegidos.
- El indicador «Por cobrar». El acceso «Cobra hoy» se mantiene: es navegación.
- Campana de notificaciones del mockup.
- Inventar un dato que la API no entrega. Si falta la fuente, se omite esa fila, KPI o línea de subtítulo.

## Criterios de éxito

- Dueño, admin y despachador (operador) transportistas ven el layout nuevo.
- Mobile 390 px y desktop ≥1280 px sin overflow horizontal.
- Tests: render por rol, filas con conteo 0 ocultas, empresa nueva, error aislado, links, ausencia de «Por cobrar».
- Los tests previos de `app.tsx` siguen pasando, con el saludo nuevo donde la empresa es transportista.
