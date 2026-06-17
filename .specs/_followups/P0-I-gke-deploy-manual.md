# P0-I — Deploy del telemetry-tcp-gateway (GKE) es manual

> ✅ **RESUELTO (2026-06-16)** — [ADR-065](../../docs/adr/065-automate-gke-gateway-deploy-via-dns-endpoint.md). Se automatizó el deploy (Opción B, no el gate de la Opción A): el step `gke-deploy` de `cloudbuild.production.yaml` hace `kubectl set image` + `rollout status` vía DNS endpoint (ADR-059), gateado por IAM (SA `github-deployer` con `roles/container.developer`, ambos validados live). Corre tras `deploy-api` (API a salvo al 100%) y falla-ruidoso si el rollout no converge → fin del drift silencioso. Validación de reachability del worker pool → DNS endpoint pendiente del primer release real (residual documentado en el ADR; break-glass = script manual).

**Dimensión**: sre · **Esfuerzo**: M (gate corto plazo) / L (VPC largo plazo)
**Fuente**: audit 2026-06-14

## Problema
`cloudbuild.production.yaml`, step `gke-deploy-instructions`: imprime instrucciones por stdout en vez de ejecutar `kubectl set image` (limitación de conectividad VPC peering hacia el cluster GKE Autopilot privado). No hay rollback automatizado ni gate de verificación post-deploy del gateway.

## Impacto
Deploy parcial: en cada release, el tcp-gateway queda en la versión anterior hasta que un operador corra el script manualmente. Los devices Teltonika hablan con código desactualizado sin alerta. Riesgo en el camino crítico de telemetría.

## Plan de pago
Corto plazo: gate en el pipeline que verifique que la imagen corriendo en GKE == `_COMMIT_SHA` esperado, y falle el release si no coincide.
Largo plazo: resolver conectividad VPC privada para que Cloud Build pueda ejecutar `kubectl set image` directamente (o usar Cloud Deploy / GKE Gateway).
Probable ADR (cambio en el pipeline de release).

## NO ejecutar ahora
Toca el pipeline de release (archivo crítico). Requiere diseño + PR revisado. Diagnóstico.
