---
description: Checklist pre-deploy y merge a main
---

# /ship — Pre-deploy y merge

Último paso antes de merge a main. Verifica que todo está listo para producción.

## Proceso

1. **Verificar CI green** completo en el último push.
2. **Smoke tests** en ambiente de preview si existe (Cloud Run Preview revision).
3. **Checklist de seguridad**:
   - Sin secretos en código
   - Sin API keys nuevas sin restricciones en GCP
   - Sin dependencias nuevas sin audit (`npm audit`)
4. **Checklist de observabilidad**:
   - Logs estructurados en endpoints nuevos
   - Métricas custom definidas si hay nueva operación de negocio
   - Alertas configuradas si el cambio introduce SLO nuevo
5. **Checklist de rollback**:
   - ¿Cómo revierto este cambio si algo se rompe en producción?
   - Si involucra migración de BD: ¿hay down migration probada?
   - Si involucra feature flag: ¿está OFF por default?
6. **Merge a main** con squash (mantener historial limpio).
7. **Verificar deploy automático** a staging via Cloud Build.
8. **Smoke test en staging** (curl health + flujo manual si UI).
9. **Promoción a prod** (manual approval en Cloud Build).
10. **Monitorear las primeras 2 horas** post-deploy:
    - Error rate no sube
    - Latency P95 no sube
    - Logs limpios de errores nuevos
11. **Actualizar spec con evidencia de ship**: fecha, SHA, revision ID de Cloud Run.

## Anti-rationalizations

| Tentación | Por qué es un error |
|-----------|---------------------|
| "Es viernes pero lo mergeo igual" | Los despliegues viernes sin on-call son la causa #1 de incidentes de fin de semana. |
| "Es una feature pequeña, no necesita monitoreo" | Las pequeñas se olvidan y luego algo cambia aguas abajo. |
| "Skippeo el rollback plan" | El 5% de los deploys falla. El plan de rollback es lo único que hace que no sea una crisis. |

## Exit criteria

- [ ] CI green
- [ ] Smoke tests en staging pasan
- [ ] Rollback plan documentado
- [ ] Logs + métricas + alertas verificadas
- [ ] 2 horas post-deploy sin incidentes
- [ ] Spec actualizada con evidencia de ship
