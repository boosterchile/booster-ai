#!/usr/bin/env bash
# Enruta el 100% del tráfico de un servicio de Cloud Run a la revisión que
# este release acaba de crear, y falla si esa revisión no corre la imagen del
# commit o si el servicio termina sirviendo otra.
#
# Por qué existe: `gcloud run services update --image` crea la revisión pero
# no mueve tráfico cuando el servicio lo tiene fijado a una revisión (queda así
# después de cualquier `update-traffic --to-revisions`, que es como se hace un
# rollback). El release del 2026-11-10 terminó en verde con siete servicios
# sirviendo la revisión anterior.
#
# Se nombra la revisión en vez de usar --to-latest: «latest» es la última
# revisión lista según Cloud Run, que ese día no era la del release.
#
# Cloud Run guarda la imagen de cada revisión resuelta a su digest
# (`<repositorio>@sha256:…`), aunque el deploy la pida por tag. Por eso la
# revisión se compara contra el digest que Artifact Registry da para el tag del
# commit, igual que en `deploy-canary` del api. Comparar contra el tag hizo
# fallar el release de b9f40f3a con la imagen correcta.
#
# Uso: route_to_commit_revision.sh <servicio> <region> <commit_sha> <imagen>
#   <imagen> es la imagen del commit con su tag, la misma del `--image` del
#   deploy: `<registro>/<nombre>:<commit_sha>`.
set -euo pipefail

if [ "$#" -ne 4 ] || [ -z "$3" ]; then
  echo "uso: $0 <servicio> <region> <commit_sha> <registro>/<nombre>:<commit_sha>" >&2
  exit 64
fi

SERVICE="$1"
REGION="$2"
COMMIT_SHA="$3"
IMAGE_REF="$4"

case "$IMAGE_REF" in
  *":$COMMIT_SHA") ;;
  *)
    echo "uso: la imagen '$IMAGE_REF' no lleva el tag del commit $COMMIT_SHA" >&2
    exit 64
    ;;
esac
REPOSITORY="${IMAGE_REF%":$COMMIT_SHA"}"

DIGEST=""
if ! DIGEST="$(gcloud artifacts docker images describe "$IMAGE_REF" \
  --format='value(image_summary.digest)')"; then
  DIGEST=""
fi
if ! [[ "$DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]]; then
  echo "route: $SERVICE: sin digest para $IMAGE_REF en Artifact Registry (respuesta: '$DIGEST')" >&2
  exit 1
fi

REVISION="$(gcloud run services describe "$SERVICE" \
  --region="$REGION" --platform=managed \
  --format='value(status.latestCreatedRevisionName)')"
if [ -z "$REVISION" ]; then
  echo "route: $SERVICE no reporta una última revisión creada" >&2
  exit 1
fi

IMAGE="$(gcloud run revisions describe "$REVISION" \
  --region="$REGION" --platform=managed \
  --format='value(spec.containers[0].image)')"
if [ "$IMAGE" != "$REPOSITORY@$DIGEST" ] && [ "$IMAGE" != "$IMAGE_REF" ]; then
  echo "route: $SERVICE: la revisión $REVISION corre $IMAGE, no la imagen del commit $COMMIT_SHA ($REPOSITORY@$DIGEST)" >&2
  exit 1
fi

gcloud run services update-traffic "$SERVICE" \
  --region="$REGION" --platform=managed \
  --to-revisions="$REVISION=100"

SERVED="$(gcloud run services describe "$SERVICE" \
  --region="$REGION" --platform=managed \
  --format='value(status.traffic[0].revisionName)')"
if [ "$SERVED" != "$REVISION" ]; then
  echo "route: $SERVICE sirve '$SERVED' y debía servir $REVISION" >&2
  exit 1
fi

echo "route: $SERVICE sirve $REVISION ($IMAGE) al 100%"
