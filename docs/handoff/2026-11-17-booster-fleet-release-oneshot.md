# One-shot — Booster Fleet en producción

**Fecha**: 2026-11-17 · America/Santiago  
**Foco**: dejar disponible Booster Fleet (combustible, documentos, mantenciones) para el dueño del transportista.  
**Quién dispara release / gate**: **PO**.  
**Quién no**: Cursor — no `gh workflow run release.yml`, no aprueba `production` (token sin `actions:write`).

## 1. Qué hay que desplegar

| PR | Rama | Qué trae |
|---|---|---|
| [#1002](https://github.com/boosterchile/booster-ai/pull/1002) | `cursor/booster-fleet-2940` | Booster Fleet: panel `/app/booster-fleet`, API `/booster-fleet`, migración **0086** `mantenciones_vehiculo`, rename comercial |

Spec: `.specs/booster-fleet/spec.md`.  
Servicio: `gestion_de_flota` (ADR-079). La tarifa no cambia. La pantalla **no** depende de `gestion_flota_activada_en`; esa bandera solo cobra.

Migración **0086** = expand-only (`CREATE TABLE mantenciones_vehiculo` + índices + checks). Down en `apps/api/drizzle/down/0086_booster_fleet_mantenciones.down.sql`. Se aplica al startup del api.

## 2. Lista en seco — ADR-076 (0086)

Corrida en seco 2026-11-17 (America/Santiago), antes del merge:

1. Tipo: expand-only. No reescribe tablas ni toca filas.
2. Compatibilidad hacia atrás: el código viejo ignora la tabla; el nuevo la necesita solo para mantenciones.
3. Aplicación: `apps/api/src/db/migrator.ts` al arrancar la revisión nueva (advisory lock).
4. Rollback de código: camino A del runbook (`docs/runbooks/db-migration-rollback.md`) si el CREATE ya corrió.
5. No es migración `contract` ni toca datos existentes → no exige visto aparte del gate de production.

## 3. Release canónico (PO)

Cuando #1002 esté en `main` y el tip de `main` sea el squash de Booster Fleet (o tip solo-docs encima):

```bash
gh workflow run release.yml --ref main
# Aprobar Environment production.
# Un solo run; no duplicar mientras hay canary.
```

Checklist gate:

- [ ] Run Release + Deploy sobre `main` con Booster Fleet.
- [ ] Environment **production** aprobado por el PO.
- [ ] Canary api → 100 %; web verde.
- [ ] Migración **0086** aplicada (87 migraciones en total si 0085 ya estaba).

## 4. Confirmación post-deploy

### 4.1 Revisiones + health

```bash
gcloud run services describe booster-ai-api \
  --project=booster-ai-494222 --region=southamerica-west1 \
  --format='value(status.latestReadyRevisionName)'
gcloud run services describe booster-ai-web \
  --project=booster-ai-494222 --region=southamerica-west1 \
  --format='value(status.latestReadyRevisionName)'

curl -sS https://api.boosterchile.com/health
curl -sS https://api.boosterchile.com/ready
# Sin sesión debe ser 401 (ruta montada), no 404.
curl -sS -o /dev/null -w 'booster-fleet=%{http_code}\n' https://api.boosterchile.com/booster-fleet
curl -sS -o /dev/null -w 'web=%{http_code}\n' https://app.boosterchile.com/app/booster-fleet
```

### 4.2 Migración 0086

```sql
SELECT to_regclass('public.mantenciones_vehiculo');
-- mantenciones_vehiculo

SELECT indexname FROM pg_indexes
WHERE tablename = 'mantenciones_vehiculo'
ORDER BY 1;
-- idx_mantenciones_empresa_fecha, idx_mantenciones_vehiculo

SELECT COUNT(*) FROM drizzle.__drizzle_migrations;
-- 87 si 0085 ya estaba (86 → 87)
```

### 4.3 Smoke con sesión dueño/admin transportista

1. Menú Transporte muestra **Booster Fleet** antes de Seguimiento de flota.
2. `/app/booster-fleet` lista combustible (7 días), documentos y mantenciones.
3. Programar una mantención y marcarla realizada.
4. Un despachador no entra (copy de control del dueño / API 403).

## 5. Rollback

- Canary/release: revisión anterior del workflow.
- 0086 expand-only: no dropear la tabla en caliente; el feature se apaga no usando la UI/API.
- Cobro: la bandera `gestion_flota_activada_en` sigue independiente.

## 6. Fuera de este oneshot (sigue fuera de la spec)

Predicción de mantenciones, editar el archivo del documento en esta pantalla, cambiar la tarifa o el segmentador de combustible.

## 7. Después del release

1. Actualizar `docs/handoff/CURRENT.md` (tip prod, 0086, Booster Fleet en prod).
2. Cerrar el frente fuera de slot en `docs/frentes-vivos.md` cuando el smoke §4 pase.
