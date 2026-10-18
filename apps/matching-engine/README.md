# @booster-ai/matching-engine

**Runtime**: `cloud-run`
**Status**: ranking de matching extraído (T10-21)

`POST /ranking`: ranking (scoring v1/v2 + top-N) de los candidatos de un viaje, con `@booster-ai/matching-algorithm`.
El contrato es `solicitudRankingSchema` / `respuestaRankingSchema` de `@booster-ai/shared-schemas`.

- **Cómputo puro.** Sin base de datos ni secretos: el api arma la solicitud con sus queries y persiste las offers.
- **Auth.** Cloud Run IAM (`run.invoker`) más verificación del ID token del SA del api.
- **Modo.** Lo eligen los flags `MATCHING_SHADOW` y `MATCHING_VIA_MICROSERVICE` del api.

Spec: `.specs/matching-engine-t10-21/spec.md`. Runbook: `docs/runbooks/service-matching-engine.md`.
