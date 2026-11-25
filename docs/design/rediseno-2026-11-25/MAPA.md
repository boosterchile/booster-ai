# Mapa — cada maqueta y la ruta de la que parte

Los componentes están bajo `apps/web/src/routes/` salvo los que empiezan con `components/`, que están bajo `apps/web/src/`.

**Cómo se hizo:** por nombre y propósito, con las rutas de `apps/web/src/router.tsx` al 2026-11-25. No se comparó cada maqueta con el código de su ruta; donde dice «confirmar» es una suposición sin comprobar. Una celda vacía en «Qué falta» significa que no se identificó una dependencia, no que no la haya.

Los frentes citados son los de `.specs/comision-dentro-del-precio/spec.md`.

## Tanda 1 — Puerta de entrada y seguimiento público (5)

| Maqueta | Título | Ruta actual | Componente | Qué falta o qué confirmar |
|---|---|---|---|---|
| `PublicoEntrar` | Puerta de entrada · Entrar | `/login` | `login.tsx` |  |
| `PublicoActivar` | Puerta de entrada · Activar cuenta | `/activar` | `activar.tsx` |  |
| `SolicitarAcceso` | Puerta de entrada · Solicitar acceso | `/solicitar-acceso` | `solicitar-acceso.tsx` |  |
| `PublicoSeguimiento` | Público · Seguimiento de quien recibe | `/tracking/$token` | `public-tracking.tsx` | No revisada en producción. |
| `PublicoSeguimientoEntregado` | Público · Seguimiento, carga entregada | `/tracking/$token` | `public-tracking.tsx` | Estado «entregada» de la misma ruta. |

## Tanda 2 — Conductor (7)

| Maqueta | Título | Ruta actual | Componente | Qué falta o qué confirmar |
|---|---|---|---|---|
| `Main` | Conductor · Próximo viaje | `/app/conductor` | `conductor.tsx` | Estado «próximo viaje». |
| `ConductorEnCamino` | Conductor · En camino | `/app/conductor` | `conductor.tsx` | Estado «en camino». No revisada con camión en movimiento. |
| `ConductorEntregado` | Conductor · Entregado | `/app/conductor` | `conductor.tsx; components/conductor/ResultadoViaje.tsx` | Estado «entregado». |
| `ConductorSinViajes` | Conductor · Sin viajes | `/app/conductor` | `conductor.tsx` | Estado vacío. |
| `ConductorAjustes` | Conductor · Letra, color y voz | `/app/conductor/configuracion` | `conductor-configuracion.tsx` | La voz no se revisó en producción. |
| `ConductorDocumentos` | Conductor · Documentos | `/app/conductor` | `components/conductor/DocumentosViajeConductor.tsx` | Confirmar si es pantalla propia o sección del viaje. |
| `ConductorIncidente` | Conductor · Incidente | `/app/conductor` | `conductor.tsx` | Confirmar si el reporte de incidente ya existe como flujo. |

## Tanda 3 — Transportista con Booster Fleet (11)

| Maqueta | Título | Ruta actual | Componente | Qué falta o qué confirmar |
|---|---|---|---|---|
| `TransportistaSoloFleet` | Transportista · Inicio con Booster Fleet | `/app` | `app.tsx; components/inicio-transportista` | Inicio cuando la empresa solo tiene Booster Fleet. Menú reducido. |
| `TransportistaFlota` | Transportista · Flota | `/app/booster-fleet (absorbe /app/flota y /app/vehiculos)` | `booster-fleet.tsx; flota.tsx; vehiculos.tsx` | Pantalla fusionada: seguimiento de flota dentro de Flota. |
| `MovilTransportistaFlota` | Móvil · Transportista · Flota | la misma | la misma | Vista a 390 px. |
| `TransportistaVehiculo` | Transportista · Detalle de vehículo | `/app/booster-fleet/vehiculos/$id (absorbe /app/vehiculos/$id, /live e /historial)` | `booster-fleet-vehiculo.tsx; vehiculo-live.tsx; vehiculo-historial.tsx` | Pantalla fusionada: trayectos dentro del vehículo. Etiqueta del gráfico de combustible deformada en la maqueta. |
| `TransportistaMantencion` | Transportista · Programar mantención | `/app/booster-fleet` | `booster-fleet.tsx; components/booster-fleet` |  |
| `TransportistaConductores` | Transportista · Conductores | `/app/conductores` | `conductores.tsx` |  |
| `TransportistaEmpresa` | Transportista · Empresa | `/app/empresa (absorbe /app/zonas y /app/equipo)` | `empresa.tsx; zonas.tsx; equipo.tsx` | Pantalla fusionada: zonas dentro de Empresa. Confirmar qué pasa con Equipo. |
| `TransportistaSubirDocumento` | Transportista · Subir un documento | `/app/cumplimiento` | `cumplimiento.tsx; components/transport-documents` | Pantalla fusionada: Cumplimiento. |
| `TransportistaViajes` | Transportista · Viajes | `/app/rutas y /app/trayectos` | `rutas.tsx; trayectos-teltonika.tsx` | Viajes propios y de Booster Spot en una lista. Con Booster Fleet solo, se llama «Viajes propios». |
| `TransportistaViajePropio` | Transportista · Nuevo viaje propio | `/app/viajes-propios/nuevo` | `viaje-propio-nuevo.tsx` | Banda de ruta ecoeficiente: depende del ahorro de la ruta. Panel de datos para la guía: frente 8. |
| `TransportistaViajePropioEntregado` | Transportista · Viaje propio entregado y certificado | sin ruta propia identificada | — | Certificado del viaje propio: confirmar que el certificado se emite hoy para viajes propios. |

## Tanda 4 — Generador (9)

| Maqueta | Título | Ruta actual | Componente | Qué falta o qué confirmar |
|---|---|---|---|---|
| `InicioGenerador` | Generador · Inicio | `/app` | `app.tsx; components/inicio` |  |
| `MovilInicioGenerador` | Móvil · Generador · Inicio | la misma | la misma | Vista a 390 px. |
| `GeneradorPublicar` | Generador · Publicar carga | `/app/cargas/nueva` | `cargas.tsx (CargasNuevoRoute); components/comercial/SeccionComercial.tsx` | Tipo de carga calculado por plazo: frente 7. Valor declarado obligatorio y línea de carta de porte: frente 8. El total con IVA ya lo entrega el frente 2. |
| `MovilGeneradorPublicar` | Móvil · Generador · Publicar carga | la misma | la misma | Vista a 390 px. |
| `GeneradorMisCargas` | Generador · Mis cargas | `/app/cargas` | `cargas.tsx (CargasListRoute)` | Distintivos Inmediata / Programada: frente 7. |
| `GeneradorElegir` | Generador · Elegir transportista | `/app/cargas/$id` | `cargas.tsx (CargasDetalleRoute)` | Confirmar que hoy el generador elige entre ofertas; si la asignación es automática, la pantalla no aplica tal cual. |
| `GeneradorCertificados` | Generador · Huella y certificados | `/app/certificados` | `certificados.tsx` | Sello Medido / Estimado: pregunta abierta 1. |
| `GeneradorSucursales` | Generador · Sucursales y lugares | `/app/sucursales` | `sucursales.tsx` |  |
| `GeneradorEmpresa` | Generador · Empresa | `/app/empresa` | `empresa.tsx` |  |

## Tanda 5 — Booster Spot y dinero (11)

| Maqueta | Título | Ruta actual | Componente | Qué falta o qué confirmar |
|---|---|---|---|---|
| `GeneradorCargaEnCamino` | Generador · Carga en camino | `/app/cargas/$id y /app/cargas/$id/track` | `cargas.tsx; carga-track.tsx` | Paneles de carta de porte y de guía de despacho: frente 8. |
| `MovilGeneradorCargaEnCamino` | Móvil · Generador · Carga en camino | la misma | la misma | Vista a 390 px. |
| `GeneradorCargaEntregada` | Generador · Carga entregada | `/app/cargas/$id` | `cargas.tsx (CargasDetalleRoute)` | Panel «Lo que pagaste por este viaje» con dos facturas: frente 4b. |
| `GeneradorGuiaDespacho` | Generador · Datos para la guía de despacho (Res. Ex. SII N.º 144) | sin ruta: pantalla nueva | — | Datos para copiar, comparación con la guía subida y aviso de cambio: frente 8 (usa la lectura del timbre de ADR-070). |
| `InicioTransportista` | Transportista · Inicio con servicio completo | `/app` | `app.tsx; components/inicio-transportista` | Inicio con servicio completo. Montos: lo que recibe, «+ IVA» (frente 3). |
| `MovilInicioTransportista` | Móvil · Transportista · Inicio | la misma | la misma | Vista a 390 px. |
| `TransportistaOfertas` | Transportista · Ofertas de Booster Spot | `/app/ofertas` | `ofertas.tsx; components/offers` | La oferta muestra lo que recibe el transportista: frente 3. Distintivo de tipo de carga: frente 7. Carta de porte: frente 8. |
| `MovilTransportistaOfertas` | Móvil · Transportista · Ofertas | la misma | la misma | Vista a 390 px. El mapa queda cortado a la derecha en la maqueta. |
| `TransportistaViajeDetalle` | Transportista · Viaje en camino | `/app/asignaciones/$id` | `asignacion-detalle.tsx` | Paneles de carta de porte y guía: frente 8. |
| `TransportistaPagos` | Transportista · Pagos | `/app/liquidaciones` | `liquidaciones.tsx` | Solo lo que recibe (frente 4). |
| `TransportistaCobraHoy` | Transportista · Cobra hoy | `/app/cobra-hoy/historial` | `cobra-hoy-historial.tsx; components/cobra-hoy` | Montos de relleno: pregunta abierta 2. |

## Tanda 6 — Administración (13)

| Maqueta | Título | Ruta actual | Componente | Qué falta o qué confirmar |
|---|---|---|---|---|
| `AdminInicio` | Administración · Inicio | `/app/platform-admin` | `platform-admin.tsx` |  |
| `AdminSolicitudes` | Administración · Solicitudes de acceso | `/app/platform-admin/signup-requests` | `platform-admin-signup-requests.tsx` |  |
| `AdminEmpresas` | Administración · Empresas | `/app/platform-admin/empresas` | `platform-admin-empresas.tsx` |  |
| `AdminFlota` | Administración · Flota de la plataforma | `/app/platform-admin/flota` | `platform-admin-flota.tsx` |  |
| `AdminTeltonika` | Administración · Equipos Teltonika | `/app/platform-admin/teltonika` | `platform-admin-teltonika.tsx` |  |
| `AdminServicios` | Administración · Servicios y condiciones | `/app/platform-admin/configuracion-comercial (y mandato-cobro)` | `platform-admin-configuracion-comercial.tsx; platform-admin-mandato-cobro.tsx` | Panel «Comisión de Booster Spot» con dos tasas y umbral de horas: frentes 6 y 7. |
| `AdminPersonal` | Administración · Personal de Booster | `/app/platform-admin/personal` | `platform-admin-personal.tsx` |  |
| `AdminStakeholders` | Administración · Organizaciones | `/app/platform-admin/stakeholders` | `platform-admin.tsx (PlatformAdminStakeholdersRoute)` |  |
| `AdminObservatorio` | Administración · Observatorio urbano | `/app/platform-admin/observatorio` | `platform-admin-observatorio.tsx` | Datos agregados desde 1 camión: revisar el umbral actual en la API. |
| `AdminAlgoritmo` | Administración · Algoritmo de asignación | `/app/platform-admin/matching` | `platform-admin-matching.tsx` |  |
| `AdminSalud` | Administración · Salud y costos | `/app/platform-admin/observability` | `platform-admin-observability.tsx` |  |
| `AdminSitio` | Administración · Sitio público | `/app/platform-admin/site-settings` | `platform-admin-site-settings.tsx` |  |
| `AdminEntrarComo` | Administración · Entrar como un usuario | `/app/platform-admin/impersonar` | `platform-admin-impersonar.tsx` |  |

## Rutas actuales sin maqueta

No tienen pantalla en el rediseño. Hay que decidir con el PO si conservan su forma actual con los componentes nuevos o si desaparecen.

`/onboarding`, `/onboarding-admin`, `/crear-cuenta`, `/login/conductor`, `/maintenance`, `/precios`, `/legal/terminos`, `/legal/cobra-hoy`, `/app/perfil`, `/app/servicios`, `/app/chat/$id`, `/app/admin/dispositivos`, `/app/admin/cobra-hoy`, `/app/stakeholder/zonas`, `/app/cargas/$id/editar`, `/app/conductores/nuevo`, `/app/conductores/$id`, `/app/sucursales/nueva`, `/app/sucursales/$id`, `/app/vehiculos/nuevo`, la confirmación de acceso de personal Booster y las rutas `/apariencia/*`.
