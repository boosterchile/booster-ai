# Análisis: portar la base de disciplina de ICARENEST a Booster AI

**Fecha**: 2026-07-06 · **Solicitante**: Felipe Vicencio (PO) · **Pregunta**: icarenest ha sido muy preciso; ¿qué de esa base se migra a booster-ai, qué se mantiene y qué se retira?

---

## 1. Método

Se recolectó evidencia empírica de ambos repos (git log, ramas, PRs, estructura, ledger, tests, workflows, docs) y se contrastó contra los contratos declarados (`CLAUDE.md` de cada uno, brief de producción de icarenest, ADR-049/060/064 de booster). Cada afirmación de este documento cita su evidencia. Donde la evidencia es insuficiente, se declara.

## 2. Qué produce la precisión de icarenest (evidencia)

El git log de icarenest es inusualmente limpio: 19 commits en `main`, cada uno mapeado a una fase (F0–F7) o a un fix acotado, todos vía PR (#1–#16), con el TDD **exhibido en el propio mensaje de commit** ("TDD: 4 rojos exhibidos", "rojo estructural → rojo mutación → verde"). Los mecanismos que lo producen son identificables:

1. **Cimientos congelados fuera del código.** 12 specs en `docs/specs/` fijadas antes de construir. Regla: "nada de eso se reabre desde código; si una decisión de implementación contradice un cimiento, DETENTE y escala". Elimina la re-negociación silenciosa de requisitos.
2. **Frontera de decisiones explícita** (brief §2): lista literal de qué decide Claude (librerías, estructura, nombres internos) y qué NO decide (cimientos, valores visuales, lógica clínica, RLS). Es la regla más barata y de mayor rendimiento del sistema: convierte la ambigüedad en escalada en vez de en criterio propio.
3. **Un frente por vez.** Una fase → una rama `fase/*` → un PR → CI verde → aprobación humana → merge. No se adelanta trabajo. El repo tiene exactamente 2 ramas (main + fase activa).
4. **Criterio de salida declarado antes de construir** + evidencia fresca al cierre ("salida producida ≠ salida útil").
5. **TDD con rojo exhibido** como requisito de cierre, no como aspiración: sin rojo mostrado, la fase no cierra.
6. **Gate humano total**: merge, migraciones, deploys y secretos requieren aprobación explícita de Felipe. La disciplina no depende de tooling: depende de que ningún cambio llegue a main sin pasar por un humano con un checklist corto.
7. **Contrato de 34 líneas.** Todo lo anterior cabe en una pantalla. Se lee completo en cada sesión, en cualquier superficie de Claude (Code, Cowork, chat), sin dependencias.

**Nota de calibración honesta**: parte de la precisión es estructural y NO es portable. Icarenest es un greenfield serial con specs congeladas y un solo frente activo. Booster es un sistema en producción con 9 apps, infra GCP viva, incidentes reales (INC-2026-06-19, Redis TLS) y múltiples frentes simultáneos (seguridad, CORFO, features, cost-opt). Ese entorno genera fricción que ningún contrato elimina. Lo portable son los **mecanismos**, no el resultado idéntico.

## 3. Estado real de booster-ai (evidencia)

### 3.1 Lo que sí funciona — y no hay que tocar

La percepción "booster es impreciso" necesita calibración: la evidencia muestra un núcleo de ingeniería sólido cuyo enforcement real es **CI + gates de GitHub**, no los plugins:

- **376 archivos de test** (vs 13 en icarenest), coverage gate en CI.
- **PRs con evidencia y checks**: los merges recientes muestran "21 checks verdes", terraform fmt/validate, gitleaks, CodeQL.
- **Guards de repo que demostrablemente atrapan errores**: `check-adr-numbering` bloqueó una colisión real de numeración (ADR-060); el preflight `check-validated-secret-placeholders.mjs` nació de un postmortem (INC-2026-06-19) y ataja el patrón antes del apply; spec-drift check en pre-commit.
- **72 ADRs** y disciplina de "nuevo ADR supersede, no se edita el viejo" — operando.
- **`.specs/` en uso intensivo**: 60 directorios de feature con spec/plan/verify. La convención vive.
- **Gate humano en deploy**: `required_reviewers` en el Environment `production` (desde 2026-05-29) — es exactamente el mecanismo icarenest aplicado al deploy.

### 3.2 Los síntomas de imprecisión — con su causa

| Síntoma (evidencia de hoy) | Causa raíz |
|---|---|
| 19 PRs del sweep `_followups` (#509–#527) abiertos sin mergear; "muchos ya-hechos" (CURRENT.md) | **WIP ilimitado**: no existe la regla "un frente por vez / cerrar antes de abrir" |
| 52 stubs en `.specs/_followups`; 37 ramas locales, la mayoría muertas | Ídem: los frentes se abren más rápido de lo que se cierran |
| Gate de deploy "zombie" colgado 13 días (#496); hueco de handoff 06-20→06-30 reconstruido a posteriori desde git log | El estado del proyecto se registra por esfuerzo heroico (CURRENT.md gigante), no por cierre disciplinado de cada frente |
| Rama actual `ahead 2` sin push + archivo suelto `plan.md.save` | Violación de la propia regla "commit+push por tarea" del CLAUDE.md — regla declarada, no operante |
| `canary-verify` es `exit 0`; nightly E2E pega a producción | Deuda declarada pero sin dueño ni fecha — el contrato la documenta en vez de forzar su resolución |

### 3.3 La capa de plugins: costo documentado, beneficio sin medir

Este es el hallazgo central. La cadena de evidencia:

- **El costo es alto y está documentado**: ADR-049 (adopción), ADR-050 (remapeo de paths), ADR-060 (retiro de agent-rigor porque "no enforced de verdad"), ADR-064 (consolidación de sub-agents), PRs #464, #466, #552, #553 — al menos 4 sesiones completas y 4 ADRs dedicados a gobernar el sistema de gobernanza. En icarenest, el equivalente fue **un commit** (#8: "nada va directo a main — regla dura en CLAUDE.md").
- **El beneficio no es medible porque el medidor no existe**: el CLAUDE.md promete "scorecard semanal vía `benchmark/score-week.sh`" — **ese directorio no existe en el repo**. El ledger acumula 40 sesiones de `.jsonl` (2.501 eventos) que nada consume. Los eventos `drift_blocked` que sí muestran gates operando son de la era agent-rigor (junio 03–05), ya retirada.
- **La capa desaparece fuera de Claude Code CLI**: en Cowork/chat, superpowers y booster-skills no cargan. El contrato delega su disciplina a un mecanismo que no siempre está presente. Esta sesión es la prueba.
- **Ya ocurrió una vez**: agent-rigor se retiró por exactamente este patrón (mecanismo bespoke, enforcement no operativo de facto). La lección del ADR-060 aplica también a la mitad observacional que sobrevivió.

Conclusión de esta sección: **la disciplina que funciona en booster ya es inline (CI, guards, gates humanos de GitHub); la disciplina delegada a plugins es la que genera costo de mantenimiento sin evidencia de retorno.** La intuición del PO es correcta y la evidencia la respalda.

## 4. Por qué "la base universal" no se transfirió

Existen tres capas y solo una es universal de verdad:

1. **Preferencias de usuario** (BASE + overlays): sí aplican en todo proyecto y superficie. Ya contienen el loop, los ~4 intentos, la escalada clasificada, "salida producida ≠ salida útil". Icarenest las repite; booster las delega.
2. **CLAUDE.md del proyecto**: icarenest lo usa como contrato operativo corto (34 líneas, 100% reglas). Booster lo usa como documento de arquitectura de la gobernanza (349 líneas: ~60% narrativa de plugins, historia de migraciones, instrucciones de instalación). Un contrato que no se puede releer completo en cada sesión no gobierna la sesión.
3. **Enforcement**: icarenest = CI + humano. Booster = CI + humano (funciona) **+ plugins (no verificable)**.

La base universal que Felipe quiso crear existe — es la capa 1 — pero booster la enterró bajo una capa 2 sobredimensionada que además delega a una capa de tooling frágil.

## 5. Decisión mecanismo por mecanismo

### MIGRAR desde icarenest (al nuevo CLAUDE.md de booster)

1. **Contrato corto releíble** (~80–90 líneas máx). La narrativa de plugins sale a `docs/plugins/`; la historia, a los ADRs donde ya vive.
2. **Frontera de decisiones explícita**: qué decide el agente solo / qué NO decide jamás (contratos públicos, ADRs, IAM, quality gates, deuda deliberada). Sustituye las tres secciones actuales de "cuándo pregunto" por una lista literal estilo brief §2.
3. **Un frente por vez + cerrar antes de abrir**: límite duro de WIP (propuesta: máx. 3 PRs propios abiertos; prohibido abrir frente nuevo con un sweep pendiente). Ataca directamente los síntomas de §3.2.
4. **Criterio de salida declarado en `.specs/<slug>/spec.md` ANTES de construir** — la convención ya existe; se convierte en regla de entrada, no de documentación posterior.
5. **TDD con rojo exhibido** en dominio crítico (DTE, factoring, pricing, GLEC, matching, migraciones, auth): el output del test en rojo va en la sección Evidencia del PR. Hoy es una skill del plugin; pasa a ser regla inline verificable por el reviewer humano.
6. **Detenerse y escalar** ante conflicto con un cimiento (ADR o spec aceptada): nunca resolver por criterio propio. Máx. ~4 intentos ante bloqueo, escalada con diagnóstico clasificado.
7. **Lista única de aprobaciones explícitas del PO**: merge a main, migraciones destructivas, deploys, secretos, cambios a CLAUDE.md/ADRs/quality gates/IAM. Hoy está dispersa en 4 secciones.

### MANTENER de booster (funciona, con evidencia)

- Reglas de stack inline (zero `any`, Zod en boundaries, logger estructurado, coverage 80%, secretos en GSM) — condensadas, no diluidas.
- Naming bilingüe y reglas de arquitectura (domain canónico, algoritmos en packages).
- Conventional Commits con scope, PR con sección Evidencia, squash a main.
- `.specs/` como convención de trabajo (reforzada por el punto 4 de arriba).
- CI guards y pre-commit hooks (gitleaks, check-adr-numbering, spec-drift, preflight de secretos) — son el enforcement real.
- Gate humano de deploy (`required_reviewers`) + monitoreo 2h post-deploy.
- ADRs como memoria de decisiones.
- **booster-skills como conocimiento de dominio** (GLEC, matching, deploy Cloud Run, sub-agents de auditoría): es conocimiento empaquetado, no disciplina; útil en Claude Code, inocuo fuera.

### RETIRAR / CORREGIR

- **La delegación de disciplina a superpowers**: el nuevo CLAUDE.md es autosuficiente. Superpowers puede quedar habilitado como refuerzo opcional en CLI (costo cero), pero el contrato deja de asignarle responsabilidades y deja de documentar su instalación. La tabla de "distribución de responsabilidades" desaparece: toda responsabilidad de disciplina es del contrato + CI + PO.
- **El ledger observacional**: 40 sesiones sin consumidor y un scorecard prometido que no existe. Dos opciones honestas: construir `benchmark/score-week.sh` de verdad y usarlo, o retirar los hooks. Recomendación: retirar (segunda iteración del patrón agent-rigor); si más adelante se quiere medición, se diseña con el consumidor primero.
- **Las skills de disciplina del plugin** (`definicion-de-terminado`, `tdd-dominio-critico`): su contenido esencial se inlinea en 5–8 líneas cada una dentro del nuevo CLAUDE.md; las skills pueden quedar en el plugin como material extendido, pero el contrato no depende de ellas.
- **Deuda zombie visible**: cerrar o cerrar-como-wontfix el batch #509–#527, barrer las 37 ramas locales y los 52 stubs con triage único, resolver el `ahead 2` actual. No es parte del contrato pero es la prueba de fuego de la regla de WIP.
- **CURRENT.md**: imponerle presupuesto (p. ej. ≤150 líneas; lo demás va a snapshots fechados que ya existen). Un handoff que requiere reconstrucción arqueológica no es un handoff.

## 6. Recomendación final

Arquitectura de tres capas, cada una con un dueño claro:

| Capa | Contenido | Dueño / dónde vive |
|---|---|---|
| Base universal | Loop, escalada, evidencia, objetividad | Preferencias de usuario (ya existe) |
| Contrato del proyecto | ~80–90 líneas: frontera de decisiones, WIP=un frente, criterios de salida, TDD rojo exhibido, reglas de stack, aprobaciones del PO | `CLAUDE.md` (reescrito estilo icarenest) |
| Enforcement | CI checks, pre-commit guards, branch protection, `required_reviewers` | GitHub/CI (ya existe y funciona) |

Plugins: **booster-skills se mantiene** (dominio + auditoría; retirar sus hooks de ledger en la próxima release), **superpowers queda como refuerzo opcional sin responsabilidades contractuales**.

Ejecución (según las propias reglas de booster): ADR-072 "El contrato de disciplina vuelve inline; los plugins quedan como conocimiento opcional" (supersede ADR-049/060 en lo relativo a responsabilidades), PR con el nuevo CLAUDE.md + el ADR, aprobación explícita del PO (CLAUDE.md es archivo protegido). Borrador del nuevo CLAUDE.md adjunto en `audit-outputs/2026-07-06-propuesta-CLAUDE.md`.

## 7. Límites de este análisis

- No se pudo medir el aporte positivo de superpowers en las sesiones CLI (el ledger no registra causalidad y el scorecard no existe); la recomendación se basa en costo documentado + fragilidad estructural, no en una medición A/B.
- La precisión de icarenest también se explica por factores no portables (greenfield, serialidad, specs congeladas, dominio más acotado); el porte de mecanismos reduce la brecha, no la elimina.
- Los conteos (ramas, stubs, PRs abiertos) son del working tree local al 2026-07-06; el estado remoto puede diferir.
