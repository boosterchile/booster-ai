# ADR-011 — Panel administrativo Booster (rol Admin)

**Status**: Accepted
**Date**: 2026-04-23
**Decider**: Felipe Vicencio (Product Owner)
**Related**: [ADR-004 Modelo Uber-like](./004-uber-like-model-and-roles.md), [ADR-008 PWA multi-rol](./008-pwa-multirole.md), [`skills/incident-response`](../../skills/incident-response/SKILL.md)

---

## Contexto

El rol `admin` de ADR-004 corresponde a staff interno de Booster que gestiona la plataforma. Sus necesidades operativas son cualitativamente distintas a las de los demás roles — no participan de trips, pero deben:

1. **Ver y gestionar usuarios** de cualquier rol (shipper, carrier, driver, stakeholder), resolver bloqueos, reenviar onboarding.
2. **Resolver problemas** que los usuarios reporten vía WhatsApp, soporte, email, o que se detecten proactivamente.
3. **Comunicar contingencias** (caídas de servicio, cambios de política, alertas operativas) a grupos de usuarios específicos.
4. **Configurar parámetros de plataforma** (pricing, ventanas de matching, áreas de cobertura, feature flags) sin deploy de código.
5. **Auditar** toda la actividad con trazabilidad.

El admin es **cliente interno crítico**: si el panel no funciona bien, cada incidente de usuario se vuelve un escalamiento manual al equipo técnico. Reducir el tiempo de resolución de tickets es directa función de qué tan poderoso y claro sea este panel.

## Decisión

Implementar el panel admin como **una de las vistas-por-rol dentro de `apps/web`** (ver ADR-008), no como aplicación separada. Razones:

- Reusa auth, layouts, design system del resto de la PWA.
- Deploy y versionado unido con el producto principal.
- Admin puede cambiar de "modo admin" a "modo shipper test" fácilmente (útil para reproducir issues del cliente).

### Módulos del panel admin

```
app.boosterchile.com/admin/
├── /overview                    # Dashboard: KPIs operativos en tiempo real
├── /users
│   ├── /search                  # Búsqueda unificada (email, RUT, teléfono, nombre)
│   ├── /:user_id                # Perfil: datos, roles, historial
│   ├── /:user_id/impersonate    # Actuar como el usuario (con audit log)
│   ├── /:user_id/trips          # Todos sus trips (past + active)
│   ├── /:user_id/documents      # Documentos asociados
│   └── /:user_id/communications # Historial WhatsApp/email/SMS
├── /trips
│   ├── /active                  # Todos los trips en curso
│   ├── /:trip_id                # Detalle con timeline de eventos
│   └── /:trip_id/intervene      # Forzar transición (con audit)
├── /incidents
│   ├── /open                    # Tickets abiertos (from reports + alerts)
│   ├── /:incident_id            # Detalle, acciones, comms
│   └── /create                  # Crear incidente manual
├── /disputes                    # Disputas abiertas entre shipper/carrier
├── /stakeholders                # Gestión de Sustainability Stakeholders y sus consents
├── /broadcasts                  # Comunicación masiva
│   ├── /compose                 # Nuevo broadcast (template + segmento + canal)
│   ├── /history                 # Broadcasts enviados + métricas
│   └── /templates               # Templates reutilizables
├── /config
│   ├── /pricing                 # Ajustar tiers y fees (audit log)
│   ├── /matching                # Ventanas, top-N, umbrales
│   ├── /coverage                # Áreas geográficas soportadas
│   ├── /feature-flags           # GrowthBook UI embebida
│   └── /dte-provider            # Configuración del emisor DTE activo
├── /audit                       # Explorador de audit logs (filtros + export)
├── /reports                     # Reportes operacionales + financieros
│   ├── /revenue
│   ├── /emissions-totals
│   └── /custom                  # Query builder limitado
└── /health                      # Observability: status de servicios, alertas activas
```

### Diseño UX específico del admin

**Density alta**: tablas densas, filtros avanzados, muchas acciones por fila. No es PWA touch-first — asume desktop + teclado. Atajos de teclado (`/` search, `j/k` navigation).

**Impersonation segura**:
- Botón "Actuar como este usuario" en perfil del user
- Warning modal exigiendo razón escrita ("Investigando ticket #1234")
- Durante impersonation, banner amarillo permanente con "Saliendo en 15min" countdown
- Cada acción queda en audit log tanto del admin como del user impersonado
- Sin write operations durante primeros 60s (solo lectura) para evitar clicks accidentales

**Command palette** (Cmd+K): búsqueda universal de cualquier entidad del sistema. Escribir email → va al user. Escribir UUID → va al trip. Escribir RUT → va al shipper/carrier. Patente → va al vehicle.

### Broadcasts y contingencias

Los admins necesitan comunicar a segmentos específicos cuando ocurren eventos críticos. Ejemplos:
- "Caída del TCP gateway 20 min" → notificar a carriers con Teltonika activo
- "Nueva política de ESG vigente desde X fecha" → notificar shippers Pro+
- "Mantenimiento programado" → todos los usuarios activos
- "Actualización de términos" → todos los usuarios

**Segmentación**:
- Por rol (shipper, carrier, driver, stakeholder, admin)
- Por plan (free, pro, enterprise)
- Por región (comuna, región Chile)
- Por actividad (activo última semana / 30d / 90d)
- Por flag (carriers con Teltonika / shippers con ESG premium / etc.)
- Por lista custom (CSV upload de user IDs)

**Canales**:
- Web Push (al PWA)
- FCM (si hay app nativa futura)
- WhatsApp (via template Meta aprobado)
- Email
- SMS (último recurso, solo SEV-1)
- Banner en UI del rol relevante

**Templating**:
- Templates guardados con placeholders
- Preview en cada canal antes de enviar
- Test send a lista pequeña primero
- Confirmación de 2 factores antes de broadcast a >500 usuarios

**Métricas**:
- Entrega (sent, delivered, failed)
- Engagement (opened, clicked, dismissed)
- Opt-out (cuántos se desactivaron tras el mensaje)

### Gestión de incidentes

Los incidentes pueden venir de:
1. **Report directo de usuario** — via form en app, WhatsApp al bot, email a soporte
2. **Alerta automática** — Cloud Monitoring dispara ticket cuando SLO se rompe
3. **Creación manual** — admin detecta algo proactivamente

Workflow:
1. Incidente creado con `sev` (1-4), `title`, `description`, `affected_entities`
2. Auto-assignment a admin oncall según turno
3. Admin trabaja el incidente: agrega comentarios, tag entidades afectadas, comunica al reporter
4. Admin puede invocar `skills/incident-response/SKILL.md` para SEV-1/2
5. Al cerrar, requiere resolución explícita: `fixed`, `user_error`, `duplicate`, `wont_fix`, `escalated`

**Integración con trip state machine**: si un incidente afecta a un trip activo, el admin puede **intervenir** forzando transiciones (ej. `in_transit → failed` con razón "vehículo averiado") con audit trail y notificación automática a shipper/carrier.

### Configuración dinámica

Parámetros de plataforma que cambian sin deploy:

| Parámetro | Ejemplo | Razón |
|-----------|---------|-------|
| `pricing.shipper.fee_pct` | 5 | Ajustar comisión según estrategia comercial |
| `pricing.carrier.subscription_clp` | 50_000 | Cambiar precio plan Pro carrier |
| `matching.window_seconds.peak` | 180 | Acortar ventana en peak si demanda alta |
| `matching.top_n_candidates` | 3 | Cuántos carriers reciben oferta simultánea |
| `coverage.regions_active` | ["RM", "V", "IV"] | Expandir cobertura geográfica |
| `dte_provider.active` | "bsale" \| "paperless" | Cambiar provider DTE (failover) |
| `whatsapp_bot.enabled` | true | Desactivar bot si hay bug |

**Storage**: Firestore collection `config/` con documento por categoría. Cached en Redis con TTL 5min (hot reload).

**Auditoría**: cada cambio tiene actor, timestamp, old_value, new_value. Revisable en `/admin/audit`.

**Protección**: cambios críticos (pricing.*) requieren aprobación 2FA de otro admin antes de aplicarse.

### Audit log

Tabla `audit_log` en BigQuery (largo plazo) + vista en Postgres para consulta reciente:

```sql
event_id UUID
timestamp TIMESTAMP
actor_user_id UUID
actor_role STRING
action STRING          -- "user.update", "config.change", "broadcast.send", etc.
target_type STRING     -- "user" | "trip" | "config" | ...
target_id STRING
before JSON
after JSON
reason STRING          -- razón declarada por el admin (obligatoria para acciones sensibles)
ip_address STRING
user_agent STRING
impersonating_user_id UUID  -- si la acción se hizo bajo impersonation
```

Retención: 7 años (supera los 6 años de SII + margen).

Exportable por BigQuery para auditoría externa.

## Consecuencias

### Positivas

- **Tiempo de resolución de tickets reducido**: herramientas centralizadas (search global, impersonation, audit inline) vs CLI + DB queries ad-hoc.
- **Trazabilidad completa**: cada acción admin es auditable, requisito para TRL 10 y para confianza de clientes enterprise.
- **Comms consistentes**: broadcasts templateados reducen errores de copy y riesgo legal.
- **Config sin deploy**: ajustes comerciales (fee %, ventanas) no requieren ciclo de release. Reduce TTM.
- **Admin como cliente interno**: el foco en UX admin acelera al resto del equipo, no es "último en la lista".

### Negativas

- **Superficie de abuso aumentada**: un admin comprometido puede causar daño sistémico. Mitigar con:
  - 2FA obligatorio para admins
  - Impersonation con razón documentada
  - Audit log inmutable
  - Aprobación de peer para cambios críticos (pricing)
  - Revisión periódica del roster de admins
- **Complejidad de UI**: 10+ módulos requieren curva de aprendizaje para admins nuevos. Mitigar con:
  - Onboarding interno (docs/runbooks)
  - Command palette como aceleración
  - UX progresiva (básico por default, avanzado bajo flag)
- **Riesgo de "shadow admin"**: sin disciplina, cualquier cambio se hace desde el panel en vez de ADR+PR. Mitigar con:
  - Config changes que afectan precio/matching/cobertura requieren ADR cuando son permanentes
  - Audit log review mensual del equipo

## Implementación

Vive dentro de `apps/web/src/roles/admin/`. No crea nueva app.

Depende de:
- `@booster-ai/shared-schemas` (schemas de User, Trip, CargoRequest, etc.)
- `@booster-ai/ui-components` (Table, Filter, Dialog, etc.)
- Nuevo package: `@booster-ai/admin-sdk` — helpers específicos del admin (impersonation, audit helpers, broadcast builder)

Backend endpoints en `apps/api/src/routes/admin/*` con middleware que valida `req.user.roles includes 'admin'` + RBAC granular dentro de admin (tiers: super_admin, support_admin, config_admin).

## Validación

- [ ] Admin puede encontrar cualquier user en <3 segundos via command palette
- [ ] Impersonation funciona y deja audit log + banner visible
- [ ] Broadcast a 100 usuarios se envía en <30s con métricas de entrega
- [ ] Cambio de pricing aplica en producción en <5 minutos sin deploy
- [ ] Audit log captura cada acción con actor + razón + before/after
- [ ] Admin puede intervenir un trip activo forzando transición con razón
- [ ] Page load p95 < 2s (desktop broadband)

## Referencias

- [ADR-004 Modelo Uber-like](./004-uber-like-model-and-roles.md) — rol admin
- [ADR-008 PWA multi-rol](./008-pwa-multirole.md) — layout admin
- [skills/incident-response](../../skills/incident-response/SKILL.md)
- Anti-patterns admin panels (Segment): https://segment.com/blog/admin-panels-anti-patterns/
