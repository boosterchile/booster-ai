# Follow-up: hardening — pin del CN del cert de Memorystore (en vez de checkServerIdentity vacío)

**Origen**: REVIEW de `redis-tls-ca-pinning` (devils-advocate P1-1), 2026-06-07.
**Prioridad**: P2 (hardening; security-auditor evaluó el estado actual como **aceptable**).

## Contexto

`buildRedisTlsOptions` retorna `checkServerIdentity: () => undefined` cuando hay CA — no
verifica el CN, solo la cadena CA. Se conecta por IP privada y el CN del cert es el UID de la
instancia.

security-auditor: aceptable — la CA es por-instancia (no hay otro host bajo la misma CA dentro
del VPC al que redirigir), AUTH habilitado, IP fija en `PRIVATE_SERVICE_ACCESS`. Residual
documentado en `spec.md §7b`.

## Acción propuesta (opcional)

`checkServerIdentity: (_host, cert) => cert.subject?.CN === EXPECTED_INSTANCE_UID ? undefined :
new Error('CN mismatch')`, con `EXPECTED_INSTANCE_UID` inyectado por env desde Terraform
(derivable del id/uid de `google_redis_instance.main`). Verificar primero que el CN del leaf
cert sea efectivamente el UID estable de la instancia.

## Estado
Pendiente de priorizar (hardening, no bloqueante).
