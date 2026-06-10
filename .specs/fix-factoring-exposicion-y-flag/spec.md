# Spec: fix-factoring-exposicion-y-flag

- Author: Felipe Vicencio (with agent-rigor)
- Date: 2026-06-10
- Status: Approved
- Linked: Auditoría arquitectónica 2026-06-09, riesgo alto #4 (verificado); ADR-029/030/032. Decisión PO 2026-06-10: "Ambas cosas".

## 1. Objective

(1) Hacer operativo el control de exposición crediticia de "Booster Cobra Hoy": `shipper_credit_decisions.current_exposure_clp` solo se escribía como default 0 — `cobraHoy()` valida `exposición + monto ≤ límite` contra un contador que nunca se movía, dejando el límite revolving de ADR-029 §3 inefectivo. (2) Cambiar el default de `FACTORING_V1_ACTIVATED` de `NODE_ENV === 'production'` a `false`: la activación de cobro de dinero debe ser opt-in explícito del operador (vuelve al default seguro del ADR-030 §1).

## 2. Why now

El flag estaba activo por defecto en prod con el límite crediticio inoperante: en cuanto operara dinero real, un shipper podía acumular adelantos sin tope efectivo. Decisión del PO: tracking + flag, defensa en profundidad.

## 3. Success criteria

- [ ] Transición admin a `desembolsado` incrementa `current_exposure_clp` de la decisión vigente del shipper en `monto_adelantado_clp`, en la misma transacción del cambio de estado, con la fila del adelanto y la de la decisión bloqueadas (`FOR UPDATE`) y CAS por status — dos requests concurrentes no aplican el delta dos veces.
- [ ] `desembolsado` sin decisión vigente → 422 `shipper_sin_decision_vigente` (fail-hard: consumir crédito sin decisión = desembolso sin tope).
- [ ] Transición a `cobrado_a_shipper` decrementa el mismo monto con piso 0; si el piso recorta (decisión rotada entre desembolso y cobro), `logger.warn` con before/after — el clamp nunca es silencioso.
- [ ] `cobrado_a_shipper` sin decisión vigente → procede con warn (el dinero volvió igual).
- [ ] `FACTORING_V1_ACTIVATED` default `false` en TODOS los entornos; activación solo por env var explícita; test que rompe ante un revert del default.

## 4. User-visible behaviour

Operador platform-admin: las transiciones funcionan igual; el check de `limite_exposicion_excedido` en `cobraHoy()` ahora refleja adelantos realmente desembolsados y no cobrados. Carriers: el botón "Cobra hoy" desaparece en prod hasta que el operador active el flag explícitamente (decisión PO; pre-comercial sin partner de factoring integrado).

## 5. Out of scope

- Underwriting automático (`evaluarShipper` sin caller — requiere integración Equifax, ciclo propio).
- Cobro mensual de membresías (riesgo media de la auditoría, ADR-031 lo declara no-bloqueante con tiers free).
- Semántica de exposición para `mora → cancelado` (write-off): NO decrementa — conservador, ver §13.

## 6. Constraints

1. La transición de estado y la mutación de exposición son atómicas (una transacción).
2. La exposición vive en la decisión VIGENTE (única por el unique parcial `uq_shipper_credit_decisions_vigente`); si la vigente cambió entre desembolso y cobro, el decremento aplica sobre la vigente actual con piso 0.
3. Sin migraciones (columna existe).

## 7. Approach

En `admin-cobra-hoy.ts`: el SELECT inicial suma `empresaShipperId` y `montoAdelantadoClp`; el UPDATE del adelanto se envuelve en `db.transaction` y, según el target, ejecuta el UPDATE aritmético sobre `shipper_credit_decisions` (vigente: `approved=true AND expires_at > now()`): `+monto` en `desembolsado`, `GREATEST(0, -monto)` en `cobrado_a_shipper`; `.returning` vacío → warn. En `config.ts`: `FACTORING_V1_ACTIVATED: booleanFlag(false)` + docstring actualizado con el procedimiento de activación (env var en Cloud Run vía Terraform).

## 8. Alternatives considered

- **A. Exposición calculada on-the-fly (`SUM` de adelantos en desembolsado/mora)** — Rechazada para este fix: cambia el contrato de lectura de `cobra-hoy.ts` y el modelo de ADR-029 declara el contador en la decisión; es además una candidata legítima para la integración del partner (anotada en §13).
- **B. Trigger SQL para mantener el contador** — Rechazada: lógica de negocio invisible al código TypeScript, contra el patrón del repo (servicios orquestan, SQL almacena).
- **C. Solo cambiar el flag sin tracking** — Rechazada por decisión explícita del PO ("Ambas cosas").

## 9. Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Decisión vigente distinta entre desembolso y cobro | L | M | Piso 0 con warn explícito before/after cuando recorta (clamp nunca silencioso); auditable vía logs + notas_admin |
| Flip del default apaga factoring en prod sin aviso | — | L | Es la intención del PO; documentado en docstring + PR. **Precondición de deploy en §11** |
| Doble click / requests concurrentes duplican el delta | L | H | IMPLEMENTADO (review 2026-06-10): SELECT FOR UPDATE del adelanto + validación de transición POST-lock + CAS por status en el WHERE; la decisión también se lee FOR UPDATE. Orden de locks adelanto→decisión sin camino inverso (sin deadlock) |

## 10. Test list

- T1: transición a `desembolsado` ejecuta UPDATE de exposición con +monto en la misma tx.
- T2: transición a `cobrado_a_shipper` ejecuta UPDATE con GREATEST(0, −monto).
- T3: sin decisión vigente (returning vacío) → transición OK + logger.warn.
- T4: transiciones que no tocan dinero (`aprobado`, `rechazado`, `mora`, `cancelado`) NO tocan exposición.
- T5: `FACTORING_V1_ACTIVATED` es false sin env var aun con NODE_ENV=production.

## 11. Rollout

- Feature-flagged? El propio cambio ajusta el flag: default false; activación por `FACTORING_V1_ACTIVATED=true` en Cloud Run (Terraform compute.tf cuando el PO decida).
- Migration needed? No.
- Rollback plan: revert del commit. Nota: si hubiera adelantos desembolsados pre-fix, su exposición no está contada — backfill manual documentado en el PR si aplica.
- **Precondición de deploy (review 2026-06-10)**: verificar en prod `SELECT count(*) FROM adelantos_carrier WHERE status NOT IN ('cobrado_a_shipper','cancelado','rechazado')` = 0 ANTES del flip — con flag false los endpoints admin devuelven 503 y un adelanto in-flight quedaría sin lifecycle hasta setear la env var. Si hay filas, coordinar el flip con su cierre o setear la env var en el mismo deploy.
- Monitoring: warns 'sin decisión crediticia vigente' / 'RECORTADO por piso 0' + revisión de current_exposure_clp en las transiciones de prueba.

## 12. Open questions

None as of 2026-06-10 (semántica write-off anotada como decisión en §13).

## 13. Decision log

- 2026-06-10 — Draft + decisión PO "Ambas cosas" vía AskUserQuestion.
- 2026-06-10 — `mora → cancelado` NO decrementa exposición (conservador: un write-off no libera cupo). Revisar al integrar el partner; alternativa SUM-on-the-fly anotada.
- 2026-06-10 — REVIEW (devils-advocate + security-auditor + code-reviewer, 3 bloqueantes): (1) la primera implementación validaba la transición FUERA de la tx (doble-click duplicaba el delta) → reescrita con FOR UPDATE + CAS; (2) desembolso sin decisión vigente pasaba con warn → ahora 422 fail-hard; (3) clamp del piso 0 era silencioso → warn con before/after; (4) T5 sin test → test/unit/config-flags.test.ts; (5) asserts de exposición pasaron de shape a valor exacto (el signo del delta es el comportamiento). Semántica confirmada: el consumo de cupo ocurre en desembolso (no en solicitud); backstop de pipeline-stuffing = admin humano + 422. Unicidad de decisión vigente garantizada por unique parcial uq_shipper_credit_decisions_vigente.
