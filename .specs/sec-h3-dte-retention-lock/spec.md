# Spec: sec-h3-dte-retention-lock

- Author: Felipe Vicencio (with agent-rigor / Claude Opus 4.7; trade-off ampliado 2026-06-02 con Opus 4.8)
- Date: 2026-05-24 (trade-off + re-confirmación empírica: 2026-06-02)
- Status: **Draft — decisión PO PENDIENTE (irreversible; se toma fresco, fuera de presión de tiempo, NO en la sesión que documenta)**
- Linked:
  - Split de `.specs/sec-001-cierre/spec.md` H3 per decisión PO 2026-05-24 (devils-advocate O-5: H3 tiene risk class y stakeholder distintos, no debe bundle-arse con H1/H2)
  - Auditoría origen: `feat/security-blocking-hotfixes-2026-05-14:.specs/audit-2026-05-14/security.md` H3
  - Spec hermano: `.specs/sec-001-cierre/spec.md` — debe mergear ANTES del flip H1.6 final
  - CLAUDE.md §Reglas no-negociables del stack Booster
  - SII Chile DTE retention compliance (Ley sobre Facturación Electrónica)
  - Re-confirmación empírica: `.specs/adr-vs-prod-inventory/inventory.md` §ADR-001 + §ADR-007 (finding 🔴 retention-lock, 2026-06-02)

> ⚠️ **Este spec PREPARA la decisión; no la ejecuta ni la toma.** El lock es **irreversible**. La decisión (aplicar `is_locked=true` o mantenerlo false con monitoreo) la toma el PO **fresco, sin presión de tiempo, en una sesión dedicada** — NO en la sesión que documenta este spec. **NADA de tocar el bucket ni el Terraform** hasta esa decisión + la validación SC-4. Documentar ≠ decidir ≠ ejecutar.

## 0. Trade-off de la decisión (resumen para el PO)

**Realidad verificada (re-confirmada 2026-06-02, prod read-only):**
- Bucket `gs://booster-ai-494222-documents-prod`: `retention_policy.retentionPeriod = 189216000s` (**6.0 años** ✓) + CMEK (`documents-cmek`) ✓ — **pero `retention_policy.isLocked` vacío (= false)**.
- `infrastructure/storage.tf:144-145`: `retention_period = 189216000` / `is_locked = false   # CAMBIAR A true MANUALMENTE después de validar` (comentario **stale**, postergado desde el commit inicial).
- **ADR-007 §Retención (línea 189) promete textualmente**: *"Retention Lock de 6 años (no se puede eliminar ni siquiera por admin hasta expiración)"* — esa promesa es **parcialmente falsa hoy**: la duración (6 años) está, pero la **inviolabilidad anti-admin NO** (cualquier principal con `storage.buckets.update` puede acortar la retención o borrar el bucket vía consola/API/Terraform).

**Qué se GANA al poner `is_locked=true`:**
- Cumplimiento SII **inmutable por contrato técnico**, no por intención: la retención DTE de 6 años (obligatoria por la Ley de Facturación Electrónica chilena) queda inviolable vía API.
- **Ningún principal** —incluido el owner del proyecto y un `terraform apply` no revisado— puede acortar la retención ni borrar evidencia legal dentro de la ventana de 6 años.
- La promesa de ADR-007 deja de ser falsa: se alinea narrativa con realidad.
- Verificable por auditor SII con `gsutil retention get` (locked=true).

**Qué se ARRIESGA (por qué es decisión de peso):**
- **IRREVERSIBLE**: una vez `isLocked=true`, los 6 años quedan inamovibles para **todos, incluido el owner**. No hay "des-lock". La única salida técnica es esperar que cada objeto cumpla su retención (6 años por objeto).
- No se puede **mover el bucket** entre proyectos/regiones antes de expiry (migración futura requiere correr en paralelo con el bucket viejo hasta que cada objeto expire).
- Un **bug en el write path de DTEs descubierto post-lock** no se puede remediar acortando retención: obliga a crear un bucket nuevo y operar con el viejo 6 años (ver §7.2).
- Por eso **SC-4 (validación 48h pre-lock) es no-negociable** y la decisión debe tomarse sin presión.

**Estado del trade-off**: el riesgo de NO hacerlo (vector interno: insider/operador/terraform borra evidencia legal) es **medio, no externo**. El riesgo de hacerlo mal (lock prematuro sobre un write path con bug) es **alto e irreversible**. Por eso: documentar ahora, decidir + validar después.

## 1. Objective

Habilitar Retention Policy Lock (`is_locked = true`) en el bucket de Google Cloud Storage que almacena DTE (Documentos Tributarios Electrónicos) de Booster AI, garantizando que la retention period de 6 años (189216000 segundos) sea **inviolable vía API** durante el lifecycle de cada objeto. Cierra el hallazgo H3 BLOCKING de la auditoría 2026-05-14 (SEC-001) sin acoplarlo al ciclo de cierre de demo mode / rate-limit (H1/H2).

## 2. Why now

- Compliance SII Chile: la Ley de Facturación Electrónica + normativa SII exige conservación de DTEs por **6 años desde emisión**. Hoy el bucket está configurado con `retention_period=189216000` (6 años) PERO `is_locked=false`. Cualquier actor con permisos `storage.buckets.update` puede **acortar la retention** o **eliminar el bucket** vía consola/API/Terraform: el "compliance" actual es por intención, no por contrato técnico.
- Vector activo: un actor interno comprometido, un operador con permisos amplios, o un `terraform apply` ejecutado sin revisar pueden destruir evidencia legal de hasta 6 años atrás sin trazabilidad post-hoc.
- Comentario stale en código: `infrastructure/storage.tf:145` dice _"CAMBIAR A true MANUALMENTE después de validar"_ — indica que el cambio fue postpuesto deliberadamente esperando validation. La validation pendiente es: testear que escritura/lectura de DTE sigue funcionando antes de lock, porque el lock es **irreversible** (la única "des-lock" es waitear que cada objeto cumpla su retention period — 6 años por objeto).
- Trigger 2026-05-24: PO decisión de split H3 de SEC-001-cierre para que H3 no bloquee timeline de demo reactivation y para que el lock irreversible no se haga bajo presión del cierre más grande.

## 3. Success criteria

- [ ] **SC-1**: `infrastructure/storage.tf` bucket DTE declara `retention_policy { retention_period = 189216000, is_locked = true }`. Comentario "CAMBIAR A true MANUALMENTE" eliminado, reemplazado por puntero a ADR.
- [ ] **SC-2**: `gsutil retention get gs://<bucket-dte>` muestra `Retention Policy: locked=true, retention=189216000s` (6 años).
- [ ] **SC-3**: ADR nuevo `docs/adr/05X-dte-bucket-retention-lock.md` documenta: (a) decisión + compliance SII; (b) irreversibilidad; (c) procedimiento de validation pre-lock; (d) criterio para considerar revocación (en práctica: nunca, salvo cierre de Booster); (e) impacto operativo (no se puede mover el bucket entre projects, no se puede eliminar evidence anterior).
- [ ] **SC-4 (validation pre-lock)**: corrida de 48h en producción ejecutando write + read + lifecycle de DTEs sin issues (logs limpios), evidencia capturada en `.specs/sec-h3-dte-retention-lock/validation-48h-evidence.md`. Sin este SC, NO se aplica el lock.
- [ ] **SC-5**: `terraform plan` post-merge muestra `is_locked: false → true` como único cambio en el bucket DTE (sin diffs secundarios). Si plan muestra más diffs → STOP, investigar.
- [ ] **SC-6**: post-lock smoke: emisión sintética de 1 DTE → verificar que el archivo se escribe con retention metadata correcta + intento (esperado-fail) de `gsutil rm` retorna error de retention policy.

## 4. User-visible behaviour

**Para shippers/carriers que generan DTEs**: cero cambio visible. La escritura, retrieval, y signed-URL serving siguen funcionando idénticos.

**Para operadores Booster con permisos `storage.buckets.update`**: ya NO podrán acortar la retention period vía consola o API. Cualquier intento retorna error `retention policy is locked`. Eliminar el bucket entero también falla.

**Para auditores SII**: contrato técnico de inviolabilidad. Pueden verificar con `gsutil retention get` que la retention está locked.

## 5. Out of scope

- **Cambio de retention period**: 6 años es el valor SII Chile actual. Si SII cambia la normativa (ej. 10 años), requiere ADR separado + decisión legal.
- **Migración del bucket a otro proyecto o región**: el lock NO permite mover objetos antes de su retention expiry. Migración futura requiere paralelo con el bucket viejo hasta que cada objeto expire.
- **Lock retroactivo en buckets distintos** (logs, backups, otros tipos de documentos): este spec sólo toca el bucket DTE específico de SII. Otros buckets evaluados separadamente.
- **Procedimiento de respuesta a subpoena legal**: cómo Booster responde si autoridad legal exige acceso post-lock está fuera de spec; queda como playbook operativo separado.

## 6. Constraints

- Compliance SII Chile: 6 años retention, normativa de Facturación Electrónica.
- IaC 100% (CLAUDE.md): el lock se aplica vía Terraform, NUNCA vía `gsutil retention lock` ad-hoc.
- Irreversibilidad: el lock es one-way. ADR documenta justificación.
- Performance: cero impacto en write/read latency (Google maneja retention transparente).
- Cost: cero impacto (retention lock es feature sin extra cost).

## 7. Approach

### 7.1. Estrategia

Single PR `feat/sec-h3-dte-retention-lock-2026-05-24` con:

1. **Pre-lock validation (SC-4)**: 48h corrida en prod observando write+read de DTEs. Evidencia: logs limpios, métricas write_success_rate ≥ 99.9%, sample retrieval test cada 6h. Evidencia documentada antes de proceder.
2. **ADR primero**: escribir y mergear ADR documentando decisión, irreversibilidad, validation, criterio revocación. Sin ADR, no se mergea el code change.
3. **Code change**: 2 líneas en `infrastructure/storage.tf` (cambia `is_locked = false` → `true`, elimina comentario "CAMBIAR A true MANUALMENTE").
4. **Terraform plan + apply**: revisar plan, verificar único diff es el flag, apply.
5. **Post-lock smoke**: emisión sintética + verificación `gsutil retention get` + intento de eliminación esperado-fail.

### 7.2. Rollback

**No hay rollback**. El lock es irreversible. La única "des-lock" técnica es esperar que cada objeto cumpla su retention period (6 años por objeto). Por eso SC-4 (validation 48h) es no-negociable.

Si post-lock se descubre un bug que requiere modificar la retention policy, las opciones son:
- (a) Crear nuevo bucket sin lock para futuros DTEs; bucket viejo retiene los objetos hasta expiry natural.
- (b) Aceptar la configuración y operar con ella 6 años.

## 8. Alternatives considered

- **A. Mantener `is_locked = false` con monitoring**: alerta Cloud Monitoring si `retention_period` cambia o si bucket es deleted. _Rejected_: monitoring detecta post-hoc; no previene. Compliance SII es "técnicamente verifiable", no "monitoreada".
- **B. Aplicar el lock vía `gsutil retention lock` manual**: comando directo, sin Terraform. _Rejected_: viola CLAUDE.md §IaC 100%. El state drift queda fuera del repo.
- **C. Postergar hasta primera auditoría SII real**: esperar al auditor. _Rejected_: la auditoría puede tardar meses; mientras tanto el vector está abierto.
- **D. Migrar primero a otro bucket con lifecycle configurations distintas**: más complejo. _Rejected_: el lock es la fix más simple y directa.

## 9. Risks and mitigations

| Risk | L | I | Mitigation |
|---|---|---|---|
| Bug en write path que sobrescribe DTEs vía retention edge case | L | H | SC-4 validation 48h + sample retrieval test. ADR documenta decisión. |
| SII cambia normativa a más de 6 años | L | M | Lock conserva mínimo legal; si SII pide más, nuevo bucket con lock más largo + paralelo. |
| Necesidad de subpoena que exija eliminar evidencia | L | M | Playbook legal separado. Google Cloud permite legal hold workflow separado. |
| Terraform apply fail mid-operation deja state inconsistent | L | H | Plan + revisar diff único. Apply en horario de baja carga. |
| Operador legítimo necesita modificar metadata post-lock (no el contenido) | L | L | Metadata modifications no requieren retention override; solo el contenido + deletion. Documentar en ADR. |

## 10. Test list

- **T1** (manual, 48h pre-lock): script `scripts/dte-write-read-smoke.ts` ejecutado cada 6h durante 48h, log success rate ≥ 99.9%, evidencia capturada.
- **T2** (`infrastructure/test/storage-retention.tftest.hcl`): terraform test fixture verifica que el bucket DTE tiene `is_locked=true` post-apply.
- **T3** (manual, post-lock smoke): emitir DTE sintético, verificar archivo escrito con retention metadata, `gsutil rm` falla con `retentionPolicyNotLocked`.
- **T4** (manual, audit): `gsutil retention get gs://<bucket>` output capturado como evidencia post-deploy.

## 11. Rollout

- **Feature-flagged**: NO. Es change IaC, no runtime config.
- **Migraciones**: ninguna. Objetos existentes en el bucket ya cumplen retention 6 años (la diferencia es ahora inviolable).
- **Rollback plan**: ver §7.2 — irreversible, sólo via nuevo bucket.
- **Monitoring post-deploy**: alerta Cloud Monitoring si write_error_rate del bucket > 0.1% (debería ser 0). 48h watch.

## 12. Open questions

- **OQ1**: ¿Existe ya un playbook legal de subpoena para DTEs? Si no, ¿necesitamos abrirlo como follow-up post-spec?
- **OQ2**: ¿El número del ADR para SC-3 es 051 o el próximo libre? Depender del estado de ADR-049/050 al momento del PR.

## 13. Decision log

- 2026-05-24 — Initial draft. Split de `.specs/sec-001-cierre/` H3 por decisión PO 2026-05-24 (devils-advocate O-5: scope cohesion violado al bundle-ar H3 irreversible con H1/H2 reversibles).
- 2026-05-24 — Validation 48h pre-lock confirmada como no-negociable por irreversibility (SC-4).
- 2026-06-02 — Trade-off completo agregado (§0) para preparar la decisión PO. Re-confirmación empírica prod read-only: bucket `documents-prod` con `isLocked=false` (inventario ADR-vs-prod §ADR-001/§ADR-007). Confirmado que ADR-007:189 promete inviolabilidad anti-admin que hoy es falsa. **Sigue Draft; decisión NO tomada — la toma el PO fresco fuera de presión de tiempo. Nada de prod ni Terraform tocado.**

---

## 14. Addendum 2026-06-10 — hallazgos de la auditoría arquitectónica que cambian el plan

> Origen: auditoría arquitectónica 2026-06-09 (workflow multi-agente, informe en sesión) + instrucción del PO 2026-06-10 "buscar la mejor solución" al ejecutar la remediación del punto 6. Este addendum NO ejecuta nada: agrega dos restricciones nuevas a la decisión pendiente.

### 14.1. Prerequisito técnico nuevo: re-emisión de certificados de carbono

Los certificados de huella de carbono comparten el bucket `documents` (`CERTIFICATES_BUCKET = google_storage_bucket.documents.name`, `infrastructure/compute.tf:124`) y `packages/certificate-generator/src/storage.ts:60-61` asume que una re-emisión **sobrescribe** el mismo path `certificates/{empresaId}/{trackingCode}.pdf`. GCS prohíbe reemplazar objetos que no cumplieron la edad de retención **incluso con el lock sin activar** — la re-emisión ya está rota hoy, y con lock sería irremediable por 6 años.

**Prerequisito antes del lock (cualquiera de los dos):**
- (a) versionar los paths de certificados (`.../{trackingCode}/v{n}.pdf` o timestamp), con el endpoint público `/verify` resolviendo la versión vigente; o
- (b) separar los certificados a un bucket propio sin retention SII (los certificados no son DTEs; su inmutabilidad la da la firma KMS, no la retención del bucket).

La opción (b) es más limpia conceptualmente: deja `documents` 100% DTE/SII (mandato legal puro) y los certificados con su propio lifecycle. Requiere migración de objetos + cambio de env var. Decisión del PO en el mismo paquete que el lock.

### 14.2. NO lockear `crash-traces` — conflicto Ley 19.628

La auditoría propuso inicialmente lockear también el bucket forense `{project}-crash-traces` (7 años, CMEK). **Análisis posterior lo descarta**: los crash traces contienen PII de conductores (GPS, acelerómetro a 100Hz, IO snapshots vinculables a persona vía vehículo/asignación) y su retención de 7 años es una **elección forense de Booster, no un mandato legal**. Un lock irreversible haría técnicamente imposible honrar una solicitud de supresión bajo Ley 19.628 — para los DTE el mandato SII prevalece sobre la supresión; para los crash traces no existe ese amparo. El bucket queda con la retention policy **sin lock** (deliberado, no pendiente), y el comentario de `infrastructure/crash-traces.tf:84-87` debe actualizarse para reflejar que es decisión, no postergación (incluir en el PR del lock de documents).

### 14.3. Plan revisado (reemplaza la secuencia implícita de §0)

1. PO decide entre 14.1(a) y 14.1(b) → ciclo propio (spec + código/infra + migración si aplica).
2. Validación SC-4 (48h) sobre el write path de DTEs — sin cambios.
3. Lock de `documents` (`is_locked=true`) en sesión dedicada del PO — sin cambios.
4. En el mismo PR del lock: comentario de crash-traces.tf actualizado a "sin lock por diseño (Ley 19.628)" + ADR corto que registre ambas decisiones (lock documents / no-lock crash-traces).

## 13bis. Decision log (continuación)

- 2026-06-10 — Addendum §14: prerequisito de re-emisión de certificados detectado (bloquea el lock); crash-traces excluido del lock por conflicto con derecho de supresión Ley 19.628. La decisión del PO ahora incluye elegir 14.1(a) vs 14.1(b). Sigue Draft; nada de prod ni Terraform tocado.

## 14bis. Estado del prerequisito 14.1 (2026-06-11)

**RESUELTO con la opción (b)** — decisión PO 2026-06-11 vía AskUserQuestion: bucket propio `{project}-certificates-{env}` sin retention policy (PR del ciclo `feat-certificados-bucket-propio`; migración operativa en `docs/runbooks/migracion-bucket-certificados.md`). Tras ejecutar esa migración, `documents` queda 100% DTE/mandato SII y el plan §14.3 continúa en el paso 2 (validación SC-4) — la decisión del lock sigue siendo del PO en sesión dedicada.
