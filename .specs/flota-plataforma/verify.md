# Verificación: flota de todas las empresas en el panel de plataforma

## Qué entró (2026-11-12)

| Archivo | Qué hace |
|---|---|
| `apps/api/src/routes/admin-flota-plataforma.ts` | `GET /admin/plataforma/flota` y `GET /admin/plataforma/flota/:id`, solo con acceso al panel |
| `apps/api/src/services/ultimas-posiciones-vehiculos.ts` | La última posición por vehículo (equipo propio, espejo o celular). Salió de `GET /vehiculos/flota`, que ahora lo usa |
| `apps/web/src/components/admin/FlotaPlataforma.tsx` | Mapa, lista con búsqueda y filtro, y ficha |
| `apps/web/src/routes/platform-admin-flota.tsx` | La página, en `/app/platform-admin/flota`, con su entrada «Flota» en el panel |

## Criterios de la spec

| # | Criterio | Cómo se comprobó |
|---|---|---|
| 1 | Sin acceso al panel, 403 y no lee vehículos; sin sesión, 401 | `routes/admin-flota-plataforma.test` (4 casos, escritos primero) y `test/integration/flota-plataforma` |
| 2 | La lista trae vehículos de varias empresas con su posición, de la fuente que corresponde | los dos archivos; contra PostgreSQL toma la posición más reciente y ordena por empresa y patente |
| 3 | La ficha avisa `envia_83_sin_configurar` y `configurado_83_sin_lecturas` | unitario, y contra PostgreSQL con el operador `?` sobre `io_data` y la ventana de 3 días |
| 4 | La ficha cuenta viajes y certificados por nivel | unitario, y contra PostgreSQL sin contar los viajes de otro vehículo |
| 5 | `GET /vehiculos/flota` responde lo mismo | sus tests pasan sin cambios |
| 6 | La página muestra mapa, lista con filtros y ficha | `routes/platform-admin-flota.test` (9 casos) y en el navegador, con datos de prueba |
| 7 | Tests, lint, typecheck y build | `pnpm run ci`, en la evidencia del PR |

## Comprobado en el navegador

Con la página montada sobre datos de prueba, a 1280 px y a 375 px:

- la lista muestra los seis vehículos de dos empresas, uno «Sin posición»;
- al seleccionar un vehículo se destaca su fila y aparece la ficha, con el
  aviso de CAN sin configurar;
- a 375 px no hay desplazamiento horizontal de la página.

**No comprobado en el navegador: el mapa con marcadores.** Este equipo no tiene
la key de Google Maps y el mapa muestra «Mapa no disponible». El componente
`FleetMap` es el mismo que ya usa `/app/flota`, y el test comprueba que recibe
los vehículos con posición y que su selección abre la ficha. Queda por mirar
en staging.

## Decisiones de implementación

1. **Un solo servicio para la última posición.** La consulta estaba escrita
   dentro de `GET /vehiculos/flota`; se movió tal cual, con las mismas tres
   búsquedas y en el mismo orden.
2. **Los viajes de la ficha se leen de una vez** (hasta 1.000 por vehículo) y
   se cuentan en memoria. Hoy el vehículo con más viajes tiene 2.
3. **Un certificado cuenta en su nivel solo si está emitido.** Un viaje
   entregado sin certificado va a «sin certificado», tenga o no nivel
   calculado.
4. **La ficha del costado queda fija al desplazar la lista**, para no perderla
   con una flota larga.
5. **Registro de consultas**: cada lista y cada ficha deja una línea de log
   con el correo de quien consultó, y suma en
   `flota_plataforma_consultas_total{vista}`.

## Dato de producción que motivó la página (2026-11-11, solo lectura)

Equipos que enviaron el combustible por CAN (elemento 83) en los últimos 3
días, contra su configuración:

| Patente | Envía 83 | Fuente configurada |
|---|---|---|
| KZXB64 | sí | 83 |
| LFGR63 | sí | 83 |
| KFKW23 | sí | sin configurar |
| PLFL57 | sí | sin configurar |

La página muestra este desajuste en la ficha. Corregirlo es configurar la
fuente del vehículo, que no es parte de este cambio.
