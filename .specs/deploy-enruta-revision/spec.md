# Spec: deploy-enruta-revision

- **Author**: agente (Claude), por encargo del PO
- **Date**: 2026-11-10
- **Status**: Aceptada por el PO en el chat del 2026-11-10 («Sí, prepáralo»)

## 1. Problema

El release del 2026-11-10 (`c6f113d8`, run 42793648945) terminó en verde y
solo el api quedó sirviendo la versión nueva. Los otros siete servicios de
Cloud Run (web, whatsapp-bot, notification-service, matching-engine,
document-service, telemetry-processor, sms-fallback-gateway) siguieron en la
revisión anterior hasta que el PO movió el tráfico a mano.

Causa: esos servicios tenían el tráfico fijado a una revisión, y sus pasos
`deploy-*` solo ejecutan `gcloud run services update --image`, que crea la
revisión y no mueve tráfico fijado. El tráfico queda fijado después de
cualquier `update-traffic --to-revisions`, que es el comando de rollback.

## 2. Regla

Cada paso `deploy-*` de esos siete servicios, después de crear la revisión:

1. toma la última revisión creada del servicio;
2. comprueba que su imagen es la del commit del release; si no, falla sin
   mover tráfico. Cloud Run guarda la imagen de la revisión resuelta a su
   digest (`<repositorio>@sha256:…`), así que el paso recibe la imagen del
   commit con su tag (`${_REGISTRY}/<servicio>:${_COMMIT_SHA}`, la misma del
   `--image`), resuelve su digest en Artifact Registry y acepta la revisión
   solo si corre `<repositorio>@<ese digest>` o el tag mismo. Si Artifact
   Registry no devuelve un digest, falla sin mover tráfico;
3. enruta el 100% a esa revisión, nombrada (`--to-revisions`), no `--to-latest`;
4. comprueba que el servicio sirve esa revisión; si no, falla.

Un fallo en cualquiera de los cuatro corta el build.

No cambia `deploy-canary`, `route-canary`, `canary-verify`, `deploy-api`,
`gke-deploy` ni el smoke. No cambia ningún flag de los `services update`.

## 3. Criterios de éxito

1. Tests de `scripts/deploy/route_to_commit_revision.sh` con un gcloud falso:
   enruta a la revisión del commit con `--to-revisions`, tanto si la revisión
   informa la imagen por digest (como la informa Cloud Run) como por tag;
   falla sin mover tráfico si la revisión es de otro commit, de otro
   repositorio o no existe, o si Artifact Registry no da el digest; falla si
   `update-traffic` falla o si el servicio sirve otra revisión; exige la
   imagen del commit como cuarto argumento y que su tag sea el commit.
2. `cloudbuild.production.yaml` sigue siendo YAML válido y los siete pasos
   conservan su `id`, su imagen fijada, sus flags y su `waitFor`.
3. En el siguiente release, los ocho servicios sirven la imagen del commit
   sin intervención manual. Se verifica en ese release, no antes.

## 4. Registro de decisiones

- 2026-11-11 — El release 42888289445 (`b9f40f3a`) falló en `deploy-web`: la
  revisión `booster-ai-web-00419-4bt` informaba
  `…/containers/web@sha256:177da096…`, el digest del tag `b9f40f3a…` en
  Artifact Registry, y el script esperaba el tag. La comparación pasa a ser
  por digest, como ya la hacía `deploy-canary` del api. El paso recibe la
  imagen como argumento en vez de leerla de la plantilla del servicio, para
  comparar contra lo que el release subió y no contra lo que el servicio dice
  tener. El PO pidió el arreglo en el chat del 2026-11-11 («merge y deploy»).

## 5. Fuera de alcance

- Que el smoke final compare revisión servida y commit en los ocho servicios.
- El aviso crítico de arranque de `sms-fallback-gateway` sobre sus variables.
