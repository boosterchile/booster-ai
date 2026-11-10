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
# Uso: route_to_commit_revision.sh <servicio> <region> <commit_sha>
set -euo pipefail

if [ "$#" -ne 3 ]; then
  echo "uso: $0 <servicio> <region> <commit_sha>" >&2
  exit 64
fi

SERVICE="$1"
REGION="$2"
COMMIT_SHA="$3"

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
case "$IMAGE" in
  *":$COMMIT_SHA") ;;
  *)
    echo "route: $SERVICE: la revisión $REVISION corre $IMAGE, no la imagen del commit $COMMIT_SHA" >&2
    exit 1
    ;;
esac

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
