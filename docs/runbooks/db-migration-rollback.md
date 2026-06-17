# Runbook — Rollback de migraciones de base de datos

Qué hacer cuando un deploy aplicó una migración Drizzle que hay que revertir o
contener. Decisión + procedimientos. Base conceptual: [ADR-066](../adr/066-db-migration-rollback-strategy.md).

## ⚠️ Lo primero que tenés que entender

Las migraciones se aplican **al startup del servicio** (`apps/api/src/db/migrator.ts`,
forward-only). Por lo tanto:

> **Revertir la revisión de Cloud Run NO revierte el esquema.**

Si hacés rollback del código a la revisión anterior, esa revisión vieja arranca
contra el esquema **ya migrado**. Si la migración fue backward-compatible
(convención expand/contract, ADR-066), eso es seguro. Si no lo fue, el código
viejo puede romper. Por eso el árbol de decisión de abajo empieza por esa pregunta.

---

## Árbol de decisión

```
¿Qué pasó?
│
├─ El deploy nuevo falla / hay que volver atrás, pero la migración era ADITIVA
│  (ADD COLUMN nullable, CREATE TABLE/INDEX) → backward-compatible
│     → CAMINO A: rollback de código. Listo. El esquema nuevo soporta al código viejo.
│
├─ La migración metió datos/estado malos pero la BD está sana y querés
│  preservar los datos
│     → CAMINO B: forward-fix (migración correctiva nueva). PREFERIDO.
│
└─ DDL destructivo/corrupción/drop accidental con pérdida de datos
      → CAMINO C: PITR clone a un punto previo al deploy. Último recurso.
```

---

## CAMINO A — Rollback de código (migración backward-compatible)

El caso común y seguro. La migración era aditiva, así que el esquema nuevo sigue
soportando la revisión anterior.

1. Identificá la revisión sana anterior:
   ```
   gcloud run revisions list --service=booster-ai-api --region=southamerica-west1
   ```
2. Mové el 100% del tráfico a esa revisión:
   ```
   gcloud run services update-traffic booster-ai-api \
     --region=southamerica-west1 --to-revisions=<REVISION_SANA>=100
   ```
3. Verificá `/health` + un flujo real. No hace falta tocar la BD.

> Si la migración NO era backward-compatible, **no uses el Camino A** — saltá a B o C.
> (El guard `migration-safety` en CI existe justamente para que esto casi nunca pase.)

---

## CAMINO B — Forward-fix (preferido cuando hay que arreglar datos/esquema)

En vez de "deshacer", se avanza con una migración correctiva. Preserva datos y
mantiene el historial lineal que Drizzle espera.

1. Escribí una migración nueva que corrige el problema (otra columna, un backfill,
   un `ADD CONSTRAINT ... NOT VALID` + `VALIDATE`, etc.), respetando expand/contract.
2. Si el problema es una columna recién agregada que está mal: **no la dropees en
   el mismo deploy** (rompería el Camino A futuro). Dejala sin uso o corregila aditivamente;
   el drop va como fase contract en un deploy posterior (`-- contract-phase: <ref>`).
3. Deploy normal vía `release.yml` (gate de prod + canary).

---

## CAMINO C — PITR clone (emergencia: corrupción / pérdida de datos)

El undo real de un DDL catastrófico. Cloud SQL tiene PITR habilitado
(`point_in_time_recovery_enabled = true`, 7 días de transaction logs —
`infrastructure/data.tf`). **No se restaura sobre la instancia viva**: se **clona**
a un instante previo al deploy para inspeccionar/promover sin destruir evidencia.

1. Identificá el timestamp **justo antes** del deploy malo (de los logs del release
   o de `gcloud sql operations list`). Usá RFC3339 UTC.
2. Obtené el nombre de la instancia (tiene sufijo aleatorio):
   ```
   gcloud sql instances list --project=booster-ai-494222
   # → booster-ai-pg-<suffix>
   ```
3. Cloná a ese punto en el tiempo (instancia nueva, no toca la productiva):
   ```
   gcloud sql instances clone booster-ai-pg-<suffix> booster-ai-pg-restore-<fecha> \
     --point-in-time='2026-06-17T16:55:00Z' --project=booster-ai-494222
   ```
4. Verificá en el clon que el esquema/datos están sanos (conectá el bastion al clon).
5. **Decisión de promoción** (humana, con el PO): apuntar la app al clon implica un
   cambio de `DATABASE_URL` (Secret Manager) + redeploy, o un swap de IP privada.
   Coordinar ventana — es disruptivo. Documentar en `docs/handoff/CURRENT.md`.
6. Hasta promover, podés operar en modo lectura/degradado según el incidente
   (ver `incident-response`).

> PITR clona a la última operación si no pasás `--point-in-time`. Siempre pasá el
> timestamp explícito previo al deploy.

---

## Reverse-SQL manual (último recurso, reversión limpia y data-safe)

Solo para casos donde un DDL es reversible **sin pérdida de datos** y B/C no aplican
(p.ej. un `CREATE INDEX` que hay que sacar). **El auto-migrator NO aplica esto** —
es manual, vía bastion.

1. Escribí el reverse en `apps/api/drizzle/down/NNNN_name.down.sql` (mismo número que
   la migración a revertir; ver `apps/api/drizzle/down/_TEMPLATE.down.sql`).
2. Aplicalo a mano vía bastion en modo password (DDL):
   ```
   AUTH_MODE=password bash scripts/db/connect.sh -f apps/api/drizzle/down/NNNN_name.down.sql
   ```
3. ⚠️ Esto **no** actualiza `drizzle.__drizzle_migrations`. Si dejás la migración
   forward en el repo, el próximo startup la re-aplicará. Solo usar como parche puente
   mientras se prepara el forward-fix (Camino B) o se decide PITR (Camino C).

---

## Después de cualquier rollback

- Anotá el incidente y la decisión en `docs/handoff/CURRENT.md`.
- Si la causa fue una migración destructiva que pasó el guard: revisá por qué
  (¿llevaba un `-- contract-phase:` que no correspondía?) y ajustá ADR-066 / el guard.
- Si fue PITR: no borres el clon hasta confirmar que la app productiva está sana.
