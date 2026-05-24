# ADR-051 — PII redaction policy en `@booster-ai/logger`

**Estado**: Accepted
**Fecha**: 2026-05-24
**Decider**: Felipe Vicencio (Product Owner)
**Related**: [ADR-001](./001-stack-selection.md), [ADR-049](./049-claude-code-plugin-system-adoption.md), [.specs/sec-001-cierre/spec.md §3 H4](../../.specs/sec-001-cierre/spec.md)

**REVIEW_BY**: 2026-11-24 (6 meses; revisar fixtures, thresholds y patterns)

---

## Contexto

Ley 19.628 (privacy Chile) y la auditoría SEC-001 (objeción O-12 del devils-advocate, decisión PO 2026-05-24) hacen inseparable la operación de `@booster-ai/logger` de la obligación de redactar PII en structured logs. Sin redacción, cualquier `log.info({ user })` filtra email/RUT/teléfono/JWT a Cloud Logging y eventualmente a sinks downstream (BigQuery, dashboards, exportes).

El logger ya tenía redacción **path-based** vía `redactionPaths` (Pino redact por nombre de campo). Pero campos con nombres no allowlisted, o PII embebida en strings libres (mensajes, errors, stack traces), pasaban sin redactar.

T4-T6 de la wave SEC-001 cierran la brecha con redacción **value-based** (regex sobre valores de strings) complementaria a la path-based.

## Decisión

**Política de PII redaction obligatoria en `@booster-ai/logger`**, aplicada en dos capas independientes que cubren casos distintos:

1. **Capa path-based** (`redactionPaths` en `src/redaction.ts`): Pino redacta campos cuyo path matchee la lista (e.g., `*.email`, `*.password`, `req.headers.authorization`). Fast-path para JSON estructurado donde el nombre del campo es señal.

2. **Capa value-based** (`redactValue` + `redactObjectValues` en `src/redaction.ts`, wired vía `formatters.log` en `createLogger`): regex sobre VALORES de strings cubre:
   - **Emails**: regex RFC-5322 simplificado (anti-ReDoS, single-char separadores `[.+\-]`).
   - **JWTs**: 3 segmentos base64 prefijados `eyJ`.
   - **RUTs**: 7-8 dígitos + DV opcional, validados módulo-11 (evita FPs sobre números aleatorios).
   - **Phones Chile**: candidatos `+?\d[\d\s\-()]{6,18}\d` validados vía `normalizePhone()` (T2) — incluye normalización de spaces/dashes/parens antes del check E.164.
   - **Sensitive keys**: si `keyName` matchea `/pass|secret|token|key|auth/i`, el value se reemplaza por `[REDACTED:password]` sin importar su forma.

### Markers

Todo PII detectado se reemplaza por un marker explícito que indica el tipo:
`[REDACTED:email]`, `[REDACTED:phone]`, `[REDACTED:rut]`, `[REDACTED:jwt]`, `[REDACTED:password]`.

Esto permite ops auditar qué patrón disparó la redacción y diferenciar entre redacción path-based vs value-based.

### Thresholds medibles (SC-H4.1)

La capa value-based se valida contra dos fixtures committed bajo `packages/logger/test/fixtures/`:

| Fixture | Tamaño | Contenido | Métrica | Umbral |
|---|---|---|---|---|
| `legit-1000.json` | 1000 entries | Log strings realistas SIN PII (HTTP access logs, worker state, DB queries, métricas, configs) | False-positive rate | ≤1% |
| `adversarial-100.json` | 100 entries | PII en formatos exóticos (typos, spaces, dashes, parens, multi-PII por entry, encoding obfuscation) | False-negative rate | ≤5% |

Verificación: `pnpm --filter @booster-ai/logger test:thresholds`. El test corre como parte de `pnpm test:coverage` en CI (`.github/workflows/ci.yml`).

**Baseline 2026-05-24**: FP=0/1000 (0.0%), FN=1/100 (1.0%). El único FN es `phone_landline_no_prefix` (9-dígitos landline sin `+56` — el regex `normalizePhone` requiere prefix o auto-detección de móvil starts-with-9). Documentado como limitación conocida.

## Scope: qué SE redacta y qué NO

**SE redacta:**
- Emails RFC-5322 simplificado (sin internationalization).
- RUTs chilenos válidos módulo-11.
- Teléfonos chilenos normalizables a E.164 (móvil 9-digit o fijo 8-digit post-`+56`).
- JWTs (3 segmentos base64 prefijados `eyJ`).
- Cualquier value cuyo key contenga `pass|secret|token|key|auth`.

**NO se redacta (decisión deliberada):**
- Patentes vehiculares (no son PII per Ley 19.628 — son public registry).
- IPs (técnicamente PII bajo GDPR, pero requeridas para operations/incident response).
- Coordenadas GPS individuales (se aplica k-anonymity en pipeline downstream — ver ADR-041).
- IDs internos (`trip_<uuid>`, `carrier_<uuid>`) — no son PII reidentificable sin acceso DB.
- Nombres en texto libre — alto riesgo de FP (cubre cualquier `*Name` field path-based, pero no value-based).
- Direcciones físicas en texto libre — cubierto path-based (`*.address`), no value-based.

## Cómo extender con nuevos patterns

Para agregar un nuevo tipo de PII a la capa value-based:

1. **Definir regex en `packages/logger/src/redaction.ts`** con tres reglas anti-ReDoS:
   - Single-char character classes en separadores (no `.*` ni overlap).
   - Quantifiers bounded (no unbounded `*` después de grupos ambiguos).
   - Si requiere validación semántica (e.g., módulo-11 RUT, normalize phone), usar helper de `@booster-ai/shared-schemas` ANTES de redactar para evitar FPs.

2. **Agregar replace en `redactValue`** respetando orden:
   - Patterns más específicos primero (e.g., RUT antes que phone — un RUT válido no debe ser confundido con phone candidate).
   - Patterns con validación semántica se aplican vía callback `(match) => isValid(match) ? marker : match`.

3. **Agregar entries al fixture adversarial-100.json** (mínimo 10 por nuevo pattern) y regenerar:
   ```bash
   node packages/logger/test/fixtures/generate.mjs
   ```

4. **Si el nuevo pattern podría disparar FPs sobre datos legitimate**, agregar 20-50 entries representativos a `legit-1000.json` para mantener el umbral 1% verificable.

5. **Correr `pnpm --filter @booster-ai/logger test:thresholds`** para confirmar que ambos umbrales (FP≤1%, FN≤5%) se mantienen.

6. **Actualizar este ADR** con el nuevo pattern, marker y limitaciones conocidas. NO editar ADR-051 — superseder con un ADR nuevo que referencie este.

## Consecuencias

**Positivas:**
- Compliance Ley 19.628 verificable: tests CI bloquean regresiones de PII en logs.
- Defense-in-depth: capa value-based catches PII en strings libres donde path-based no aplica.
- Audit trail: markers explícitos por tipo permiten distinguir redacciones genuinas de strings que contienen `[REDACTED:*]` por otra razón.

**Negativas (aceptadas):**
- Performance overhead: cada log structure-walk + regex sobre cada string. Medición pendiente bajo carga (`logger.bench.ts` follow-up). Mitigación si necesario: cache de "ya redactado" via marker presence check.
- False negatives reales: 9-digit landlines sin `+56`, RUTs con dots como separadores (e.g., `1.234.567-8`), emails con internationalization domain names. Documentados acá; expansión vía pipeline iterativo (ADR-051a o equivalente).
- Maintenance: el fixture adversarial requiere actualización cuando aparezcan nuevos formatos en producción (típicamente vía incident post-mortem que descubre PII no redactada).

## Rollback

Revertir commits T4+T5+T6 elimina value-based redaction; path-based queda intacto. Compliance regression menor (logs reciben PII embebida en strings) pero no customer-facing. Cost ~5 min.

## Referencias

- `.specs/sec-001-cierre/spec.md §3 H4` — SC-H4.1, SC-H4.2, SC-H4.3, SC-H4.4.
- `packages/logger/src/redaction.ts` — implementación.
- `packages/logger/test/fixtures/{legit-1000,adversarial-100}.json` — corpus de validación.
- `packages/logger/test/fixtures/generate.mjs` — generador determinista.
- Commits: `d9571bf` (T4 core), `e5c8d18` (T5 phone), [pending] (T6 fixtures + ADR).
