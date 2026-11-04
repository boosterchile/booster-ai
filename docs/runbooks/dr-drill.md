# Runbook — Drill de DR por restauración

Procedimiento de T10-20 ([ADR-082](../adr/082-objetivo-trl10-supersede-precomercial.md) §3): restaurar Cloud SQL por PITR y desde backup, reconstruir desde Terraform y medir RTO y RPO reales. El resultado de cada drill queda en `docs/runbooks/dr-drill-YYYY-MM-DD.md`.

| Escenario | Qué simula | Objetivo RTO | Objetivo RPO |
|---|---|---|---|
| **A** | Pérdida o corrupción de datos (borrado accidental, migración mala) | ≤ 1 h | ≤ 5 min |
| **B** | Pérdida de la región `southamerica-west1` | ≤ 8 h | ≤ 24 h |

Si un objetivo no se alcanza, se corrige la infraestructura o se enmienda el objetivo por ADR. No se declara cumplido por estimación (ADR-082 §3).

## Qué toca y qué no

- **Nunca toca la instancia primaria.** El script `infrastructure/scripts/dr-drill.sh` solo lee de ella. Todo comando de escritura apunta a instancias temporales `dr-drill-a-<fecha>` o `dr-drill-b-<fecha>`, y aborta si un comando de escritura no nombra una de esas instancias.
- **Costo**: cada instancia temporal cobra por hora el mismo tier que la primaria mientras exista. Con `--cleanup` se borran al terminar. Sin él quedan para verificar datos y hay que borrarlas a mano.
- **Permisos**: quien ejecuta necesita `roles/cloudsql.admin` sobre el proyecto. La verificación de datos usa el bastión IAP (`module.db_bastion`).

## Lista de verificación previa (ADR-076)

- [ ] Ventana de bajo tráfico elegida y anotada (el drill no afecta a la primaria, pero las instancias nuevas compiten por la cuota del proyecto).
- [ ] La primaria está `RUNNABLE`, con PITR habilitado y al menos un backup automático `SUCCESSFUL`. La corrida en seco lo comprueba.
- [ ] Corrida en seco ejecutada y su salida registrada en el reporte:
      `infrastructure/scripts/dr-drill.sh --cleanup --scenario ab`
- [ ] Revisada la **ubicación del backup** que imprime la corrida en seco. Si el backup está en `southamerica-west1` (regional), el escenario B no sobrevive a la pérdida de la región. Eso es un hallazgo del drill, no un error del script: se registra y se corrige con `backup_configuration.location` multi-región en Terraform (cambio de `data.tf`, lo decide el PO).
- [ ] Región de destino de B confirmada (por defecto `southamerica-east1`; se cambia con `--dr-region`).

## Ejecución

```bash
# desde la raíz del repo, con gcloud autenticado como un principal con cloudsql.admin
infrastructure/scripts/dr-drill.sh --execute --scenario ab
# sin --cleanup: las instancias quedan para la verificación de datos
```

El script cronometra cada escenario, calcula el RPO y escribe `docs/runbooks/dr-drill-<fecha>.md`:

- **RPO A** = hora del inicio − `latestRecoveryTime` de PITR.
- **RPO B** = hora del inicio − fin del último backup automático.
- **RTO de la capa de datos** = desde el inicio del comando hasta que la instancia restaurada queda `RUNNABLE`.

## Verificación de datos

Para cada instancia restaurada, conectarse por el bastión IAP (ver `module.db_bastion` en `infrastructure/data.tf`) y comparar contra la primaria:

```sql
SELECT count(*) AS viajes, max(creado_en) AS ultimo_viaje FROM viajes;
SELECT count(*) AS metricas FROM metricas_viaje;
SELECT max(registrado_en) AS ultimo_evento FROM eventos_viaje;
```

- **A**: los conteos coinciden con la primaria al `latestRecoveryTime`, y el último `registrado_en` de `eventos_viaje` queda a menos de 5 min de esa marca.
- **B**: los datos llegan hasta el fin del backup.

Registrar los resultados en el reporte. Si las tablas cambiaron de nombre, usar las de `apps/api/src/db/schema.ts`.

## Escenario B: reconstrucción desde Terraform

El script mide solo la capa de datos. Para el RTO total de B se cronometra además la reconstrucción del resto del stack (Cloud Run, Pub/Sub, KMS, buckets, red) en la región de destino:

1. `terraform -chdir=infrastructure plan -var region=<dr-region> -out=dr.plan` contra un **state vacío**, en un workspace o backend aparte, nunca el de prod. Anotar el tiempo y la cantidad de recursos.
2. El `apply` de ese plan crea un stack paralelo completo: costo y cuota relevantes. Requiere decisión del PO y un proyecto o workspace separado (relacionado con OQ-1 de `.specs/trl10/spec.md`). Mientras no se autorice, el reporte registra el tiempo del plan y deja el apply como pendiente explícito. **No** se declara cumplido el RTO de B con esa parte pendiente.
3. RTO total de B = RTO de la capa de datos + tiempo de apply + redeploy de imágenes (`gcloud run deploy` desde Artifact Registry) + cambio de DNS.

## Cierre

- [ ] Instancias `dr-drill-*` borradas: `infrastructure/scripts/dr-drill.sh --execute --solo-limpieza --fecha <YYYY-MM-DD del drill>` (no relanza el drill).
- [ ] Reporte completado (verificación de datos, Terraform, hallazgos) y commiteado.
- [ ] Hallazgos que requieren cambios en infra: un PR por cada uno.
- [ ] Si se cumplen los cuatro objetivos, marcar T10-20 en `.specs/trl10/spec.md` con el enlace al reporte.
