# Spec — `matching-engine`: extracción del ranking de candidatos (T10-21, servicio 3 de 3)

**Programa**: TRL 10, fase D. Criterio T10-21 de `.specs/trl10/spec.md`.
**Patrón**: [ADR-083](../../docs/adr/083-staging-gemelo-y-extraccion-con-shadow.md) §2 y `.specs/microservicios-t10-21/spec.md` §4.
**Estado**: aceptada por el PO el 2026-10-08 ("sigue con matching-engine"; "necesito que las soluciones queden listas para producción", sin deuda).

## Restricción que fija el diseño

`POST /trip-requests` (`routes/trip-requests-v2.ts`) responde **en la misma request** con el resultado del matching (`status`, `offers_created`, `offer_ids`). Ese contrato es público (PWA y bot), así que el matching no puede pasar a asíncrono sin cambiarlo. La extracción tiene que ser **síncrona**: el api le pide el ranking al servicio dentro del flujo de la request.

## Qué se extrae

`runMatching` orquesta en una transacción la carga del viaje, los candidatos (zonas, empresas, vehículos, lookups v2), el **ranking**, el insert de offers y las transiciones de estado. El ranking (scoring v1/v2 + top-N con desempate determinista) es la decisión del algoritmo, y es lo que pasa a `matching-engine`. Las queries y la persistencia se quedan en el api. Es el mismo corte que en `notification-service`: el api decide con sus datos y el servicio ejecuta.

- **`@booster-ai/matching-algorithm`** gana `rankearCandidatos(solicitud)`, pura, y `hashRanking(top)`. Consolida las ramas v1/v2 que hoy están inline en `matching.ts`. La usan el api (modo directo y fallback) y el servicio, así que hay una sola implementación.
- **Contrato** en `@booster-ai/shared-schemas`: `solicitudRankingSchema` y `respuestaRankingSchema`.
- **`matching-engine`**: Hono, `POST /ranking` y `GET /health`. **Cómputo puro**: sin base de datos, sin Redis, sin secretos.

## Seguridad y red

- **Ingress `INGRESS_TRAFFIC_ALL` + IAM.** Es el patrón estándar de GCP para llamadas servicio a servicio, con `public = false` y `roles/run.invoker` solo para el SA runtime.
  - **Por qué no `INTERNAL_ONLY`.** El api sale por un connector con egress `PRIVATE_RANGES_ONLY` y no hay Cloud NAT. Mantener `INTERNAL_ONLY` exigiría sacar **todo** el egress del api por la VPC con un NAT nuevo, un cambio de red con más riesgo que beneficio.
  - **No contradice ADR-063.** ADR-063 cerró a `INTERNAL_ONLY` los consumers pull porque no tienen llamadores HTTP; este servicio sí tiene uno.
  - **Superficie mínima.** Un token robado solo permite pedir rankings de datos que el propio llamador envía: no hay lectura de datos ni efectos.
- **Defensa en profundidad.** Además de Cloud Run IAM, el servicio verifica el ID token: firma contra Google, `aud` igual a su URL y `email` en `ALLOWED_CALLER_SA`. Es el mismo criterio que `apps/api/src/middleware/auth.ts`.
- **El api obtiene el token** con `GoogleAuth.getIdTokenClient(MATCHING_ENGINE_URL)`, el mismo patrón que el bot hacia el api.

## Modos del api (flags)

| `MATCHING_VIA_MICROSERVICE` | `MATCHING_SHADOW` | Ranking usado para crear offers |
|---|---|---|
| false | false | Local (`rankearCandidatos` en el api) |
| false | true | Local. **Tras el commit**, fire-and-forget: llama al servicio con la misma solicitud y compara `hashRanking`. Loguea `matching sombra coincide` / `diverge` / `error` y no agrega latencia al usuario |
| true | (ignorado) | Remoto, dentro de la transacción, con timeout de 3 s. Si el remoto falla (red, 5xx, timeout, respuesta fuera de contrato), hay **fallback local**: el usuario nunca pierde el matching. El log `error` `matching remoto fallo, fallback local` alimenta una métrica y una alerta |

La config se rechaza al arrancar si un flag está activo sin `MATCHING_ENGINE_URL`.

## Criterios de éxito

- [ ] TDD con rojo exhibido (matching es dominio crítico): `rankearCandidatos` y `hashRanking`, el cliente/enrutador del api y la ruta del servicio.
- [ ] **Paridad.** Los tests existentes de `matching.ts` (unit + integración) pasan sin cambios de expectativa: el refactor a `rankearCandidatos` no altera el comportamiento.
- [ ] Coverage ≥ 80 % en api, matching-engine y matching-algorithm.
- [ ] La imagen se construye y el smoke `/health` responde.
- [ ] `terraform validate` OK, con los flags en `false` por defecto.
- [ ] **Post-merge (PO)**:
  1. `terraform apply` y release.
  2. `matching_shadow = true` por 3 a 7 días, con `matching_shadow_divergencias = 0` y errores de sombra explicados.
  3. Drill en staging (runbook §Drill).
  4. `matching_via_microservice = true`.
  5. Evidencia: `matching ranking remoto` en los logs del api y requests 2xx en Cloud Monitoring del servicio.

## Costo

`min_instances = 1` (sin cold start en el camino síncrono), con `cpu_idle = true` porque es request-driven: del orden de USD 10/mes en idle.
