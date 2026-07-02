# Follow-up: bug REPO_ROOT en deploy-telemetry-gateway.sh + banner post-ADR-059

**Origen**: Auditoría 2026-06-09 (seguimiento "Tooling operacional"), riesgo bajo.
**Prioridad**: P3 (fix de 1 línea; el path de update funciona).

## Problema

1. `scripts/deploy-telemetry-gateway.sh:62`: `REPO_ROOT="$(git rev-parse --show-toplevel ...)/.."` apunta al PADRE del repo, por lo que el branch de PRIMER deploy (`kubectl apply -f ${REPO_ROOT}/infrastructure/k8s/telemetry-tcp-gateway.yaml`) referencia un archivo inexistente. Solo funciona el branch de update (`kubectl set image`).
2. El header del script (líneas 2-16) justifica el deploy manual por "VPC peering no transitivo", pero ADR-059 (2026-06-06) resolvió el acceso vía DNS endpoint + pipelines `cloudbuild-primary-{deploy,check}.yaml` y declara "deprecar el deploy manual kubectl desde laptop". El script no tiene banner de deprecación.

## Acción propuesta

- Fix de 1 línea: quitar el `/..` de REPO_ROOT.
- Agregar banner: "DEPRECADO POST-ADR-059 — usar cloudbuild-primary-deploy.yaml; este script queda como vía de emergencia" (o eliminarlo si los pipelines ADR-059 ya están validados end-to-end — verificar con el PO).

## Estado

✅ **RESUELTO** (verificado en `main`, 2026-06-22).

1. El bug `REPO_ROOT` está corregido: `scripts/deploy-telemetry-gateway.sh:73` usa
   `git rev-parse --show-toplevel` directo (sin el `/..` que apuntaba al padre);
   el branch de primer deploy ya referencia el manifiesto correcto.
2. El banner de deprecación ya existe (`deploy-telemetry-gateway.sh:3-9`): apunta a
   los pipelines `cloudbuild-primary-{deploy,check}.yaml` (ADR-059/ADR-065) como vía
   canónica y deja este script como **break-glass** manual. Consistente con P0-I
   (deploy GKE automatizado).
