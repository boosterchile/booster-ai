
# Devils-advocate review — redis-tls-ca-pinning — 2026-06-07T18:00:00Z

(adversarial review of commit 38572f5 on fix/redis-tls-ca-pinning)

## P0 — must address before ship

### P0-1: whatsapp-bot sigue con `rejectUnauthorized: false` — el fix dejó intacto un MITM real
- `apps/whatsapp-bot/src/main.ts:33` → `tls: config.REDIS_TLS ? { rejectUnauthorized: false } : undefined`.
- Este es el patrón que el spec promete erradicar (SC-4: "NO rejectUnauthorized:false"). El commit lo cumple SOLO en apps/api y deja el bot con la cadena CA DESHABILITADA por completo. No es "validar contra bundle del sistema" como el API roto: es no validar nada. El comentario 24-28 ("no hay MITM possible") es exactamente la racionalización que el helper nuevo refuta.
- El bot YA recibe `REDIS_CA_CERT` por env (compute.tf:25 → merge en bloque whatsapp-bot línea 528), o sea la materia prima está disponible y el código la ignora.
- Recomendación: cambiar main.ts:29-33 a `tls: buildRedisTlsOptions({ tls: config.REDIS_TLS, caCert: config.REDIS_CA_CERT })`. El helper debe vivir en un package compartido (packages/config o un packages/redis) — hoy está en apps/api/src/lib y el bot no puede importarlo cruzando apps. Sin esto el commit es un fix parcial que deja deuda de seguridad MÁS grave que la que arregla.

### P0-2: cero cobertura de test sobre el camino TLS que causó el incidente
- Los 4 tests nuevos (redis-tls.test.ts) prueban la FORMA del objeto retornado, no el comportamiento TLS. La línea 24 incluso invoca `checkServerIdentity('172.25.0.3', {})` con `@ts-expect-error` y comprueba que retorna undefined — es decir, prueba que la función no hace nada, no que la cadena CA se valide.
- Las integration tests (signup-request-fail-closed.integration.test.ts:65, etc.) levantan `redis:7-alpine` en plaintext (sin TLS). El bug original (UNABLE_TO_VERIFY_LEAF_SIGNATURE en handshake TLS) es estructuralmente INDETECTABLE por la suite actual. Un futuro `tls: {}` re-introducido no rompería ningún test.
- Recomendación: añadir un integration test que levante Redis con TLS + cert de CA propia y verifique (a) que con la CA correcta conecta, (b) que con CA equivocada el handshake FALLA. Sin (b) no hay prueba de que la cadena se valide de verdad — y (b) es el único test que distingue este fix de `rejectUnauthorized:false`.

## P1 — frágil, decidir y documentar

### P1-1: `checkServerIdentity: () => undefined` desactiva TODA verificación de identidad, no solo el hostname
- `apps/api/src/lib/redis-tls.ts:40`. El spec §4/§5 argumenta que la cadena CA es "el control real anti-MITM". Es cierto que la cadena se mantiene, PERO: dentro de PRIVATE_SERVICE_ACCESS, cualquier entidad capaz de presentar un cert firmado por la misma CA de Memorystore (p.ej. otra instancia Memorystore del mismo proyecto si la CA fuese compartida, o un atacante que comprometa el peering) pasaría la validación porque ya no se compara identidad alguna.
- El propio spec dice (línea 52-53) que el CN del cert es el UID de la instancia. Eso es precisamente la identidad que SÍ se puede y se debe verificar. La pregunta #1 del encargo tiene respuesta concreta: hay una alternativa estrictamente mejor.
- Recomendación: en vez de `() => undefined`, implementar `checkServerIdentity: (host, cert) => { if (cert.subject?.CN === EXPECTED_INSTANCE_UID) return undefined; return new Error('CN mismatch'); }`, con el UID esperado inyectado por env (derivable en Terraform desde el id de la instancia). Si se decide NO hacerlo, el spec debe documentar explícitamente el residual "MITM intra-CA no mitigado" como aceptado, no enterrarlo bajo "el control real se mantiene".

### P1-2: `server_ca_certs[0]` es frágil ante rotación / múltiples certs
- `infrastructure/compute.tf:25`. El spec R1 lo marca "Bajo" porque hoy hay 1 cert. Pero Memorystore PUEDE exponer múltiples server CA certs durante una rotación (período de solapamiento), y el replace de ADR-058 demostró que la CA rota sin aviso. Si Google inicia una rotación server-side, `[0]` puede apuntar al cert saliente mientras la instancia ya presenta el entrante → reaparece UNABLE_TO_VERIFY_LEAF_SIGNATURE, idéntico al incidente actual.
- Pasar TODOS los certs cuesta lo mismo y elimina la clase de bug entera.
- Recomendación: `REDIS_CA_CERT = join("\n", google_redis_instance.main.server_ca_certs[*].cert)` y en el helper `ca: caCert.split(/(?=-----BEGIN CERTIFICATE-----)/)` o pasar el bundle multi-PEM directo (Node acepta múltiples certs concatenados en un solo string de `ca`). Mínimo: documentar el procedimiento de rotación manual y un alert sobre expiry 2036 que hoy nadie vigila.

### P1-3: `tls=true sin CA → {}` enmascara el bug exacto que se está arreglando
- `apps/api/src/lib/redis-tls.ts:33-35`. Pregunta #3 del encargo: SÍ, lo enmascara. Si en prod `REDIS_CA_CERT` llega vacío (typo en Terraform, output renombrado por Google, refresh de state fallido), el helper degrada silenciosamente a `{}` → vuelve EXACTAMENTE al estado que tumbó signup hace horas, pero ahora sin señal nueva porque "es el comportamiento esperado para entornos sin CA".
- En producción `REDIS_TLS=true` SIEMPRE debe venir con CA. La ausencia es un misconfig que debe fallar ruidoso, no silencioso.
- Recomendación: el config de prod debe tratar `REDIS_TLS=true && !REDIS_CA_CERT` como error fatal al startup (refinamiento en redisEnvSchema con superRefine, o un check en config.ts gateado por NODE_ENV=production). Dejar el fallback `{}` solo para dev. Como está, el sistema puede re-incidir sin que ningún test ni ninguna validación lo note.

## P2 — menor / higiene

### P2-1: helper no compartible — destinado a duplicarse
- `apps/api/src/lib/redis-tls.ts`. Vive bajo apps/api. El bot (P0-1) lo necesita y no puede importarlo sin acoplar apps entre sí. Cualquier futuro service con Redis copiará el patrón o el bug. Debería estar en `packages/` (junto a redisEnvSchema en packages/config, o un packages/redis-client).

### P2-2: comentario de server.ts:128 desactualizado
- Dice "T10 introducirá el fail-closed 503"; el fail-closed ya existe (es lo que causó el 503 del incidente). Ruido de bajo costo pero confunde el modelo mental durante un incidente.

### P2-3: el spec §6 declara fuera de alcance "rotación automática del CA cert (válido hasta 2036)"
- 2036 da falsa tranquilidad: el riesgo real no es el expiry sino el replace (ya ocurrió 2 veces de facto vía ADR-058). No hay alerta ni runbook. Aceptable diferir, pero el residual a documentar es "replace de instancia → CA nueva → re-incidente", no "expiry 2036".

## Verdict
- Strong objections (P0, must address): (1) whatsapp-bot queda con rejectUnauthorized:false — fix de seguridad parcial que deja un MITM peor que el arreglado; (2) cero test sobre el camino TLS — la regresión es indetectable, el helper prueba forma no comportamiento.
- Residual risks a aceptar+documentar si no se actúa: identidad de servidor sin verificar (P1-1), fragilidad ante rotación de CA (P1-2/P1-3 enmascaramiento), helper no compartido (P2-1).
- Out of scope: REDIS_PASSWORD a Secret Manager, self-registration SEC-001 (correctamente diferidos).
- NO apruebo. Encontré objeciones fuertes en Premise, Scope, Failure modes y Evidence. El fix resuelve el síntoma en apps/api pero su premisa ("este commit erradica el patrón inseguro de TLS Redis") es falsa mientras el bot siga en rejectUnauthorized:false y mientras ningún test toque TLS real.

---

## Resolución (2ª iteración BUILD — 2026-06-07, post-review)

| Hallazgo | Resolución |
|---|---|
| **P0-1** bot con `rejectUnauthorized:false` | RESUELTO — `apps/whatsapp-bot/src/main.ts` usa `buildRedisTlsOptions`. |
| **P2-1** helper no compartible | RESUELTO — movido a `packages/config/src/redis-tls.ts` (export en index). API y bot importan de `@booster-ai/config`. |
| **P1-2** `server_ca_certs[0]` frágil | RESUELTO — `join("\n", server_ca_certs[*].cert)` (todos los certs). |
| **P1-3** `{}` enmascara el bug en prod | RESUELTO — `requireCa` lanza si `tls && !ca` (callers pasan `NODE_ENV==='production'`). Testeado. |
| **P2-2** comentario stale server.ts | RESUELTO — comentario actualizado (fail-closed ya existe). |
| **P1-1** `checkServerIdentity` sin CN | ACEPTADO como residual (security-auditor: aceptable; CA por-instancia + VPC privado + AUTH). Hardening → follow-up `redis-tls-cn-pinning`. |
| **P0-2** sin test de TLS real | DIFERIDO → follow-up `redis-tls-integration-test`. Mitigación parcial: `requireCa` da cobertura de comportamiento. |
| **security-auditor QUESTION** `REDIS_PASSWORD` plaintext | DIFERIDO (predates) → follow-up `redis-password-to-secret-manager`. |

**security-auditor**: 0 bloqueantes en el commit; postura TLS correcta (sin `rejectUnauthorized:false`, cadena CA validada, fail-closed restaurado por causa raíz, sin leaks).

Evidencia 2ª iteración: config 6 tests, api 111, whatsapp-bot 42 — todos verdes; typecheck 3 packages, biome, terraform validate limpios.
