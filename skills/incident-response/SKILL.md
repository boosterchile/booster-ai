# Skill: Incident Response

**Categoría**: operations-sre
**Prioridad**: crítica — este skill se invoca bajo estrés, debe ser seguible sin pensar

## Overview

Cómo responder cuando algo falla en producción. Tres fases disciplinadas: **detectar, estabilizar, entender**. Un post-mortem separado (ver `skills/post-mortem`) analiza la causa raíz después.

## When to Use

- Alerta de Cloud Monitoring dispara (error rate, latency, SLO breach)
- Reporte de usuario vía WhatsApp, email o admin panel
- On-call detecta anomalía proactivamente (logs, métricas, traces)
- Sospecha fundada de compromiso de seguridad

**NO es incidente**:
- Ticket de feature request
- Bug reproducible pero no crítico (issue normal)
- Alarma de staging (debugging, no incidente)

## Severity classification

Usar esta tabla en el primer minuto. No sobre-pensar — si dudas, escala.

| Sev | Criterio | Respuesta |
|-----|----------|-----------|
| **SEV-1** | Producción inaccesible, data loss, breach de seguridad confirmado, pérdida financiera activa | Declarar de inmediato. Despertar a quien sea. |
| **SEV-2** | Funcionalidad crítica degradada para >20% usuarios, SLO breach, pérdida potencial financiera | Asignar on-call primary + backup. Working group inmediato. |
| **SEV-3** | Funcionalidad no crítica degradada, workaround disponible, SLO budget en peligro pero no roto | Asignar on-call. Resolver en hora hábil. |
| **SEV-4** | Molestia menor, edge case, cosmético | Crear issue normal, priorizar en sprint. |

## Core Process

### Fase 1 — DETECTAR (primeros 5 minutos)

1. **Confirmar que es real**:
   - Reproducir desde una segunda fuente (segundo browser, otra región, curl)
   - Revisar Cloud Monitoring dashboards en `booster-ai` prod
   - Chequear si Cloud Status muestra outages de GCP
2. **Clasificar severidad** (tabla arriba)
3. **Crear el incidente formal**:
   - Abrir issue `INC-YYYY-MM-DD-<slug>` en GitHub
   - Crear canal dedicado en Slack/Discord si SEV-1 o SEV-2
   - Registrar `started_at`, `detected_by`, `severity`, `symptom`

### Fase 2 — ESTABILIZAR (siguiente 15-60 minutos)

**Objetivo: parar el dolor, no entender el porqué.**

1. **Evaluar rollback inmediato**:
   - Si hay un deploy reciente (<2h) → rollback primero, investigar después
   - Cloud Run: `gcloud run services update-traffic <service> --to-revisions=<prev-revision>=100`
   - Si es DB migration: evaluar down migration (ver skill `running-db-migration`)
2. **Si rollback no aplica o ya está hecho y persiste**:
   - Feature flags OFF relevantes
   - Rate limiting agresivo si es problema de capacidad
   - Failover manual si aplica (ej. apuntar a Redis replica)
3. **Comunicar al usuario si afecta externamente**:
   - Banner en `apps/web` si puedes actualizarlo rápido
   - Mensaje WhatsApp broadcast a usuarios afectados
   - Status page (si existe)
4. **Cada 15 minutos**: actualizar el issue con estado actual ("aún investigando", "probando X", "parece ser Y")

### Fase 3 — ENTENDER (cuando el sangrado paró)

1. **No hacer cambios irreversibles** sin peer review en este estado
2. **Recolectar evidencia**:
   - Logs de Cloud Logging filtrados por timestamp y severity
   - Traces en Cloud Trace de requests fallidos
   - Métricas con anotación del momento del incidente
   - DB state (queries snapshots si data loss)
3. **Identificar causa probable** con evidencia — no adivinar
4. **Decidir si está estable**:
   - Métricas normales por 30 min consecutivos
   - Sin reportes nuevos de usuarios
   - Rollforward plan si el rollback era temporal
5. **Cerrar el incidente** formalmente:
   - Update al issue: `resolved_at`, `resolution`
   - Comms finales
   - **Programar post-mortem** en los siguientes 5 días hábiles (ver `skills/post-mortem`)

## Anti-rationalizations

| Tentación | Por qué es un error |
|-----------|---------------------|
| "Puedo investigar la causa antes de rollback" | No. El usuario sangra. Primero estabilizar, después entender. |
| "Es SEV-3, no necesita incident process" | El proceso en SEV-3 toma 10 min extra y genera artefacto para post-mortem. Vale la pena. |
| "Skippeo el issue formal porque soy el único on-call" | El artefacto es para que el equipo entero aprenda después. |
| "Resuelvo y no hago post-mortem" | Sin post-mortem el mismo incidente vuelve. |
| "Cambio código crítico sin peer review porque es urgente" | La mayoría de los "fixes urgentes" empeoran el incidente. |

## Red Flags

- Más de 30 min sin update al issue → comunicar
- On-call solo sin backup en SEV-1/SEV-2 → escalar
- "No encuentro la causa, voy a reiniciar todo" → alto riesgo, pide peer antes
- Resolviendo con commit directo a main sin review → sospechoso

## Techniques

### Query rápida de errores en Cloud Logging

```
resource.type="cloud_run_revision"
resource.labels.service_name="<service>"
severity>=ERROR
timestamp>="<5 min antes>"
```

### Rollback en Cloud Run en 30 segundos

```bash
# ver revisiones
gcloud run revisions list --service=<service> --region=<region>

# apuntar 100% a la anterior
gcloud run services update-traffic <service> \
  --to-revisions=<prev-revision>=100 \
  --region=<region>
```

### Feature flag OFF

- Si usamos feature flags con Firestore — actualizar doc directamente desde Console
- Si usamos GrowthBook/LaunchDarkly — UI de management

### Auditoría de seguridad post-incidente

Si el incidente involucró brecha de seguridad (SEV-1):
- Rotar TODOS los secrets relacionados (ver skill `rotate-credential`)
- Revisar Cloud Audit Logs por actividad anómala
- Notificar a usuarios afectados dentro de 72h (Ley 19.628)

## Exit Criteria

- [ ] Issue `INC-YYYY-MM-DD-<slug>` creado con todos los campos
- [ ] Severidad clasificada correctamente
- [ ] Evidencia recolectada antes de cerrar
- [ ] Servicio estabilizado — métricas normales 30 min consecutivos
- [ ] Comms finales enviadas
- [ ] Post-mortem programado si SEV-1, SEV-2, o cualquier incidente con lecciones
- [ ] Si hubo brecha de seguridad: rotación de secrets + notificación 72h si aplica

## Referencias

- Severity guide (Google SRE): https://sre.google/sre-book/managing-incidents/
- Skill relacionado: `skills/post-mortem/SKILL.md`
- Skill relacionado: `skills/rotate-credential/SKILL.md`
- Ley 19.628 Chile (notificación brechas): https://bcn.cl/2fsho
