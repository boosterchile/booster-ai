# Spec: sec-h3-dte-retention-lock

- Author: Felipe Vicencio (with agent-rigor / Claude Opus 4.7)
- Date: 2026-05-24
- Status: **Draft**
- Linked:
  - Split de `.specs/sec-001-cierre/spec.md` H3 per decisión PO 2026-05-24 (devils-advocate O-5: H3 tiene risk class y stakeholder distintos, no debe bundle-arse con H1/H2)
  - Auditoría origen: `feat/security-blocking-hotfixes-2026-05-14:.specs/audit-2026-05-14/security.md` H3
  - Spec hermano: `.specs/sec-001-cierre/spec.md` — debe mergear ANTES del flip H1.6 final
  - CLAUDE.md §Reglas no-negociables del stack Booster
  - SII Chile DTE retention compliance (Ley sobre Facturación Electrónica)

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
