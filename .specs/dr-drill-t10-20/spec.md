# Spec — Preparación del drill de DR (T10-20)

Programa TRL 10, fase C ([ADR-082](../../docs/adr/082-objetivo-trl10-supersede-precomercial.md) §3, `.specs/trl10/spec.md`).
Decisión del PO (2026-10-08): el agente prepara; la ejecución necesita credenciales
GCP con `roles/cloudsql.admin`, que esta sesión no tiene.

## Entradas

- Cloud SQL `booster-ai-pg-*` (POSTGRES_16, ZONAL) con PITR (7 días de logs) y
  30 backups automáticos; sin `backup_configuration.location` explícita.
- Objetivos: A (datos) RTO ≤ 1 h / RPO ≤ 5 min; B (región) RTO ≤ 8 h / RPO ≤ 24 h.

## Salidas

- `infrastructure/scripts/dr-drill.sh`: corrida en seco por defecto; `--execute`
  clona por PITR (A) y restaura el último backup en otra región (B) sobre
  instancias `dr-drill-*`, cronometra, calcula RPO y escribe
  `docs/runbooks/dr-drill-<fecha>.md`. Guarda dura: aborta cualquier escritura
  que no nombre una instancia `dr-drill-`. `--solo-limpieza` borra sin relanzar.
- `docs/runbooks/dr-drill.md`: lista de verificación ADR-076, ejecución,
  verificación de datos por bastión, reconstrucción Terraform de B, cierre.

## Criterios de éxito

- [x] `shellcheck` limpio; `bash -n` ok.
- [x] Corrida contra un `gcloud` simulado: seco imprime los 6 comandos de
      escritura y ninguno se ejecuta; `--execute` produce el reporte con la tabla
      A/B; `--solo-limpieza` no crea ni restaura nada.
- [ ] Drill real ejecutado por el PO (o con credenciales provistas) y reporte
      `dr-drill-YYYY-MM-DD.md` con los cuatro objetivos medidos → recién ahí
      T10-20 se marca cumplido.
