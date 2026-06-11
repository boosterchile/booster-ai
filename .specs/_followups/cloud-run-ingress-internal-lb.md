# Follow-up: restringir ingress de Cloud Run a internal-and-cloud-load-balancing

**Origen**: REVIEW security de la ola 2 (2026-06-11), hallazgo ALTO sobre fix/xff-trust-boundary.
**Prioridad**: P1 (infra, archivo crítico — PR revisado por el PO).

## Problema

`infrastructure/modules/cloud-run-service/main.tf` no setea `ingress` → default `INGRESS_TRAFFIC_ALL`: las URLs `*.run.app` son alcanzables DIRECTO desde internet, salteando GCLB y Cloud Armor (el comentario de compute.tf:87-89 lo admite). Consecuencias: (1) por ese camino el atacante controla el `X-Forwarded-For` completo salvo la última entry — la regla "penúltima" de `client-ip.ts` vuelve a ser forjable (rate-limits per-IP y la IP de evidencia de consentimiento Ley 19.628); (2) cero WAF en ese camino; (3) el comentario de networking.tf:696 afirma un default de ingress que no es el real.

## Acción propuesta

- `ingress = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"` en el módulo cloud-run-service (parametrizable por servicio si alguno necesita ALL).
- Verificar que los callers internos (whatsapp-bot→api OIDC, Cloud Scheduler→api) siguen funcionando — ambos van por la URL run.app interna: scheduler y service-to-service cuentan como tráfico interno del proyecto (validar en un servicio no crítico primero).
- Corregir el comentario erróneo de networking.tf:696.
- Smoke post-apply: curl directo a la URL run.app desde fuera → debe rechazar; tráfico vía api.boosterchile.com → OK.

## Estado

Pendiente. Sin asignar a ciclo (requiere validación cuidadosa de los callers internos).
