# Checklist de onboarding — cliente 1

**Para qué**: incorporar al primer cliente que no opera el PO (T10-30 de `.specs/trl10/spec.md`) y dejar trazado, paso a paso, qué pantalla o endpoint del sistema cubre cada etapa.
**Verificado contra**: `origin/main` del 2026-10-08 (`apps/web/src/router.tsx`, `apps/api/src/server.ts` y `apps/api/src/routes/`).
**Quién lo usa**: el PO o quien opere el onboarding, junto con el cliente.

Cada paso tiene una casilla, la pantalla (PWA en `app.boosterchile.com`), el endpoint del API que la respalda y la evidencia que se guarda. Las **brechas** son pasos que hoy el sistema no cubre de punta a punta; se resuelven antes del día 1 o se operan a mano con registro.

Datos del cliente:

| Campo | Valor |
|---|---|
| Razón social | |
| RUT | |
| Rol | Generador de carga / Transportista / Ambos |
| Contacto principal | |
| Contrato firmado (fecha) | |
| Versión de Términos aceptada | |

---

## 0. Prerrequisitos legales y comerciales

- [ ] Contrato por rol firmado (`docs/legal/contratos-por-rol-v1.md`, ya con `lawyer_review: <fecha>`).
- [ ] Términos y Condiciones aceptados. Hoy la app solo ofrece los **v2** en `/legal/terminos` (aceptación registrada en `carrier_memberships`, solo para transportistas). Los v3 están en borrador.
- [ ] Aviso de privacidad entregado a usuarios y conductores.
- [ ] Modo de pago acordado: **pago directo** (vigente). El mandato de cobro no está activo (ADR-080 §5).

> **Brecha**: con los Términos v2 vigentes en la app, el modelo comercial que describe la app (comisión al transportista) no coincide con el acordado (ADR-079, comisión al generador). Antes de facturar al cliente 1 hay que publicar los v3 o dejar el modelo comercial en el contrato firmado.

## 1. Alta de la empresa

| | Paso | Pantalla | Endpoint | Evidencia |
|---|---|---|---|---|
| [ ] | Admin de plataforma crea la empresa (ficha legal, rol generador y/o transportista) | `/app/platform-admin/empresas` | `POST /admin/empresas` | Empresa en estado de verificación |
| [ ] | Admin de plataforma activa la empresa tras verificar RUT y datos | `/app/platform-admin/empresas` | `PATCH /admin/empresas/:id` | Estado `activa` (el matching exige empresa activa) |
| [ ] | Alternativa: el cliente pide acceso y el admin aprueba | `/solicitar-acceso` → `/app/platform-admin/signup-requests` → `/onboarding-admin` | `POST /api/v1/signup-request`, `POST /admin/signup-requests/:id/approve`, `POST /empresas/onboarding-admin` | Solicitud aprobada y empresa creada |

> La alternativa depende del flag `SIGNUP_REQUEST_FLOW_ACTIVATED`; con el flag apagado, los endpoints admin de solicitudes responden 503. Para el cliente 1 se recomienda el alta directa.

Métrica asociada: `alta_empresa_admin_total`, `empresa_estado_cambios_total`.

## 2. Usuarios por rol

| | Paso | Pantalla | Endpoint | Evidencia |
|---|---|---|---|---|
| [ ] | Admin de plataforma invita al dueño de la empresa; se emite código de activación | `/app/platform-admin/empresas` | `POST /admin/empresas/:id/miembros` | Membresía `pendiente_invitacion` |
| [ ] | El dueño activa su cuenta y fija su clave numérica | `/activar` | `POST /auth/activar` | Membresía `activa` |
| [ ] | El dueño entra con RUT y clave | `/login` | `POST /auth/login-rut` | Último login registrado |
| [ ] | El dueño invita a administradores, despachadores y visualizadores | `/app/equipo` | `POST /me/empresa/miembros` | Miembros listados en `/app/equipo` |
| [ ] | Si hay que reenviar un código | `/app/platform-admin/empresas` | `POST /admin/empresas/:id/miembros/:membershipId/codigo` | Código reemitido |

> **Brecha**: la entrega del código de activación por WhatsApp o correo depende de `CONTENT_SID_ACTIVACION_CONDUCTOR` y `RESEND_API_KEY` (T10-04). Al 2026-09-22 ninguno estaba en el API de producción, y el código se entrega a mano. Registrar quién lo entregó y cuándo.

Métricas: `alta_invitacion_admin_total`, `alta_reemision_codigo_total`.

## 3. Vehículos, conductores y dispositivos (si el cliente es transportista)

| | Paso | Pantalla | Endpoint | Evidencia |
|---|---|---|---|---|
| [ ] | Registrar cada vehículo (patente, tipo, combustible, capacidad, perfil energético) | `/app/vehiculos/nuevo` | `POST /vehiculos` | Vehículo listado en `/app/vehiculos` |
| [ ] | Declarar zonas de operación | `/app/zonas` | `POST /me/zonas` | Zonas listadas |
| [ ] | Crear conductores (RUT, licencia, vencimiento) | `/app/conductores/nuevo` | `POST /conductores` | Conductor `activo` con PIN pendiente |
| [ ] | Cada conductor activa su cuenta | `/activar` | `POST /auth/activar` | `firebase_uid` sin prefijo `pending-rut:` |
| [ ] | Cada conductor entra desde su teléfono | `/login/conductor` | `POST /auth/login-rut` | Último login registrado |
| [ ] | Dispositivo Teltonika: el equipo se conecta y queda pendiente; se asocia al vehículo | `/app/admin/dispositivos` (transportista) o `/app/platform-admin/teltonika` (admin) | `POST /admin/dispositivos-pendientes/:id/asociar` o `POST /admin/plataforma/dispositivos/asignar` | IMEI asociado; posición visible en `/app/vehiculos/$id/live` |
| [ ] | Verificar telemetría y CAN del vehículo | `/app/vehiculos/$id/live`, `/app/trayectos` | `GET /vehiculos/:id/ubicacion`, `GET /vehiculos/:id/telemetria` | Posiciones recientes; datos CAN presentes (necesarios para certificado primario) |
| [ ] | Activar el módulo de cumplimiento documental, si el cliente lo quiere | `/app/cumplimiento` | `/cumplimiento/*`, `/documentos/*` | Documentos de vehículo y conductor cargados |

Métricas: `dispositivo_asociaciones_total`, `dispositivo_asociaciones_plataforma_total`; métricas de logs `telemetry/device_records_per_minute` y `telemetry/parser_errors`.

## 4. Medición de huella

| | Paso | Pantalla | Endpoint | Evidencia |
|---|---|---|---|---|
| [ ] | La empresa activa la medición de huella | `/app/empresa` | `PATCH /me/empresa` (`carbon_measurement_enabled`) | `huella_opt_in_cambios_total` |
| [ ] | Si el cliente es generador: sucursales de origen y destino | `/app/sucursales/nueva` | `POST /sucursales` | Sucursales listadas |

## 5. Primera solicitud de carga (generador)

| | Paso | Pantalla | Endpoint | Evidencia |
|---|---|---|---|---|
| [ ] | Publicar la solicitud (origen, destino, fechas, carga, precio del transportista) | `/app/cargas/nueva` | `POST /trip-requests-v2` | Viaje en `esperando_match` → `ofertas_enviadas` |
| [ ] | Revisar el estado de la solicitud | `/app/cargas/$id` | `GET /trip-requests-v2/:id` | Ofertas emitidas |

> **Brecha**: el tipo de carga `spot`/`programada`, la comisión al generador y el desglose al publicar (ADR-079) no están en `main`. Hoy la solicitud se publica con el modelo v2. Acordar con el cliente cómo se le factura la comisión del primer ciclo (ver §8).

## 6. Primer viaje

| | Paso | Pantalla | Endpoint | Evidencia |
|---|---|---|---|---|
| [ ] | El transportista ve y acepta la oferta | `/app/ofertas` | `GET /offers/mine`, `POST /offers/:id/accept` | Viaje `asignado` |
| [ ] | El transportista asigna conductor y vehículo | `/app/asignaciones/$id` | `POST /assignments/:id/asignar-conductor` | Conductor asignado |
| [ ] | El conductor confirma la recogida | `/app/conductor` | `PATCH /assignments/:id/confirmar-recogida` | Viaje `en_proceso`; `recogidas_confirmadas_total` |
| [ ] | Posición durante el viaje (Teltonika o teléfono) | `/app/conductor` | `POST /assignments/:id/driver-position` (sin Teltonika) | Puntos en la traza |
| [ ] | El generador sigue el viaje y comparte el enlace público | `/app/cargas/$id/track`, `/tracking/$token` | `GET /public/tracking/:token` | Enlace funcionando |
| [ ] | Chat del viaje, si se usa | `/app/chat/$id` | `/assignments/:id/messages*` | Mensajes |
| [ ] | El conductor confirma la entrega | `/app/conductor` | `PATCH /assignments/:id/confirmar-entrega` | Viaje `entregado`; `viajes_entregados_total` |

## 7. Cierre documental

| | Paso | Pantalla | Endpoint | Evidencia |
|---|---|---|---|---|
| [ ] | Una de las partes sube la guía de despacho o la factura | `/app/asignaciones/$id` o `/app/cargas/$id/track` (panel de documentos) | `POST /transport-orders/:id/documents` | Documento con `retention_until` |
| [ ] | Revisar si se leyó el timbre (TED) | mismo panel | `GET /documents/:id` | Datos extraídos o ingreso manual |
| [ ] | El generador confirma la recepción conforme | — | `PATCH /trip-requests-v2/:id/confirmar-recepcion` | Viaje entregado por el generador |

> **Brecha**: la recepción conforme del generador existe en el API pero **ninguna pantalla de la PWA la invoca** (`grep confirmar-recepcion apps/web/src` = 0). Hoy el cierre lo hace el conductor con `confirmar-entrega`. Para el mandato de cobro (ADR-080 §6.5) falta la pantalla.
>
> Con `REQUIRE_DOCUMENT_TO_CLOSE=true`, el cierre exige un documento solo para órdenes creadas desde `REQUIRE_DOCUMENT_TO_CLOSE_SINCE`; al 2026-09-22 esa variable no estaba en producción. Confirmar el valor antes del día 1.

## 8. Certificado de huella

| | Paso | Pantalla | Endpoint | Evidencia |
|---|---|---|---|---|
| [ ] | El certificado se emite al entregar | `/app/certificados` | `GET /certificates` | Certificado con nivel y fuente |
| [ ] | Descargar el PDF firmado | `/app/certificados`, `/app/cargas/$id` | `GET /trip-requests-v2/:id/certificate/download`, `GET /assignments/:id/certificate/download` | PDF con firma PAdES |
| [ ] | Verificar el certificado por su código | — | `GET /certificates/:tracking_code/verify` | Respuesta de verificación válida |
| [ ] | Anotar el nivel obtenido | — | — | `primario_verificable` exige CAN + Teltonika con cobertura ≥ 95 % (T10-05) |

## 9. Primer ciclo de facturación

| | Paso | Pantalla | Endpoint | Evidencia |
|---|---|---|---|---|
| [ ] | Liquidación del viaje | `/app/liquidaciones` (transportista) | `GET /me/liquidaciones` | Liquidación con `pricing_methodology_version` |
| [ ] | Factura de Booster por la comisión | — | — | Factura emitida por Booster y registrada |
| [ ] | Pago del flete del generador al transportista (pago directo) | — | — | Comprobante de transferencia |
| [ ] | Pago de la factura de Booster | — | — | Comprobante |
| [ ] | Cierre del ciclo registrado en `docs/handoff/<fecha>-cliente-1.md` | — | — | Plantilla `plantilla-feedback.md` |

> **Brecha (crítica para T10-30)**: en `main` la liquidación es **v2**: calcula la comisión descontada al transportista según su membresía (`liquidar-trip.ts`) y se omite si el transportista no tiene membresía activa. No existe la liquidación v3 ni la factura de comisión al generador (ADR-079, flag `PRICING_V3_ACTIVATED`, acciones derivadas 2 a 6), ni pantalla de facturas para el generador. El cobro de suscripciones tiene el medio de pago simulado (`infrastructure/scheduling.tf`). Hasta que eso exista, el primer ciclo se factura fuera del sistema, con registro manual de montos y fechas, y así se declara en el handoff.

---

## Registro

| Fecha | Paso | Quién | Resultado | Nota |
|---|---|---|---|---|
| | | | | |
