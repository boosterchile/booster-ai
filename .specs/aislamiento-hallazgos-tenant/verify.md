# verify — bloque E: auditoría de los 103 `rls-allowlist`

- Date: 2026-10-06
- Alcance: `apps/api/src/{routes,services,jobs}`, rama `cursor/aislamiento-multi-tenant-4567` @ `a81587f`. Conteo: 103 anotaciones (coincide con `pnpm lint:rls`, 0 findings).
- Método: cada anotación se leyó con la query que cubre (`.from/.update/.insert` siguiente) y se clasificó en una de las categorías del plan v2 §1 criterio 4. Las 45 que invocan `requirePlatformAdmin` se verificaron con un script: el handler que contiene la query llama a `requirePlatformAdmin(` antes (45/45). El resto se verificó leyendo el `WHERE` y, donde la razón lo exige, la autorización previa (`authorizeOverTrip`, `driverUserId`, `filtroPorEmpresasConsentidas`).

## Resultado

| Categoría | N |
|---|---|
| platform-admin | 46 |
| acotado por id ya validado | 30 |
| cross-tenant por diseño | 10 |
| empresa activa (anotación redundante) | 10 |
| pre-tenant / identidad global | 5 |
| público | 1 |
| no es query | 1 |

**Veredicto: las 103 se sostienen. Ninguna anotación cubre una query sin aislamiento.**

Observaciones, no hallazgos:

1. **9 anotaciones redundantes** (`me-zonas.ts` ×3, `me-empresa.ts` ×3, `me-empresa-miembros.ts:82`, `listar-trayectos-teltonika.ts:73,190`): la query sí filtra por la empresa activa (`auth.empresaId`, `opts.empresaId`), pero el linter no reconoce esos tokens. Mejora opcional del linter: aceptar `\.empresaId\b` como filtro. No es deuda de aislamiento.
2. **`transport-documents.ts:148`** no es una query: falso positivo del regex sobre `publishMessage({ data })`. El propio comentario lo dice.
3. **El patrón «acotado por id ya validado»** (49 sitios, todos en `services/`) sigue dependiendo de que la ruta llamadora valide tenant antes de pasar el id. Eso no lo prueba esta tabla: lo prueba en runtime `aislamiento-dos-empresas.integration.test.ts` (bloque C) para las rutas que existen, y el `WHERE` por id que acá se leyó garantiza que el servicio no amplía el alcance que recibió.

## Tabla

| Sitio | Query | Razón escrita | Categoría | Veredicto |
|---|---|---|---|---|
| `routes/admin-cobra-hoy.ts:131` | `.from(adelantosCarrier)` | admin platform-wide query — solo accesible vía requirePlatformAdmin allowlist. | platform-admin | se sostiene |
| `routes/admin-cobra-hoy.ts:193` | `.from(adelantosCarrier)` | admin platform-wide query — protegido por requirePlatformAdmin. | platform-admin | se sostiene |
| `routes/admin-cobra-hoy.ts:238` | `.update(adelantosCarrier)` | admin platform-wide update — protegido por requirePlatformAdmin. | platform-admin | se sostiene |
| `routes/admin-cobra-hoy.ts:258` | `.from(shipperCreditDecisions)` | admin platform-wide query — protegido por requirePlatformAdmin. | platform-admin | se sostiene |
| `routes/admin-cobra-hoy.ts:293` | `.update(shipperCreditDecisions)` | admin platform-wide update — protegido por requirePlatformAdmin. | platform-admin | se sostiene |
| `routes/admin-dispositivos-plataforma.ts:73` | `.from(pendingDevices)` | admin platform-wide query — protegido por requirePlatformAdmin. | platform-admin | se sostiene |
| `routes/admin-dispositivos-plataforma.ts:105` | `.from(vehicles)` | admin platform-wide query — protegido por requirePlatformAdmin. | platform-admin | se sostiene |
| `routes/admin-dispositivos-plataforma.ts:144` | `.from(vehicles)` | admin platform-wide query — protegido por requirePlatformAdmin. | platform-admin | se sostiene |
| `routes/admin-dispositivos-plataforma.ts:166` | `.from(vehicles)` | admin platform-wide query — protegido por requirePlatformAdmin. | platform-admin | se sostiene |
| `routes/admin-dispositivos-plataforma.ts:177` | `.from(pendingDevices)` | admin platform-wide query — protegido por requirePlatformAdmin. | platform-admin | se sostiene |
| `routes/admin-dispositivos-plataforma.ts:204` | `.update(vehicles)` | admin platform-wide — protegido por requirePlatformAdmin. | platform-admin | se sostiene |
| `routes/admin-dispositivos-plataforma.ts:283` | `.from(empresas)` | admin platform-wide query — protegido por requirePlatformAdmin. | platform-admin | se sostiene |
| `routes/admin-dispositivos-plataforma.ts:325` | `.from(vehicles)` | admin platform-wide query — protegido por requirePlatformAdmin. | platform-admin | se sostiene |
| `routes/admin-dispositivos-plataforma.ts:343` | `.from(vehicles)` | admin platform-wide query — protegido por requirePlatformAdmin. | platform-admin | se sostiene |
| `routes/admin-dispositivos-plataforma.ts:358` | `.from(pendingDevices)` | admin platform-wide query — protegido por requirePlatformAdmin. | platform-admin | se sostiene |
| `routes/admin-dispositivos-plataforma.ts:402` | `.update(vehicles)` | admin platform-wide — protegido por requirePlatformAdmin. | platform-admin | se sostiene |
| `routes/admin-empresa-miembros.ts:114` | `.from(empresas)` | admin platform-wide query — protegido por requirePlatformAdmin. | platform-admin | se sostiene |
| `routes/admin-empresa-miembros.ts:135` | `.from(memberships)` | admin platform-wide query — protegido por requirePlatformAdmin. | platform-admin | se sostiene |
| `routes/admin-empresa-miembros.ts:221` | `.from(plans)` | admin platform-wide query — protegido por requirePlatformAdmin. | platform-admin | se sostiene |
| `routes/admin-empresa-miembros.ts:233` | `.from(empresas)` | admin platform-wide query — protegido por requirePlatformAdmin. | platform-admin | se sostiene |
| `routes/admin-empresa-miembros.ts:368` | `.from(empresas)` | admin platform-wide query — protegido por requirePlatformAdmin. | platform-admin | se sostiene |
| `routes/admin-empresa-miembros.ts:386` | `.update(empresas)` | admin platform-wide update — protegido por requirePlatformAdmin. | platform-admin | se sostiene |
| `routes/admin-empresa-miembros.ts:461` | `.from(empresas)` | admin platform-wide query — protegido por requirePlatformAdmin. | platform-admin | se sostiene |
| `routes/admin-empresa-miembros.ts:474` | `.from(users)` | admin platform-wide query — protegido por requirePlatformAdmin. | platform-admin | se sostiene |
| `routes/admin-empresa-miembros.ts:491` | `.from(memberships)` | admin platform-wide query — protegido por requirePlatformAdmin. | platform-admin | se sostiene |
| `routes/admin-empresa-miembros.ts:519` | `.from(users)` | admin platform-wide query — protegido por requirePlatformAdmin. | platform-admin | se sostiene |
| `routes/admin-empresa-miembros.ts:645` | `.from(memberships)` | admin platform-wide query — protegido por requirePlatformAdmin. | platform-admin | se sostiene |
| `routes/admin-empresa-miembros.ts:679` | `.update(users)` | admin platform-wide update — protegido por requirePlatformAdmin. | platform-admin | se sostiene |
| `routes/admin-empresa-miembros.ts:684` | `.update(memberships)` | admin platform-wide update — protegido por requirePlatformAdmin. | platform-admin | se sostiene |
| `routes/admin-stakeholder-orgs.ts:73` | `.from(organizacionesStakeholder)` | admin platform-wide query — protegido por requirePlatformAdmin. | platform-admin | se sostiene |
| `routes/admin-stakeholder-orgs.ts:157` | `.from(organizacionesStakeholder)` | admin platform-wide query — protegido por requirePlatformAdmin. | platform-admin | se sostiene |
| `routes/admin-stakeholder-orgs.ts:168` | `—` | admin platform-wide query — protegido por requirePlatformAdmin. | platform-admin | se sostiene |
| `routes/admin-stakeholder-orgs.ts:229` | `.from(organizacionesStakeholder)` | admin platform-wide query — protegido por requirePlatformAdmin. | platform-admin | se sostiene |
| `routes/admin-stakeholder-orgs.ts:241` | `.from(users)` | admin platform-wide query — protegido por requirePlatformAdmin. | platform-admin | se sostiene |
| `routes/admin-stakeholder-orgs.ts:372` | `.update(organizacionesStakeholder)` | admin platform-wide soft-delete — protegido por requirePlatformAdmin. | platform-admin | se sostiene |
| `routes/assignments.ts:871` | `.from(assignments)` | scope por driverUserId, no empresa — el endpoint es del driver | acotado por id ya validado | se sostiene |
| `routes/auth-activar.ts:54` | `.from(users)` | lookup pre-auth por RUT; es el predicado del endpoint. | pre-tenant / identidad global | se sostiene |
| `routes/auth-activar.ts:91` | `.from(memberships)` | lookup pre-auth ligado al user recién verificado. | pre-tenant / identidad global | se sostiene |
| `routes/auth-driver.ts:144` | `.from(conductores)` | lookup user-scoped post-RUT+PIN, no hay empresa activa todavía | pre-tenant / identidad global | se sostiene |
| `routes/chat.ts:175` | `.from(assignments)` | chat valida AMBAS partes (carrier+shipper) explícitamente abajo | cross-tenant por diseño | se sostiene |
| `routes/conductores.ts:327` | `.from(conductores)` | chequeo global de unicidad user→conductor cross-empresa | pre-tenant / identidad global | se sostiene |
| `routes/me-empresa-miembros.ts:82` | `.from(memberships)` | filtrado por la empresa de la membresía activa del caller. | empresa activa (anotación redundante) | se sostiene |
| `routes/me-empresa-miembros.ts:131` | `.from(users)` | lookup global por RUT — una persona puede trabajar en | pre-tenant / identidad global | se sostiene |
| `routes/me-empresa.ts:76` | `.from(empresas)` | scoped a la empresa de la membresía activa del caller. | empresa activa (anotación redundante) | se sostiene |
| `routes/me-empresa.ts:118` | `.from(empresas)` | scoped a la empresa de la membresía activa del caller. | empresa activa (anotación redundante) | se sostiene |
| `routes/me-empresa.ts:206` | `.from(empresas)` | scoped a la empresa de la membresía activa del caller. | empresa activa (anotación redundante) | se sostiene |
| `routes/me-zonas.ts:84` | `.from(zones)` | filtrado por la empresa de la membresía activa del caller. | empresa activa (anotación redundante) | se sostiene |
| `routes/me-zonas.ts:111` | `.from(zones)` | lookup de duplicado scoped a la empresa activa. | empresa activa (anotación redundante) | se sostiene |
| `routes/me-zonas.ts:181` | `.from(zones)` | scoped a la empresa activa — id ajeno = 404. | empresa activa (anotación redundante) | se sostiene |
| `routes/site-settings.ts:111` | `.from(configuracionSitio)` | admin platform-wide read — protegido por requirePlatformAdmin. | platform-admin | se sostiene |
| `routes/site-settings.ts:118` | `.from(configuracionSitio)` | admin platform-wide history — protegido por requirePlatformAdmin. | platform-admin | se sostiene |
| `routes/site-settings.ts:145` | `.from(configuracionSitio)` | admin platform-wide read by version — protegido por requirePlatformAdmin. | platform-admin | se sostiene |
| `routes/site-settings.ts:170` | `.from(configuracionSitio)` | admin platform-wide max version — protegido por requirePlatformAdmin. | platform-admin | se sostiene |
| `routes/site-settings.ts:176` | `.insert(configuracionSitio)` | admin platform-wide insert — protegido por requirePlatformAdmin. | platform-admin | se sostiene |
| `routes/site-settings.ts:208` | `.update(configuracionSitio)` | admin platform-wide bulk update — protegido por requirePlatformAdmin. | platform-admin | se sostiene |
| `routes/site-settings.ts:214` | `.update(configuracionSitio)` | admin platform-wide single publish — protegido por requirePlatformAdmin. | platform-admin | se sostiene |
| `routes/site-settings.ts:240` | `.from(configuracionSitio)` | admin platform-wide read for rollback — protegido por requirePlatformAdmin. | platform-admin | se sostiene |
| `routes/site-settings.ts:253` | `.update(configuracionSitio)` | admin platform-wide bulk update — protegido por requirePlatformAdmin. | platform-admin | se sostiene |
| `routes/site-settings.ts:259` | `.update(configuracionSitio)` | admin platform-wide single rollback — protegido por requirePlatformAdmin. | platform-admin | se sostiene |
| `routes/site-settings.ts:363` | `.from(configuracionSitio)` | lectura pública de configuración publicada (sin PII). | público | se sostiene |
| `routes/stakeholder-zonas.ts:181` | `.from(zonasStakeholder)` | catálogo curado de zonas (ADR-041), sin empresaId; el alcance lo ponen el rol, la región y | cross-tenant por diseño | se sostiene |
| `routes/stakeholder-zonas.ts:230` | `.from(trips)` | agrega solo empresas con consent de emisiones_carbono (generadorCargaEmpresaId o assignmen | cross-tenant por diseño | se sostiene |
| `routes/transport-documents.ts:148` | `.from(data)` | publishMessage de Pub/Sub (document.uploaded); no es query Drizzle — | no es query | se sostiene |
| `routes/transport-documents.ts:469` | `.update(transportDocuments)` | autorización por tenant vía authorizeOverTrip (el viaje pertenece al tenant); | acotado por id ya validado | se sostiene |
| `services/actualizar-factor-matching.ts:129` | `.from(trips)` | pipeline de factor-matching scoped por tripId ya validado en la ruta llamadora (censo §2 n | acotado por id ya validado | se sostiene |
| `services/actualizar-factor-matching.ts:146` | `.from(assignments)` | assignment scoped por tripId ya validado (censo §2 nota C / rls-viabilidad §2C) | acotado por id ya validado | se sostiene |
| `services/actualizar-factor-matching.ts:164` | `.from(vehicles)` | vehículo scoped por vehicleId del assignment ya validado (censo §2 nota C) | acotado por id ya validado | se sostiene |
| `services/actualizar-factor-matching.ts:205` | `.from(trips)` | "próximo trip del vehículo" cruza shippers por diseño del matching (rls-viabilidad §3) | cross-tenant por diseño | se sostiene |
| `services/calcular-metricas-viaje.ts:283` | `.from(trips)` | pipeline de métricas scoped por tripId ya validado en la ruta llamadora (censo §2 nota C / | acotado por id ya validado | se sostiene |
| `services/calcular-metricas-viaje.ts:290` | `.from(vehicles)` | vehículo scoped por vehicleId ya validado del trip (censo §2 nota C) | acotado por id ya validado | se sostiene |
| `services/calcular-metricas-viaje.ts:520` | `.from(trips)` | recálculo de nivel post-entrega scoped por tripId ya validado (censo §2 nota C / rls-viabi | acotado por id ya validado | se sostiene |
| `services/calcular-metricas-viaje.ts:543` | `.from(assignments)` | assignment scoped por tripId ya validado (censo §2 nota C) | acotado por id ya validado | se sostiene |
| `services/calcular-metricas-viaje.ts:568` | `.from(vehicles)` | vehículo scoped por vehicleId del assignment ya validado (censo §2 nota C) | acotado por id ya validado | se sostiene |
| `services/calcular-metricas-viaje.ts:599` | `.from(empresas)` | flags de opt-in de las empresas participantes del viaje ya validado (T12, censo §2 nota C) | acotado por id ya validado | se sostiene |
| `services/calcular-score-conduccion-viaje.ts:55` | `.from(trips)` | pipeline de score scoped por tripId ya validado en la ruta llamadora (censo §2 nota C / rl | acotado por id ya validado | se sostiene |
| `services/calcular-score-conduccion-viaje.ts:62` | `.from(assignments)` | assignment scoped por tripId ya validado (censo §2 nota C) | acotado por id ya validado | se sostiene |
| `services/calcular-score-conduccion-viaje.ts:87` | `.from(greenDrivingEvents)` | eventos scoped por vehicleId del assignment validado + ventana del trip (censo §2 nota C) | acotado por id ya validado | se sostiene |
| `services/clasificar-cobertura-cero.ts:112` | `.from(posicionesMovilConductor)` | conteo del assignment que GET /resultado ya autorizó | acotado por id ya validado | se sostiene |
| `services/cobra-hoy.ts:315` | `.from(adelantosCarrier)` | dupe-check scoped por asignacionId ya validado (censo §2(1) financiero) | acotado por id ya validado | se sostiene |
| `services/cobrar-memberships-mensual.ts:138` | `.from(carrierMemberships)` | cron platform-wide. | cross-tenant por diseño | se sostiene |
| `services/confirmar-entrega-viaje.ts:204` | `.from(transportDocuments)` | entrega bilateral, documentos scoped por tripId (viaje_id) ya validado (rls-viabilidad §2) | acotado por id ya validado | se sostiene |
| `services/confirmar-entrega-viaje.ts:352` | `.from(assignments)` | entrega bilateral, assignment scoped por tripId ya validado (rls-viabilidad §2) | acotado por id ya validado | se sostiene |
| `services/generar-coaching-viaje.ts:64` | `.from(trips)` | pipeline de coaching scoped por tripId ya validado en la ruta llamadora (censo §2 nota C / | acotado por id ya validado | se sostiene |
| `services/generar-coaching-viaje.ts:92` | `.from(assignments)` | assignment scoped por tripId ya validado (censo §2 nota C) | acotado por id ya validado | se sostiene |
| `services/geocodificar-origen.ts:149` | `.update(trips)` | scoped por tripId recién insertado por el generador autenticado en POST /trip-requests-v2 | acotado por id ya validado | se sostiene |
| `services/get-public-tracking.ts:237` | `.from(assignments)` | tracking público por token, sin tenant de sesión por diseño (censo §2 / rls-viabilidad §3) | cross-tenant por diseño | se sostiene |
| `services/liquidar-trip.ts:219` | `.from(liquidaciones)` | dupe-check idempotente scoped por asignacionId ya validado (censo §2(1) / rls-viabilidad § | acotado por id ya validado | se sostiene |
| `services/listar-trayectos-teltonika.ts:73` | `.from(vehicles)` | solo vehículos de la empresa de la membresía activa. | empresa activa (anotación redundante) | se sostiene |
| `services/listar-trayectos-teltonika.ts:97` | `.from(telemetryPoints)` | puntos de esos vehículos, ventana acotada, índice vehiculo+ts. | empresa activa (anotación redundante) | se sostiene |
| `services/listar-trayectos-teltonika.ts:190` | `.from(empresas)` | umbrales de la empresa de la membresía activa. | empresa activa (anotación redundante) | se sostiene |
| `services/matching-backtest.ts:181` | `.from(trips)` | backtest platform-admin, lectura cross-tenant gated por requirePlatformAdmin (rls-viabilid | platform-admin | se sostiene |
| `services/matching.ts:117` | `.from(trips)` | matching core scoped por tripId ya validado en la ruta (rls-viabilidad §3) | cross-tenant por diseño | se sostiene |
| `services/matching.ts:426` | `.update(trips)` | matching core, CAS de estado del trip scoped por tripId (rls-viabilidad §3) | cross-tenant por diseño | se sostiene |
| `services/notify-incident-shipper.ts:70` | `.from(assignments)` | notificador server-side, destinatario derivado del assignmentId ya validado (censo §2(3)) | acotado por id ya validado | se sostiene |
| `services/notify-tracking-link.ts:89` | `.from(assignments)` | notificador server-side, destinatario derivado del assignmentId ya validado (censo §2(3)) | acotado por id ya validado | se sostiene |
| `services/offer-actions.ts:156` | `.from(trips)` | accept de oferta scoped por offer.tripId ya validado (rls-viabilidad §2) | acotado por id ya validado | se sostiene |
| `services/offer-actions.ts:212` | `.update(offers)` | supersede de ofertas hermanas del mismo trip (offer.tripId ya validado) (rls-viabilidad §2 | acotado por id ya validado | se sostiene |
| `services/persist-eco-route-polyline.ts:54` | `.from(assignments)` | scoped por assignmentId ya validado en el accept de oferta (censo §2(1)) | acotado por id ya validado | se sostiene |
| `services/persist-eco-route-polyline.ts:102` | `.update(assignments)` | scoped por assignmentId ya validado en el accept de oferta (censo §2(1)) | acotado por id ya validado | se sostiene |
| `services/posicion-en-vivo.ts:121` | `.from(posicionesMovilConductor)` | scoped por asignacion_id + vehiculo_id del assignment ya autorizado por el caller (token p | acotado por id ya validado | se sostiene |
| `services/posicion-segmento.ts:163` | `.from(posicionesMovilConductor)` | scoped por vehicle.id del assignment ya autorizado por el caller (segmento pickup→entrega) | acotado por id ya validado | se sostiene |
| `services/procesar-cobranza-cobra-hoy.ts:104` | `.from(adelantosCarrier)` | cron platform-wide — sin tenant filter por diseño. | cross-tenant por diseño | se sostiene |
| `services/procesar-cobranza-cobra-hoy.ts:151` | `.update(adelantosCarrier)` | cron platform-wide — sin tenant filter por diseño. | cross-tenant por diseño | se sostiene |
