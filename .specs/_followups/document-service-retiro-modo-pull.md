# Follow-up: retirar el modo pull de document-service

**Origen**: PR #823 (ADR-085 §6 y §9).
**Decisión del PO (2026-10-22)**: «modo pull como rollback dos semanas y luego se retira».
**Prioridad**: P3. Es deuda de transición con fecha; no bloquea nada.

## Problema

Para que el rollback del push no necesite redeploy, el worker sirve dos modos (`DOCUMENT_CONSUMER_MODE=pull|push`). El flag `var.document_service_push` mueve juntos la suscripción, el modo, `min_instances` y `cpu_idle`. Una vez estable el push, el camino pull es código que se mantiene y se testea sin usarse.

## Cuándo empieza a correr el plazo

El reloj de las dos semanas arranca cuando se cumplen las dos condiciones:

1. El PR de una línea que pone `document_service_push = true` está mergeado y aplicado (spec §10, paso 3).
2. La prueba de humo del runbook dio `document.uploaded malformado, ack para descartar` (paso 4).

Anotar acá la fecha del encendido.

## Acción propuesta (en un commit o PR aparte)

- **`apps/document-service`**:
  - quitar `DOCUMENT_CONSUMER_MODE`, `PUBSUB_SUBSCRIPTION_DOCUMENT_UPLOADED` y `MAX_MESSAGES_IN_FLIGHT` de `config.ts`;
  - quitar el StreamingPull y su drain de `main.ts`;
  - quitar la dependencia `@google-cloud/pubsub` si ya no se usa;
  - ajustar tests y README.
- **`infrastructure/`**:
  - quitar `var.document_service_push` y dejar fijos `min_instances = 0`, `cpu_idle = true` y el `push_config` (sin `dynamic`);
  - quitar la env `DOCUMENT_CONSUMER_MODE`.
- **Runbooks**: quitar el modo pull de `service-document-service.md`. El rollback pasa a ser volver a la revisión anterior o revertir el PR.

## Criterio de cierre

- [ ] Fecha de encendido registrada, y dos semanas desde ella sin:
  - alertas `document_uploaded_dead_lettered` ni `document_uploaded_stalled`;
  - logs `push document.uploaded:` en `error` atribuibles al push;
  - rollbacks del modo.
- [ ] PR mergeado que retira el modo pull y el flag, con tests ≥ 80 % y un `terraform plan` acotado registrado. Con el flag ya en `true`, el plan no debe cambiar nada en vivo, salvo quitar la env `DOCUMENT_CONSUMER_MODE`.
- [ ] `grep -rn "DOCUMENT_CONSUMER_MODE\|document_service_push" apps infrastructure docs` sin resultados fuera de ADRs y specs históricas.

## Estado

Abierto. Espera el encendido del flag.
