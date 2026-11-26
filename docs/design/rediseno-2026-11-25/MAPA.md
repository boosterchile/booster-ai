# Mapa — cada maqueta, su ruta y lo verificado en el código

Verificado contra `main` en `3c9881c` el 2026-11-25. Los componentes están bajo `apps/web/src/routes/` salvo los que empiezan con `components/`.

- **Frentes:** los números solos son de `FRENTES.md`; «ADR-094 N» son los de `.specs/comision-dentro-del-precio/spec.md`. El frente 8 (un solo sistema visual) aplica a todas.
- **«Ruta existe; pantalla no comparada con la maqueta»** significa exactamente eso: se confirmó la ruta y su propósito, no su contenido.

## Conductor (7)

| Maqueta | Título | Ruta de partida | Componente | Frentes | Verificado |
|---|---|---|---|---|---|
| `Main` | Conductor · Próximo viaje | `/app/conductor` | conductor.tsx | 3, 9 | Existe con tarjeta guiada por estado (`conductor-tarjeta-guiada`). La maqueta cambia el orden (saludo y viaje primero) y el nombre del botón. |
| `ConductorEnCamino` | Conductor · En camino | `/app/conductor` | conductor.tsx | 3, 9 | Existe. El panel de incidente ya está (`incidente-panel.tsx`). Nuevo: entrega condicionada a estar detenido en destino; avisos de un toque. |
| `ConductorEntregado` | Conductor · Entregado | `/app/conductor` | conductor.tsx; components/conductor/ResultadoViaje.tsx | 2, 3, 9 | Existe el resultado del viaje. Nuevo: evidencia de entrega (posición, receptor, foto) y sello por dato. |
| `ConductorSinViajes` | Conductor · Sin viajes | `/app/conductor` | conductor.tsx | 4, 9 | Existe el estado vacío. Cambian los textos. |
| `ConductorAjustes` | Conductor · Letra, color y voz | `/app/conductor/configuracion` | conductor-configuracion.tsx | 9 | Existe configuración de audio, permisos y activación por voz. Nuevo: tamaño de letra, color y contraste (no hay nada de eso en el archivo). |
| `ConductorDocumentos` | Conductor · Documentos | `/app/conductor` | components/conductor/DocumentosViajeConductor.tsx | 3, 9 | Existe como sección del viaje, no como pantalla. La maqueta suma los documentos del conductor y del camión. |
| `ConductorIncidente` | Conductor · Incidente | `/app/conductor` | components/inicio/incidente-panel.tsx | 3, 9 | Existe como panel dentro del viaje. No se comparó la lista de motivos. |

## Generador de carga (13)

| Maqueta | Título | Ruta de partida | Componente | Frentes | Verificado |
|---|---|---|---|---|---|
| `InicioGenerador` | Generador · Inicio | `/app` | app.tsx; components/inicio/inicio-generador*.tsx | 2, 6 | Existe «Tu negocio hoy» (`inicio-generador`, 2026-10-19) con tarjeta de mapa. Aplicar como diferencia. Nuevo: repetir carga. |
| `MovilInicioGenerador` | Móvil · Generador · Inicio | la misma | la misma | 8 | Vista a 390 px. |
| `GeneradorPublicar` | Generador · Publicar carga | `/app/cargas/nueva` | cargas.tsx (CargasNuevoRoute); components/comercial/SeccionComercial.tsx | 2, 3, 6; ADR-094 7 y 8 | Existe el formulario. El total con IVA ya llega (ADR-094 frente 2, apagado). No se revisó si muestra la ruta. Nuevo: tres pasos desde sucursales, ahorro de ruta, tipo de carga por plazo, valor declarado. |
| `MovilGeneradorPublicar` | Móvil · Generador · Publicar carga | la misma | la misma | 8 | Vista a 390 px. |
| `GeneradorMisCargas` | Generador · Mis cargas | `/app/cargas` | cargas.tsx (CargasListRoute) | 6; ADR-094 7 | Existe con estados. Distintivo Inmediata / Programada depende de ADR-094 frente 7. |
| `GeneradorElegir` | Generador · Elegir transportista | `/app/cargas/$id` | cargas.tsx (CargasDetalleRoute) | 2, 6 | Hoy el generador no elige. El PO decidió el 2026-11-25 que tenga dos caminos (elegir transportista o recibir ofertas): se construye, con ADR y spec del modelo de asignación antes del código. |
| `GeneradorCargaEnCamino` | Generador · Carga en camino | `/app/cargas/$id y /app/cargas/$id/track` | cargas.tsx; carga-track.tsx; components/map/LiveTrackingScreen.tsx | 3; ADR-094 8 | Existe el seguimiento en vivo (`tracking-live-unificado`). El chat es de texto libre. Paneles de carta de porte y guía: ADR-094 frente 8. |
| `MovilGeneradorCargaEnCamino` | Móvil · Generador · Carga en camino | la misma | la misma | 8 | Vista a 390 px. |
| `GeneradorCargaEntregada` | Generador · Carga entregada | `/app/cargas/$id` | cargas.tsx (CargasDetalleRoute) | 2, 3; ADR-094 4b | Existe el detalle. Nuevo: abrir con el resultado, sello, evidencia. Las dos facturas: ADR-094 frente 4b. |
| `GeneradorGuiaDespacho` | Generador · Datos para la guía de despacho (Res. Ex. SII N.º 144) | sin ruta: pantalla nueva | — | ADR-094 8 | **Nueva.** Depende de la carta de porte y de la lectura del timbre (ADR-070). |
| `GeneradorCertificados` | Generador · Huella y certificados | `/app/certificados` | certificados.tsx | 1, 2 | Existe. Nuevo: totales separados por clase y sello; ver README, punto 4. |
| `GeneradorSucursales` | Generador · Sucursales y lugares | `/app/sucursales` | sucursales.tsx | 6 | Ruta existe; pantalla no comparada con la maqueta. |
| `GeneradorEmpresa` | Generador · Empresa | `/app/empresa` | empresa.tsx | 6 | Ruta existe; pantalla no comparada con la maqueta. |

## Transportista (18)

| Maqueta | Título | Ruta de partida | Componente | Frentes | Verificado |
|---|---|---|---|---|---|
| `TransportistaSoloFleet` | Transportista · Inicio con Booster Fleet | `/app y /app/booster-fleet` | booster-fleet.tsx; nav-items.ts (navFleet) | 1, 5 | Existe la interfaz propia de Booster Fleet (`booster-fleet-interfaz`, 2026-11-23): para el administrador el Inicio es el panel de flota, con secciones «Flota» y «Viajes propios». La maqueta propone un Inicio distinto y la invitación a Booster Spot. |
| `InicioTransportista` | Transportista · Inicio con servicio completo | `/app` | app.tsx; components/inicio-transportista/ | 1, 5; ADR-094 3 | Existe «Tu negocio hoy» (2026-10-19) con mini mapa de flota. Aplicar como diferencia. |
| `MovilInicioTransportista` | Móvil · Transportista · Inicio | la misma | la misma | 8 | Vista a 390 px. |
| `TransportistaOfertas` | Transportista · Ofertas de Booster Spot | `/app/ofertas` | ofertas.tsx; components/offers/OfferCard.tsx | 3, 5; ADR-094 3, 7 y 8 | Existe con mapa de ruta y huella estimada de la oferta. Nuevo: ahorro de ruta, retorno vacío destacado, monto según ADR-094. |
| `MovilTransportistaOfertas` | Móvil · Transportista · Ofertas | la misma | la misma | 8 | Vista a 390 px. El mapa queda cortado a la derecha en la maqueta. |
| `TransportistaFlota` | Transportista · Flota | `/app/booster-fleet` | booster-fleet.tsx; components/booster-fleet/ | 1, 7 | Existe el panel por severidad (`booster-fleet-rediseno`, 2026-11-17). La maqueta le suma lo de `/app/flota` (mapa en vivo), `/app/vehiculos` y `/app/cumplimiento`, que hoy son pantallas aparte. |
| `MovilTransportistaFlota` | Móvil · Transportista · Flota | la misma | la misma | 8 | Vista a 390 px. |
| `TransportistaVehiculo` | Transportista · Detalle de vehículo | `/app/booster-fleet/vehiculos/$id` | booster-fleet-vehiculo.tsx; components/vehiculo-hub.tsx | 7 | Existe el detalle sobre eje de tiempo con mapa de eventos de combustible. Hay además otra ficha en `/app/vehiculos/$id` con `/live` e `/historial`: son dos fichas del mismo camión. Etiqueta del gráfico deformada en la maqueta. |
| `TransportistaMantencion` | Transportista · Programar mantención | `/app/booster-fleet` | components/booster-fleet/formulario-mantencion.tsx | 7 | Existe el formulario. |
| `TransportistaSubirDocumento` | Transportista · Subir un documento | `/app/cumplimiento` | cumplimiento.tsx; components/DocumentosSection.tsx | 7 | Ruta existe; pantalla no comparada con la maqueta. |
| `TransportistaConductores` | Transportista · Conductores | `/app/conductores` | conductores.tsx | 1, 7 | Ruta existe; pantalla no comparada con la maqueta. |
| `TransportistaEmpresa` | Transportista · Empresa | `/app/empresa` | empresa.tsx; zonas.tsx; equipo.tsx | 2, 5 | Existe Empresa. Zonas (`/app/zonas`) y Equipo (`/app/equipo`) son pantallas aparte; el PO aprobó fusionar Zonas, Equipo no tiene decisión. |
| `TransportistaViajes` | Transportista · Viajes | `/app/servicios (y /app/rutas)` | servicios.tsx; rutas.tsx | 5, 7 | Existe «Servicios» (`servicios-del-transportista`) y, tras una opción, «Rutas». La maqueta los une con pestañas de Pagos y Cobra hoy. |
| `TransportistaViajeDetalle` | Transportista · Viaje en camino | `/app/asignaciones/$id` | asignacion-detalle.tsx | 3; ADR-094 8 | Existe con seguimiento en vivo y tarjeta de ruta. |
| `TransportistaViajePropio` | Transportista · Nuevo viaje propio | `/app/viajes-propios/nuevo` | viaje-propio-nuevo.tsx | 2, 7 | Existe (`viaje-propio-transportista`, 2026-11-16) con cliente registrado o externo. No se revisó si muestra la ruta. Nuevo: ahorro de ruta y aviso de si la huella saldrá medida. |
| `TransportistaViajePropioEntregado` | Transportista · Viaje propio entregado y certificado | sin ruta propia | — | 2, 7 | **Depende de código que no existe:** el viaje propio con cliente externo no emite certificado; ver README, punto 5. |
| `TransportistaPagos` | Transportista · Pagos | `/app/liquidaciones` | liquidaciones.tsx | 5; ADR-094 4 | Ruta existe; pantalla no comparada con la maqueta. |
| `TransportistaCobraHoy` | Transportista · Cobra hoy | `/app/cobra-hoy/historial` | cobra-hoy-historial.tsx | 5 | **Pendiente, no construir:** factoring para adelantar el pago; no está desarrollado. Montos de relleno. |

## Puerta de entrada y seguimiento público (5)

| Maqueta | Título | Ruta de partida | Componente | Frentes | Verificado |
|---|---|---|---|---|---|
| `SolicitarAcceso` | Puerta de entrada · Solicitar acceso | `/solicitar-acceso` | solicitar-acceso.tsx | 4 | Ruta existe; pantalla no comparada con la maqueta. |
| `PublicoEntrar` | Puerta de entrada · Entrar | `/login` | login.tsx | 4 | Ruta existe; pantalla no comparada con la maqueta. |
| `PublicoActivar` | Puerta de entrada · Activar cuenta | `/activar` | activar.tsx | 4 | Ruta existe; pantalla no comparada con la maqueta. Nuevo: pedir un código nuevo. |
| `PublicoSeguimiento` | Público · Seguimiento de quien recibe | `/tracking/$token` | public-tracking.tsx | 3 | Existe con estado del viaje. Nuevo: mensajes cortos al conductor. |
| `PublicoSeguimientoEntregado` | Público · Seguimiento, carga entregada | `/tracking/$token` | public-tracking.tsx | 2, 3 | Existe el estado «Entregado». No muestra huella ni sello. |

## Panel de administración (13)

| Maqueta | Título | Ruta de partida | Componente | Frentes | Verificado |
|---|---|---|---|---|---|
| `AdminInicio` | Administración · Inicio | `/app/platform-admin` | platform-admin.tsx | 1, 10 | Existe como índice (`platform-admin-hub`). Nuevo: contadores de pendientes e indicadores del negocio. |
| `AdminSolicitudes` | Administración · Solicitudes de acceso | `/app/platform-admin/signup-requests` | platform-admin-signup-requests.tsx | 4, 10 | Ruta existe; pantalla no comparada con la maqueta. |
| `AdminEmpresas` | Administración · Empresas | `/app/platform-admin/empresas` | platform-admin-empresas.tsx; components/admin/ | 4, 5, 10 | Ruta existe; pantalla no comparada con la maqueta. |
| `AdminFlota` | Administración · Flota de la plataforma | `/app/platform-admin/flota` | components/admin/FlotaPlataforma.tsx | 2, 10 | Existe con mapa. Ya usa las palabras Medido / Estimado. |
| `AdminTeltonika` | Administración · Equipos Teltonika | `/app/platform-admin/teltonika` | platform-admin-teltonika.tsx | 10 | Ruta existe; pantalla no comparada con la maqueta. |
| `AdminServicios` | Administración · Servicios y condiciones | `/app/platform-admin/configuracion-comercial` | platform-admin-configuracion-comercial.tsx | 5, 10; ADR-094 6 y 7 | Existe y ya edita las tasas. Falta el umbral de horas y quitar el retorno programado. |
| `AdminPersonal` | Administración · Personal de Booster | `/app/platform-admin/personal` | components/admin/PersonalBooster.tsx | 10 | Ruta existe; pantalla no comparada con la maqueta. |
| `AdminStakeholders` | Administración · Organizaciones | `/app/platform-admin/stakeholders` | platform-admin.tsx | 10 | Ruta existe; pantalla no comparada con la maqueta. |
| `AdminObservatorio` | Administración · Observatorio urbano | `/app/platform-admin/observatorio` | platform-admin-observatorio.tsx | 1, 10 | Existe. El umbral es 10 vehículos en la API; el PO decidió 1 (README, punto 7). |
| `AdminAlgoritmo` | Administración · Algoritmo de asignación | `/app/platform-admin/matching` | platform-admin-matching.tsx | 10 | Ruta existe; pantalla no comparada con la maqueta. |
| `AdminSalud` | Administración · Salud y costos | `/app/platform-admin/observability` | platform-admin-observability.tsx | 10 | Ruta existe; pantalla no comparada con la maqueta. |
| `AdminSitio` | Administración · Sitio público | `/app/platform-admin/site-settings` | platform-admin-site-settings.tsx | 10 | Ruta existe; pantalla no comparada con la maqueta. |
| `AdminEntrarComo` | Administración · Entrar como un usuario | `/app/platform-admin/impersonar` | platform-admin-impersonar.tsx | 10 | Ruta existe; pantalla no comparada con la maqueta. |

## Rutas actuales sin maqueta

Hay que decidir con el PO si conservan su forma actual con los componentes nuevos o si desaparecen.

`/onboarding`, `/onboarding-admin`, `/crear-cuenta`, `/login/conductor`, `/maintenance`, `/precios`, `/legal/terminos`, `/legal/cobra-hoy`, `/app/perfil`, `/app/equipo`, `/app/rutas`, `/app/trayectos`, `/app/flota`, `/app/vehiculos` y sus detalles, `/app/chat/$id`, `/app/admin/dispositivos`, `/app/admin/cobra-hoy`, `/app/stakeholder/zonas`, `/app/platform-admin/mandato-cobro`, `/app/cargas/$id/editar`, `/app/conductores/nuevo`, `/app/conductores/$id`, `/app/sucursales/nueva`, `/app/sucursales/$id`, la confirmación de acceso de personal Booster y las rutas `/apariencia/*`.
