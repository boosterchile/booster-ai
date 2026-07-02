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
**Deuda conscientemente NO tomada (2026-06-22)** — hardening de valor marginal,
cerrado como aceptado salvo cambio de topología.

`packages/config/src/redis-tls.ts:30-34,59` ya documenta por qué NO se pinea el CN:
se conecta por **IP privada** (el CN del leaf cert es el UID de la instancia, no la
IP) y el control anti-MITM real es la **validación de cadena contra la CA pinneada
por-instancia** (`REDIS_CA_CERT`). Bajo ese modelo (CA per-instancia + IP fija en
`PRIVATE_SERVICE_ACCESS` + AUTH habilitado) no hay otro host bajo la misma CA dentro
del VPC al que redirigir, así que pinear el CN agrega defensa marginal sobre lo que
la cadena CA ya garantiza. El security-auditor lo evaluó **aceptable** (`spec.md §7b`).

**Re-evaluar SI**: la topología cambia a una CA compartida entre instancias, o
Memorystore pasa a accederse por hostname en vez de IP — ahí el CN-pinning sí cierra
un gap. Mientras tanto, implementarlo sería complejidad (inyectar `EXPECTED_INSTANCE_UID`
desde Terraform + verificar que el CN sea el UID estable) sin beneficio de seguridad real.
