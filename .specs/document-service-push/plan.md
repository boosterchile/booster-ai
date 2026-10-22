# Plan: document-service-push

- Spec: .specs/document-service-push/spec.md
- ADR: docs/adr/085-document-service-consumidor-push.md (Aceptado el 2026-10-22)
- Status: Build completo y decisiones del PO registradas (spec §11). Faltan el merge (después del #822), el apply y el PR de encendido (spec §10).

### T1 [DONE]: revalidar la situación con evidencia
Billing export por recurso, Cloud Monitoring (con controles positivos), Cloud Logging, revisiones de Cloud Run, IAM y DLQ en vivo. Todo de solo lectura. Resultados en `verify.md` §1–2.

### T2 [DONE]: verificar el diseño contra la documentación
Ingress interno para Pub/Sub, códigos de ack, ack deadline, OIDC, `audience`, `actAs`, DLQ y seek, y el schema del provider 6.50.0 (`verify.md` §3).

### T3 [DONE]: medir el decode
Tiempo y memoria del ingestor real, en serie y en paralelo. Fija la concurrencia en 4 y confirma el ack de 120 s (`verify.md` §4).

### T4 [DONE]: worker con dos modos
`config.ts`, `handle-document-uploaded.ts`, `http-server.ts`, `push-auth.ts` y `main.ts`, con sus tests. `google-auth-library` como dependencia (ya estaba en el lockfile por matching-engine).

### T5 [DONE]: infra detrás del flag
- `variables.tf`: `document_service_push`.
- `compute.tf`: `service_document`.
- `messaging.tf`: `push_config`, SA e IAM del push y de la DLQ.
- Módulo `cloud-run-service`: `max_instance_request_concurrency` y `custom_audiences`.
- Alertas propias en `document-service.tf`.

### T6 [DONE]: que el deploy no lo deshaga
`cloudbuild.production.yaml`: sin `--min-instances` ni `--no-cpu-throttling` en `deploy-document-service`.

### T7 [DONE]: docs
ADR-085, runbooks (`service-document-service.md`, `README.md`, `rollback-drill-microservicios.md`) y README del worker.

### T8 [DONE]: gates
Tests, cobertura, typecheck, Biome, build, lint-rls, humo local, `terraform fmt`/`validate`, plan acotado con el flag apagado y encendido, y check-adr-numbering (`verify.md` §5–6).

### T9 [DONE]: revisión
code-reviewer y security-auditor sobre el primer commit. Sin hallazgos críticos ni altos. Corregidos en el segundo commit:
- `aud` verificado en la app (custom audience);
- logs de auth en `error`;
- drain del pull;
- alertas propias;
- rollback en dos pasos;
- rol OpenID Token Creator.

Dos riesgos previos del worker quedan como follow-up: imagen hostil en sharp y claim atado solo a `documentId`. Detalle en `review.md`.
