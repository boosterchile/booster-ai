# Review: production-readiness (devils-advocate pass)

- Spec: [`spec.md`](./spec.md) (Status Draft)
- Roadmap: [`roadmap.md`](./roadmap.md) (Status Draft)
- Sub-agente: `agent-rigor:devils-advocate`
- Fecha: 2026-05-17
- Ledger: `.claude/ledger/2026-05-17_8eef12fe-1dfc-4389-936f-139caac69d93.jsonl`

---

## Objeciones P0 (bloqueantes — debe resolverse antes de approve)

### O-1: SC-27 atado a SC-23 atado a lead time ajeno: la spec entera puede no marcarse "Implementada" nunca, y eso no es un riesgo, es una certeza estructural

- **Cita**: spec.md §3.5 SC-27 "≥1 cliente piloto pagando bajo contrato firmado… primera huella certificada emitida" + roadmap.md S13.8 "Primer certificado de huella emitido para el piloto (con sello auditor — requiere SC-23 cerrado)" + Risk row "Auditor GLEC lead time > 8 semanas: L=M, I=H".
- **Problema**: SC-27 exige "huella certificada emitida" → requiere SC-23 → requiere auditor externo cuyo lead time es 6-10 semanas (S11 dura "6–10 semanas calendario, mayormente lead time del auditor"). La spec se autodeclara `Implemented` solo cuando todos los SC se marcan. Si auditor demora 12 semanas (escenario probable en Chile con auditores GLEC que son ~3 firmas), la spec queda en `Draft` indefinidamente y bloquea próximas specs. Además S13 depende de S11+S12 según roadmap §S13 dependencias — eso pone S13 después de S12, que a su vez tiene lead time externo de 4-6 semanas. Camino crítico = S0 (1 sem) + dependencias internas + S11 lead time + S12 lead time + S13 ejecución + lead time cliente piloto = fácilmente 6+ meses, no los "17-22 semanas" prometidos.
- **Propuesta**: Separar SC-27 en dos: (a) SC-27a "Cliente piloto firmado y operando con huella auto-certificada GLEC-compatible", (b) SC-27b "Re-emisión de certificado con sello externo cuando SC-23 cierre". Solo SC-27a bloquea el cierre de la spec. Y/o agregar regla explícita: "Si lead time externo >12 sem, la spec se marca `Implemented (pending external attestation)` con lista de SCs pendientes documentada."

### O-2: Felipe solo-dev, 14 sprints, 17-22 semanas, sin colchón ni regla de parada — esto es un sprint disfrazado de roadmap

- **Cita**: spec.md §1 "El usuario directo es Felipe Vicencio (PO + único desarrollador)" + roadmap.md "Total estimado: 17–22 semanas (~4–5 meses calendario)" + ningún SC ni risk menciona burnout, vacaciones, días enfermo, ni distracciones comerciales (RFP, demos, contratos).
- **Problema**: 17 semanas de ejecución a 40h/sem son ~680h productivas. Para un solo humano con responsabilidades de PO (RFPs, contratos, abogados, cliente piloto, demos, soporte de waves 1-6 ya operativas), el calendario realista es 1.5-2× esa estimación. El cronograma agregado muestra S6 (observatory) en semanas 8-11 corriendo en paralelo con S11 (auditor) en semanas 5-20 y S5 (Wave 5) en semanas 5-7 — Felipe no puede ejecutar 3 sprints concurrentes. El "paralelismo" en realidad significa "lead time externo corre mientras Felipe trabaja en otra cosa", pero el cronograma lo dibuja como ejecución concurrente del dev. Engaño visual.
- **Propuesta**: Re-dibujar Gantt distinguiendo "execution lanes Felipe" (1 sola lane) vs "external lead time lanes" (auditor, vendor, cliente piloto). Agregar SC-0 metódico: "Velocidad real observada después de S0-S2 ajusta estimaciones de S3-S13. Si velocidad es 0.7× nominal, replanificar antes de S3." Y reservar 20% colchón al total.

### O-3: "Strangler con traffic mirroring" en producción durante 3 microservicios sin presupuesto de carga ni budget de costo cuantificado

- **Cita**: spec.md Risk "Microservicios extraction (S3-S4) rompe contratos in-flight: Strangler pattern… rollback al monolito en <5min" + roadmap S3.5 "Traffic mirroring 3-5 días en staging" + S4.5 "Traffic mirroring 1 semana en staging" + Open Q-8 "¿Strangler con traffic mirroring es OK operacionalmente (~doble carga durante 1 semana por servicio) o preferimos cutover directo".
- **Problema**: Q-8 es un open question que afecta TRES sprints (S3 notification, S3 matching, S4 document) y costo cloud, pero está enterrado en la lista al final y no bloquea el approve. Triple mirroring secuencial = ~3 semanas de doble carga. Risk row "Budget Cloud overrun por load test: L=L" ignora completamente que el mirroring de microservicios es overrun adicional y MUCHO más largo que un load test puntual. Adicionalmente, "rollback al monolito en <5min" es una afirmación sin evidencia — no hay test de rollback drill en el plan; el primer rollback real será durante incidente.
- **Propuesta**: Resolver Q-8 antes de aprobar la spec. Si elegimos mirroring: agregar SC explícito "presupuesto cloud para mirroring no excede $X" + risk row con likelihood realista (M, no L). Agregar tarea S3.0 "Rollback drill: switch al microservicio en staging, fuerza fallo, verifica que flag retorna al monolito en <5min con datos consistentes" antes de cualquier switch en prod.

### O-4: SC-1 "0 stubs" + Q-6 "Decisión por stub" se contradicen: la decisión que valida SC-1 no existe al momento del approve

- **Cita**: spec.md §3.1 SC-1 "0 archivos placeholder… Cada stub (3 apps + 5 packages) está **eliminado** del repo o **implementado** con cobertura ≥80/80/80/80" + Open Q-6 "Decisión por stub: ¿eliminar todos? ¿implementar `trip-state-machine`…? Recomendación: ver per-stub decision en plan S2" + roadmap S2.1 lista decisiones tentativas pero las cataloga como "Decisión en este sprint".
- **Problema**: SC-1 es binario y verificable post-facto, pero el camino para llegar a SC-1 está abierto hasta S2 (semana 4-5). Hay 8 stubs (3 apps + 5 packages). Si Picovoice no llega y wake-word stub queda, ¿cuenta? Si `packages/carta-porte-generator` se decide en S4, ¿quién cuenta? El criterio se vuelve no auditable. La "recomendación pre-armada" en S2.1 además decide unilateralmente "eliminar `packages/ai-provider`" y eso es ADR territory (cambio de patrón cross-package: ADR-001 listaba ai-provider como package).
- **Propuesta**: Convertir Q-6 en sub-spec separada (`.specs/stubs-decision/spec.md`) que se aprueba antes de S2, NO durante S2. Sin esa decisión, SC-1 no es accionable. Y mover la decisión de eliminar `ai-provider` a un ADR explícito que supersede el listado de packages en ADR-001.

---

## Objeciones P1 (debe resolverse antes de approve)

### O-5: SC-22 "on-call ritual unipersonal" viola realidad física — un solo humano no puede tener SLO uptime 99.9% en gateway TCP

- **Cita**: spec.md §6.5 "SLO uptime telemetry-tcp-gateway: 99.9% (data path crítico)" + "On-call response ≤15 min para alertas SEV-1" + Risk row "Felipe operando solo + on-call ritual: H/M: Ritual unipersonal documentado honestamente como 'solo-dev mode'. Aceptación: response time = best-effort" + Open Q-5 abierto.
- **Problema**: 99.9% = 43 min downtime/mes. Si Felipe duerme, viaja, está en demo cliente, o desconectado >15min, SEV-1 incumple. La "aceptación: best-effort" contradice el SLO numérico de 99.9% — son incompatibles. Vender al piloto (SC-27) con un SLA implícito de 99.9% en gateway cuando el on-call es best-effort es exposure legal cuando el cliente lea T&C (SC-25).
- **Propuesta**: O bajar SLO gateway a 99.5% explícitamente reconociendo solo-dev, o resolver Q-5 con partner contratado ANTES de aprobar (no en S10). Documentar explícitamente en T&C del piloto la ventana de respuesta humana real.

### O-6: SC-15 + SC-16 corren "en CI por PR" pero el cronograma no incluye coste de tiempo de feedback de PRs

- **Cita**: spec.md §3.3 SC-15 "8 flujos críticos por rol… Cada flujo corre en CI por PR (no solo staging post-deploy)" + SC-16 "0 violations P0/P1 al merge" + roadmap S1.5 "Workflow `ci.yml` actualizado para correr Playwright headless en PR".
- **Problema**: 8 Playwright + axe-core por PR fácilmente toma 15-30 min. Felipe va a mergear ~50-100 PRs en este plan. Eso es horas de espera bloqueada acumuladas + costo Cloud Build. No hay tarea para optimizar (shard tests, paralelizar runners, ejecutar solo specs afectados). El gate va a crear backlog de PRs en cola.
- **Propuesta**: Agregar tarea S1.6 "Sharding + selective execution Playwright (path-based filter o changed-files-only)". Y SC explícito sobre tiempo CI máximo (ej. "≤10 min p95 wall-clock CI por PR").

### O-7: Sprint 8 "Contingencia S8b reservada para rework" es drift vocabulary disfrazada de prudencia

- **Cita**: roadmap.md S8 "Contingencia S8b: Reservado para rework si S8 revela problema arquitectónico. NO se planifica contenido a priori — se decide al cierre de S8" + Risk row "Load test revela problema de arquitectura… Contingencia 'S8b' reservada".
- **Problema**: "Reservar contingencia sin planificar contenido" = "we'll improve later" según CLAUDE.md §4 (drift vocabulary). Es admitir "puede ser que rompamos el plan, ya veremos". Si la probabilidad es M e impact H, el plan debe identificar QUÉ tipo de rework probable (e.g., "si bottleneck es DB → considerar read replica", "si es N+1 → batching") con bound de tiempo.
- **Propuesta**: Convertir "S8b reservada" en "S8b: si rework requerido, máx 3 semanas, fuera de eso re-aprobar spec maestra". Agregar bullet de 3 categorías probables de rework con tiempo estimado.

### O-8: ADR-012 vigencia abierta (Q-7) bloquea el sprint más grande del plan (S6, 2.5 semanas)

- **Cita**: spec.md Q-7 "¿ADR-012 sigue siendo la referencia válida o ha evolucionado? Verificar antes de spec del sprint" + roadmap S6 "Duración estimada: 2.5 semanas. Sprint grande; podría dividirse en S6a/S6b si scope se confirma" + S6.1 "Verificar ADR-012 vigente; si requiere update, ADR nuevo + supersede".
- **Problema**: "Sprint grande podría dividirse si scope se confirma" significa que el scope no está confirmado al aprobar la spec. Estimación de 2.5 semanas para un sprint cuyo scope arquitectural está sin verificar es vibes, no estimación. Además S6 incluye "Digital twins: modelo de simulación + visualización (alcance a confirmar en spec del sprint)" — scope creep institucionalizado.
- **Propuesta**: Resolver Q-7 ANTES de aprobar. Si "digital twins" no tiene scope acotado, sacarlo de SC-13 a "Out of scope".

---

## Objeciones P2 (mejorar antes de SHIP)

### O-9: Dependencias declaradas son mentidas / incompletas

- **Cita**: roadmap S6 "Dependencias: S2 + S4" + S7 "Dependencias: S4" + S13 "Dependencias: S11 + S12 + S10".
- **Problema**: S13 omite SC-25 (legales) como dependencia — sin contrato firmado no se factura, y los términos legales deben existir antes de buscar piloto, no después. S6 no menciona dependencia con S3 (matching-engine extraído) aunque urban observatory consume datos de matches. S7 omite SC-20 (SLOs visibles) aunque "métricas custom… visibles en Cloud Monitoring" requiere SLO/dashboard infra.
- **Propuesta**: Matriz de dependencias real (cada SC vs cada SC).

### O-10: SC-26 "pricing consistente con `apps/web` checkout flow (si aplica)" — el "(si aplica)" es escape hatch indebido

- **Cita**: spec.md §3.5 SC-26 "Pricing prod publicado en `www.boosterchile.com` y consistente con `apps/web` checkout flow (si aplica)".
- **Problema**: "Si aplica" es ambiguo. ¿Hay checkout flow o no? ¿Cómo se cobra al piloto? ¿Factura manual? Eso requiere proceso documentado.
- **Propuesta**: Eliminar "(si aplica)". Sustituir por "Si checkout flow existe en `apps/web`, pricing publicado coincide. Si no existe, ADR-XXX documenta el mecanismo de cobro (factura manual / transferencia / pasarela B2B)."

### O-11: ADR-042 mencionado como "ya en pipeline" pero el plan lo aprueba en S0 — orden inconsistente

- **Cita**: spec.md §3.1 SC-4 "ADR-042 cerrado" + Risk "ADR-042 ya en pipeline" + roadmap S0.1 "ADR-042 redactado y aprobado".
- **Problema**: Risk dice "ya en pipeline" (presente), S0.1 dice "redactado y aprobado" (futuro). ¿Existe el draft o no?
- **Propuesta**: Validar estado real de ADR-042 hoy (¿hay archivo `.draft.md`?) y corregir lenguaje.

---

## Top 3 que cambian el plan

1. **Desatar la spec del lead time externo (O-1)** — separar SC-27 en piloto-firmado vs piloto-con-cert-externa. Sin esto, la spec es indefinidamente `Draft` y no sirve como contrato de cierre.
2. **Re-honestar el Gantt para solo-dev (O-2 + O-5)** — una sola lane de ejecución humana + lanes separadas para lead times externos + decisión sobre on-call partner (Q-5) antes de aprobar, no en S10. Sin esto, "17-22 semanas" es marketing interno.
3. **Resolver Q-6, Q-7, Q-8 antes del approve (O-3, O-4, O-8)** — stubs decision, ADR-012 vigencia, strangler pattern. Aprobar la spec con estas open determina retrabajo predecible.

---

## Mi evaluación (Claude, no devils-advocate)

Las 11 objeciones son de fondo, no estilísticas. Las cuatro P0 son acertadas. Mi recomendación de aplicación:

- **O-1** (split SC-27) — aplicar tal cual. Cambia 1 línea en §3.5 + 1 línea en S13 acceptance.
- **O-2** (Gantt honesto) — re-dibujar el cronograma con 1 lane Felipe + lanes externas. ~30 min.
- **O-3** (strangler + budget mirroring) — convertir Q-8 en decisión ahora (pregunta directa al PO), agregar SC de budget mirroring + tarea S3.0 rollback drill.
- **O-4** (stubs decision) — promover Q-6 a sub-spec corta `.specs/stubs-decision/spec.md`, aprobar antes de S2.
- **O-5** (SLO 99.9% vs solo-dev) — más profundo. Hay 2 opciones reales: (a) bajar SLO gateway a 99.5% y documentar, (b) buscar partner antes de aprobar. Decisión del PO.
- **O-6** (Playwright CI cost) — agregar SC tiempo CI máximo + S1.6 sharding. Barato.
- **O-7** (S8b drift vocab) — sustituir por categorías de rework probables + bound de tiempo.
- **O-8** (ADR-012 vigencia) — leer ADR-012 ahora y decidir si está vigente. Si scope digital twins no acotado, sacarlo de SC-13.
- **O-9** (deps matrix) — útil pero P2, post-approve.
- **O-10** (checkout escape hatch) — quitar "(si aplica)" y reemplazar por ADR de cobro.
- **O-11** (ADR-042 estado real) — verificar 1 ls.

Las objeciones P0 cambian la spec sustantivamente. Mi recomendación: **aplicarlas antes de aprobar la spec**. El usuario decide.

---

## Status de aplicación (2026-05-17)

PO decidió aplicar **P0 + P1**, bajar SLO gateway a **99.5%** (resuelve O-5).

| Obj | Status | Cambio aplicado |
|---|---|---|
| **O-1** | ✅ Applied | SC-27 split en SC-27a (bloqueante: piloto firmado + auto-cert) + SC-27b (post-Impl: re-emisión con sello externo). SC-23 también movido a post-Impl. Regla de cierre §3 explícita: bloqueantes cierran spec, post-Impl trackean. |
| **O-2** | ✅ Applied | Gantt rediseñado con 1 lane Felipe + lanes externas. S11 eliminado del camino crítico (su contenido humano se mueve a S0.5 + ad-hoc). SC-28 velocity check post-S2. Total recalculado: 22-26 sem (vs 17-22 sem v1 deshonesto). |
| **O-3** | ✅ Applied | Q-8 promovida a SC-30 (ADR strangler-vs-cutover antes de S3 + budget USD/sem cuantificado si strangler + S3.0 rollback drill obligatorio). Risk row mirroring budget M/M agregado. |
| **O-4** | ✅ Applied | Q-6 promovida a sub-spec [`../stubs-decision/spec.md`](../stubs-decision/spec.md). 8 decisiones binarias formalizadas. Aprobación PO antes de S2. ADR-001 supersede parcial documentado. |
| **O-5** | ✅ Applied | SLO gateway 99.9% → 99.5% en §6.5 con razón explícita. SC-22 redefinido como "best-effort honesto" (≤30 min business hours, ≤2h fuera). T&C piloto refleja ventana real (SC-25). |
| **O-6** | ✅ Applied | SC-29 (CI ≤10 min p95) agregado + S1.6 sharding Playwright + path-filter. |
| **O-7** | ✅ Applied | S8b reformulado con 3 categorías de rework (DB-bound, app-bound, infra-bound) + bound máx 3 sem + gate explícito: si excede, re-aprobar spec maestra. |
| **O-8** | ✅ Applied | ADR-012 leído. Vigente, pero scope original Q3 2026 → Q3 2027 (4 fases). SC-13 split en SC-13a (Capa 1 eco-routing) + SC-13b (Capa 2 observatorio Coquimbo). Capas 3-4 (gemelos digitales) movidas a Out of scope §5. |
| **O-9** | ⏸ Backlog | Matriz de dependencias agregada al roadmap (sección "Matriz de dependencias"). Versión inicial con dependencias clave; refinar caso por caso en sprints individuales. |
| **O-10** | ✅ Applied | SC-26 reformulado: "Si checkout flow ausente, ADR-XXX documenta mecanismo de cobro". "(si aplica)" eliminado. |
| **O-11** | ✅ Verified | Verificado: ADR-042 ya existe (stakeholder-geo). Drift es **ADR-043** (próximo libre). Corregido en SC-4 + Risk row. |

**No aplicadas explícitamente**: ninguna P0/P1.

## Decision log

- **2026-05-17** — devils-advocate pass ejecutado. 4 P0 + 4 P1 + 3 P2.
- **2026-05-17** — PO aprobó aplicar P0 + P1 + SLO gateway 99.5%.
- **2026-05-17** — Aplicación completa P0+P1 + P2 (excepto O-9 backlog). Spec v2 + Roadmap v2 + sub-spec stubs-decision creada. Pendiente: aprobación final PO de spec v2.
