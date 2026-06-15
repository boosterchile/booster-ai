# P0-I — Deploy del telemetry-tcp-gateway (GKE) es manual

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
