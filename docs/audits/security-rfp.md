# RFP — Pentest externo y revisión OWASP de Booster AI

**Versión**: 2 (actualizada al estado de octubre de 2026)
**Emisión original**: 2026-05-18 · **Actualización**: 2026-10-08
**Responsable**: Felipe Vicencio, Product Owner (`dev@boosterchile.com`)
**Empresa**: Booster Chile SpA — Booster AI, mercado B2B de logística sostenible en Chile
**Criterio que cierra**: T10-26 de `.specs/trl10/spec.md` (pentest externo con 0 hallazgos P0/P1 abiertos; reporte en `docs/audits/security-pre-launch-YYYY-MM-DD.md`)
**Referencias**: [ADR-028](../adr/028-rbac-auth-firebase-multi-tenant-with-consent-grants.md) (RBAC multiempresa), [ADR-035](../adr/035-auth-universal-rut-clave-numerica.md) (RUT + clave numérica), [ADR-062](../adr/062-cloud-run-ingress-posture.md) y [ADR-063](../adr/063-cloud-run-ingress-posture-round-2.md) (ingress), [ADR-069](../adr/069-booster-deja-de-emitir-dte-remocion-sovos.md) (sin DTE), [ADR-074](../adr/074-sink-errores-client-side-sentry-scrubbing.md) (Sentry), [ADR-079](../adr/079-modelo-comercial-v3-comision-al-generador-configurable.md) (modelo comercial v3), ADR-083 (staging gemelo; en revisión en la rama `claude/trl10-d-staging-adr`), `.github/workflows/security.yml`
**Estado**: listo para enviar (PO) — ver §8

---

## 1. Objetivo

Contratar a un proveedor externo para ejecutar un **pentest de caja gris** y una **revisión OWASP Top 10 (2021) y OWASP API Security Top 10 (2023)** sobre Booster AI, antes de operar con el primer cliente comercial bajo contrato. El reporte, priorizado por severidad, alimenta las correcciones; el criterio de aceptación es **0 hallazgos P0/P1 abiertos** tras el re-test (§5).

## 2. Qué es Booster AI hoy

### 2.1. Producto

Booster conecta **generadores de carga** con **transportistas** en Chile. El generador publica una solicitud de carga, un algoritmo propone transportistas, el transportista acepta, su **conductor** ejecuta el viaje desde una PWA y el sistema registra la traza GPS, cierra la orden con el documento tributario que suben las partes y emite un **certificado de huella de carbono** firmado digitalmente.

Datos de negocio relevantes para el riesgo:

- **Comisión y precio confidencial**: la comisión de Booster la paga el generador y el transportista **no debe ver** la comisión ni el precio al generador (ADR-079 §5). Una fuga de esos campos a un rol transportista o conductor es un hallazgo de severidad alta para el negocio.
- **Sin emisión de DTE**: Booster no emite documentos tributarios ni se integra con el SII (ADR-069). Recibe y archiva los documentos de terceros (ADR-070). Ya no existe integración con proveedores de facturación electrónica.
- **Datos personales**: RUT, teléfonos, ubicación GPS de conductores, telemetría de vehículos, documentos de conductores. Sujetos a la Ley 19.628 y a la Ley 21.719 desde el 2026-12-01.
- **Multiempresa**: cada empresa ve solo sus datos; organizaciones stakeholder ven agregados con consentimiento.

### 2.2. Arquitectura

Todo en Google Cloud, región `southamerica-west1` (Santiago), gestionado con Terraform.

| Componente | Runtime | Función |
|---|---|---|
| `apps/api` | Cloud Run | API HTTP (Hono + Drizzle + PostgreSQL). Núcleo del negocio. |
| `apps/web` | Cloud Run | PWA React + Vite, multirrol (generador, transportista, conductor, admin de plataforma, stakeholder). |
| `apps/whatsapp-bot` | Cloud Run | Webhook de WhatsApp vía Twilio (firma `X-Twilio-Signature`); intake conversacional de cargas. |
| `apps/telemetry-tcp-gateway` | GKE Autopilot | Recibe tráfico TCP Codec8 de dispositivos Teltonika (TLS, ADR-040). |
| `apps/telemetry-processor` | Cloud Run | Consume Pub/Sub de telemetría y persiste posiciones, eventos y trazas de accidentes. |
| `apps/sms-fallback-gateway` | Cloud Run | Webhook SMS de respaldo para dispositivos sin datos. |
| `apps/document-service` | Cloud Run | Extracción del timbre (TED) de documentos subidos. En extracción del monolito (T10-21). |
| `apps/notification-service` | Cloud Run | Notificaciones. En extracción del monolito (T10-21). |
| `apps/matching-engine` | Cloud Run | Asignación de cargas. En extracción del monolito (T10-21). |

Servicios de soporte: Cloud SQL PostgreSQL con IP privada y SSL obligatorio, Memorystore Redis, Pub/Sub, Cloud Storage con CMEK, BigQuery, Cloud KMS (firma de certificados RSA 4096), Secret Manager, Cloud Armor, Identity Platform (Firebase Auth), Vertex AI (Gemini) y Google Maps Platform. Terceros: Twilio (WhatsApp y SMS), Sentry (errores del navegador, con filtrado por lista permitida), Datadog (logs de infraestructura del gateway).

> Los tres microservicios en extracción se despliegan con imagen propia y se prueban primero en staging y luego en modo *shadow* en producción (ADR-083 §2). Entran al alcance si están desplegados en staging al inicio de la auditoría.

### 2.3. Autenticación y autorización

- **Usuarios**: RUT + clave numérica de 6 dígitos (ADR-035). `POST /auth/login-rut` valida contra un *hash* scrypt y entrega un *custom token* de Firebase; la sesión posterior usa el ID token de Firebase. Recuperación por código de un solo uso enviado por WhatsApp (10 min). Activación de conductores por PIN emitido por su empresa (`POST /auth/activar`).
- **Alta de empresas**: solicitud pública (`POST /api/v1/signup-request`, con límite de tasa y respuesta idéntica para evitar enumeración), aprobación por admin de plataforma y token de un solo uso para el alta (`POST /empresas/onboarding-admin`).
- **Roles**: dueño, administrador, despachador, conductor, visualizador y responsable de sostenibilidad, por empresa (ADR-028). Admin de plataforma por lista de correos permitidos.
- **Servicio a servicio**: OIDC con cuentas de servicio (Cloud Scheduler → `/admin/jobs/*`, Pub/Sub push).
- **Soporte**: impersonación auditada por admin de plataforma, solo sobre empresas marcadas como de prueba.

### 2.4. Controles existentes

CI ejecuta gitleaks, CodeQL, Trivy (archivos y configuración de Dockerfiles y Terraform), `npm audit` y un control de rutas con denegación por defecto (`.github/workflows/security.yml`). El logger redacta datos personales (ADR-051). La auditoría externa complementa estos controles; no los reemplaza.

## 3. Alcance

### 3.1. Dentro del alcance

| Ítem | Qué se espera |
|---|---|
| PWA (`apps/web`) | Por rol: control de acceso, IDOR, XSS, CSRF, almacenamiento local, *service worker*, *web push*. |
| API (`apps/api`) | OWASP API Top 10. Prioridad: `/auth/*`, `/me/*`, `/empresas/*`, `/trip-requests-v2/*`, `/offers/*`, `/assignments/*`, `/vehiculos/*`, `/conductores/*`, `/transport-orders/:id/documents`, `/documents/:id`, `/certificates/*`, `/admin/*`, `/public/tracking/*`. |
| Aislamiento entre empresas | Que una empresa no lea ni escriba datos de otra; que un stakeholder solo vea agregados con consentimiento vigente. |
| Visibilidad por rol del precio | Que ninguna respuesta, mensaje de WhatsApp ni notificación a transportista o conductor exponga comisión, precio al generador o total facturado (ADR-079 §5). |
| Autenticación | Fuerza bruta y enumeración sobre RUT + clave, recuperación por código, activación por PIN, manejo de tokens de Firebase, token de alta de un solo uso. |
| Subida de archivos | Documentos de transporte y fotos: tipo, tamaño, URL firmadas, acceso cruzado. |
| Webhooks | WhatsApp (Twilio) y SMS: validación de firma, repetición, idempotencia. |
| Gateway de telemetría | Codec8 malformado, suplantación de IMEI, TLS, resistencia a conexiones concurrentes. |
| Enlace público de seguimiento | Opacidad del token, expiración, datos expuestos, límite de tasa. |
| Configuración GCP | IAM y cuentas de servicio, ingress de Cloud Run, Cloud Armor, buckets, secretos, KMS. Revisión de configuración, no explotación de la infraestructura de Google. |
| Dependencias | CVE altas o críticas en dependencias de producción. |

### 3.2. Fuera del alcance

- Pruebas de denegación de servicio a volumen (T10-19 cubre carga en un entorno que no es producción).
- Ingeniería social y *red team*.
- Certificación GLEC de la metodología de huella (RFP aparte, `docs/compliance/glec-rfp.md`).
- Infraestructura de terceros (Google, Twilio, Sentry, Datadog) más allá de su configuración por Booster.
- Producción: el pentest no se ejecuta contra producción.

### 3.3. Entorno

| Entorno | Acceso | Datos |
|---|---|---|
| **Staging** — proyecto gemelo `booster-ai-stg-494222`, dominio `staging.boosterchile.com` (ADR-083) | Cuentas de prueba por rol entregadas por Booster; acceso a la consola GCP de solo lectura para la revisión de configuración, si se requiere | Solo datos sintéticos y *seeds*. Staging no copia datos de producción. |

Staging usa la misma configuración de Terraform que producción, con su propio estado y tamaños mínimos. Un dispositivo Teltonika de prueba o un simulador Codec8 queda disponible para el gateway.

> **Dependencia**: a la fecha de esta versión, ADR-083 está en revisión y el proyecto de staging no está creado. El *kickoff* del pentest exige `https://api.staging.boosterchile.com/health` respondiendo 200. Si staging no está listo, el envío del RFP no se detiene: se acuerda la fecha de inicio con el proveedor.

NDA mutuo firmado antes de entregar accesos.

## 4. Entregables

| # | Entregable | Formato |
|---|---|---|
| 1 | Resumen ejecutivo | PDF, 1–2 páginas |
| 2 | Reporte de hallazgos por severidad (Crítica, Alta, Media, Baja, Informativa) con CVSS v3.1 o v4.0 | PDF o Markdown |
| 3 | Reproducción por hallazgo | Pasos, prueba de concepto e impacto |
| 4 | Recomendaciones de corrección | Específicas para el stack |
| 5 | Matriz OWASP Top 10 y API Top 10 | Cada categoría con hallazgos o con la razón de su ausencia |
| 6 | Re-test | Al menos una ronda sobre Críticos y Altos |
| 7 | Carta de atestación | Alcance, metodología y período, firmada por el proveedor |

## 5. Criterios de aceptación

- **Equivalencia de severidad**: P0 = Crítica, P1 = Alta.
- El trabajo se da por aceptado cuando el re-test del proveedor confirma **0 hallazgos P0/P1 abiertos**. Un hallazgo P0/P1 solo puede cerrarse por corrección verificada en el re-test; no se aceptan cierres por "riesgo aceptado".
- Los hallazgos Medios y Bajos quedan registrados como issues con plazo, y no bloquean T10-26.
- El reporte final se versiona en `docs/audits/security-pre-launch-YYYY-MM-DD.md` (resumen, matriz y estado de cada hallazgo; sin detalles explotables de hallazgos abiertos).

## 6. Plazos

| Hito | Plazo |
|---|---|
| Respuesta de proveedores | 2 semanas desde el envío |
| Selección y contrato | 2 semanas desde la última respuesta |
| Inicio de la auditoría | ≤ 2 semanas desde la firma, con staging operativo |
| Auditoría activa | 2–3 semanas |
| Reporte preliminar | ≤ 1 semana desde el término |
| Correcciones P0/P1 | Booster, ≤ 2 semanas desde el reporte |
| Re-test y carta de atestación | ≤ 1 semana desde las correcciones |

Duración total esperada: 8 a 10 semanas desde el envío.

## 7. Propuesta comercial solicitada

El proveedor cotiza: precio fijo por el alcance de §3, precio de rondas adicionales de re-test, condiciones de pago y forma de contratación. Booster no publica un rango de precio en este documento; el presupuesto lo fija el PO (OQ-2 de la spec TRL 10). El contrato lo revisa el abogado de Booster.

**Criterios de selección**: certificaciones del equipo (OSCP, OSWE, CREST o equivalentes), experiencia en aplicaciones Node.js/TypeScript sobre GCP con Firebase Auth, experiencia en APIs multiempresa, idioma del reporte (español o inglés) y disponibilidad para los plazos de §6.

## 8. Envío

**Estado**: listo para enviar (PO).

El envío lo hace el PO. Esta tabla se completa a medida que se contacta a proveedores. Las propuestas recibidas no se versionan en el repo.

| Fecha | Proveedor | Respuesta |
|---|---|---|
| | | |
| | | |
| | | |

### 8.1. Texto sugerido para el envío

```
Asunto: Solicitud de propuesta — pentest y revisión OWASP de Booster AI (Chile)

Estimados:

Soy Felipe Vicencio, de Booster AI, una plataforma B2B de logística
sostenible que opera en Chile. Buscamos un pentest de caja gris y una
revisión OWASP Top 10 / API Top 10 sobre nuestro entorno de staging,
antes de operar con nuestro primer cliente bajo contrato.

Stack: Node.js + TypeScript (Hono, Drizzle, PostgreSQL), PWA React,
Firebase Auth, Google Cloud (Cloud Run, GKE Autopilot, KMS, Secret
Manager) y un gateway TCP para dispositivos de telemetría.

Adjunto el detalle del alcance, entregables, criterios de aceptación y
plazos. Agradeceré confirmar si el trabajo calza con su práctica, una
propuesta con precio y plazos, y cualquier pregunta sobre el alcance.

Saludos,
Felipe Vicencio
Booster AI · dev@boosterchile.com
```

## 9. Registro de cambios

- **2026-05-18** — Primera versión (S0 T7). Lista corta por categorías de proveedor y rango de precio de referencia.
- **2026-10-08** — Actualización al estado real (T10-26): arquitectura vigente, staging gemelo (ADR-083), auth RUT + clave (ADR-035), sin DTE (ADR-069), visibilidad del precio por rol (ADR-079). Se quitan la referencia a un ADR-048 futuro, la lista de proveedores sugeridos y el rango de precio (la elección y el presupuesto son del PO). Criterio de aceptación explícito: 0 P0/P1 abiertos tras el re-test.
