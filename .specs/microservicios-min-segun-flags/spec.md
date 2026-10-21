# Spec: microservicios-min-segun-flags

- Author: Felipe Vicencio (con Claude)
- Date: 2026-10-21
- Status: Draft — el PO pidió preparar el PR (2026-10-21); se aprueba con la revisión del PR
- Origen: auditoría de costos GCP del 2026-10-21 (`.specs/recorte-logs-gke-cert-manager/verify.md` en el PR #821 tiene la línea base de costo).
- Relacionado: ADR-083 (extracción con shadow en prod), T10-21 (`.specs/notification-service-t10-21/`, `.specs/matching-engine-t10-21/`), runbooks `service-notification-service.md` y `service-matching-engine.md`.
- El `terraform apply` lo ejecuta el PO. Este PR no aplica nada.

## 1. Objective

Que `matching-engine` y `notification-service` no paguen una instancia mínima mientras sus flags estén apagados, sin que se pueda encender un flag con el servicio en cero.

Hoy los dos corren con `min_instances=1` y nadie los usa:

| Servicio | Costo | Uso en 30 días | Por qué nadie lo usa |
|---|---|---|---|
| `notification-service` (1 vCPU, CPU siempre asignada) | ~USD 45–60/mes desde el 2026-10-19 | 0 mensajes en `notification-events`, 0 requests | `NOTIFICATIONS_SHADOW` y `NOTIFICATIONS_VIA_MICROSERVICE` en `false` → modo `directo` (`apps/api/src/services/whatsapp-enrutado.ts`): el api envía por Twilio y no publica |
| `matching-engine` (1 vCPU, CPU solo en requests) | ~USD 11/mes desde el 2026-10-19 | 0 requests | `MATCHING_SHADOW` y `MATCHING_VIA_MICROSERVICE` en `false` → modo `local` (`apps/api/src/services/matching-ranking.ts`): el api rankea en proceso. Además, el egress del api todavía no llega al servicio (`matching-engine.tf`) |

## 2. Why now

El gasto está en ~USD 650–690/mes y estos dos servicios suman ~USD 56–71/mes sin trabajo. ADR-083 deja la extracción en la fase previa al shadow; el shadow se enciende con un `terraform apply` de los flags, que es justo cuando el servicio debe estar arriba.

## 3. Success criteria

- [ ] SC-1: `module.service_matching_engine.min_instances = (var.matching_shadow || var.matching_via_microservice) ? 1 : 0`.
- [ ] SC-2: `module.service_notification.min_instances = (var.notifications_shadow || var.notifications_via_microservice) ? 1 : 0`. `cpu_idle = false` no cambia.
- [ ] SC-3: `cloudbuild.production.yaml` deja de fijar `--min-instances=1` en `deploy-notification-service` y `deploy-matching-engine` (si no, el siguiente release lo devolvería a 1). `gcloud run services update` conserva el valor vivo cuando no se le pasa.
- [ ] SC-4: con los flags en `false`, `terraform plan` sobre esta rama muestra en esos dos servicios solo `template.scaling.min_instance_count: 1 → 0`, salvo drift previo ajeno a este PR (que se documenta).
- [ ] SC-5: con un flag en `true`, el mínimo calculado es 1 (verificado con `terraform console` sobre la expresión).
- [ ] SC-6 (PO, después del apply): los dos servicios escalan a cero; en 48 h su costo diario en el export por recurso baja a ~0.
- [ ] SC-7: este PR no ejecuta `terraform apply`, `gcloud run services update` ni ningún deploy.

## 4. User-visible behaviour

Ninguno. Con los flags apagados ningún usuario pasa por estos servicios.

## 5. Out of scope

- `document-service` (~USD 63/mes): es consumidor pull de `document.uploaded`, que el api publica en cada subida de documento aunque no haya flag. Con `min=0` el primer documento quedaría sin procesar. La salida limpia es una suscripción push y pide un ADR.
- `telemetry-processor`: tiene trabajo real.
- Cambiar `--no-cpu-throttling` del deploy de notification-service: sigue siendo obligatorio cuando el flag esté encendido.
- Las alertas de suscripción «estancada» que atribuyen `telemetry-events-security-p1-notification-sub` a notification-service y `telemetry-events-eco-score-matching-sub` a matching-engine (`telemetry-monitoring.tf`): ninguno de los dos consume esas suscripciones en el código. Es una inconsistencia previa que este PR no toca.

## 6. Constraints

1. ADR-083 y T10-21: con un flag encendido, notification-service necesita `min_instances=1` + `cpu_idle=false` (consumidor pull, incidente 2026-06-07). La regla se mantiene: el mínimo se deriva del flag.
2. Los runbooks encienden y apagan los flags con `terraform apply -var=…`. Si alguien encendiera un flag por fuera de Terraform (`gcloud run services update --update-env-vars` sobre el api), el mínimo no subiría. Eso ya es drift que detecta `terraform-drift.yml`; se deja escrito en los runbooks.
3. `min_instances` está en el `template` del módulo `cloud-run-service`: el apply crea una revisión nueva de cada servicio con la imagen viva (`template[0].containers[0].image` está en `ignore_changes`).

## 7. Approach

- `infrastructure/compute.tf`: `min_instances` derivado de los flags en los dos módulos, con el porqué en el comentario.
- `cloudbuild.production.yaml`: quitar `--min-instances=1` de los dos pasos de deploy y explicar que lo maneja Terraform.
- Runbooks de los dos servicios: una nota de que el mínimo sigue a los flags.

## 8. Alternatives considered

- **A. Solo bajar `min_instances` a 0 en Terraform** — Rechazada: el siguiente release lo vuelve a 1 (el deploy fija `--min-instances=1`), y nada impediría encender un flag con el servicio en cero.
- **B. Pasar notification-service a suscripción push** — Rechazada aquí: es el camino para document-service, pero cambia el modelo del consumidor y pide un ADR. Con los flags apagados no hace falta.
- **C. Bajar max/CPU en vez del mínimo** — Rechazada: el costo es la instancia mínima ociosa, no el tamaño.

## 9. Risks and mitigations

| Riesgo | Prob. | Impacto | Mitigación |
|---|---|---|---|
| Se enciende un flag por fuera de Terraform y notification-service queda en cero | B | A | Los runbooks usan `terraform apply`; nota nueva en ambos. El drift lo marca `terraform-drift.yml` (diario). En modo sombra no hay impacto: el api sigue enviando directo |
| Alguien publica en `notification-events` con el servicio en cero | MB | M | El único publicador es el api, y solo con un flag encendido (código + 0 mensajes en 30 días). La suscripción retiene 1 día: los mensajes esperan al consumidor |
| Primer request a matching-engine con arranque en frío cuando se encienda la sombra | B | B | El mismo apply sube el mínimo a 1. En sombra la llamada es fire-and-forget; en modo microservicio el timeout de 3 s cae al ranking local |
| El apply muestra drift previo en esos módulos | M | B | Plan con `-target` a los dos módulos y revisar que solo cambie `min_instance_count` (SC-4) |

## 10. Rollout (PO)

1. Mergear. El release que sale del merge ya no fija `--min-instances`, y los servicios conservan su `min=1` vivo hasta el apply.
2. `terraform plan -target=module.service_matching_engine -target=module.service_notification`: revisar que en ambos solo cambie `min_instance_count: 1 → 0`. Luego, apply.
3. A las 48 h, revisar SC-6.
