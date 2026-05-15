# ADR-032 — Compromise del password literal en git history público: decisión Opción C

- Status: Draft (será Accepted al cierre de la implementación correspondiente)
- Date: 2026-05-14
- Author: Felipe Vicencio
- Related: `.specs/security-blocking-hotfixes-2026-05-14/spec.md` (R21, §3 H1.1), ADR-031, ADR-009

## Context

Durante la auditoría de seguridad del 2026-05-14 se identificó que el password literal `Boost***2026!` quedó hardcodeado en código de producción y en docs commiteados a `main` del repositorio `boosterchile/booster-ai` (CI/CD canónico es GitHub — ver memoria interna `reference_cicd_github_canonical.md`).

**Cronología del incidente (estructural, no se confirmó explotación activa):**

| Commit | Fecha | Mensaje |
|---|---|---|
| `8400542` | 2026-05-10 23:01:00 -0400 | feat(demo): seed demo en producción + IMEI espejo (D1) |
| `8afe234` | 2026-05-10 23:13:09 -0400 | docs(handoff): sprint nocturno demo features 2026-05-10 → 11 |
| `03771e9` | 2026-05-10 23:35:17 -0400 | docs(demo): guía completa de uso del demo con todos los usuarios |
| `50671bb` | 2026-05-11 — | feat(rut+stakeholder): RUT canonical sin puntos + user stakeholder en seed |
| `d7085a9` | 2026-05-11 — | feat: sprint demo features Booster — 12 features end-to-end (#157) |
| `7fd623b` | 2026-05-12 — | feat(api): ensureDemoSeeded startup hook |
| `ec86cfd` | 2026-05-13 15:43:57 -0400 | feat(demo): subdominio demo.boosterchile.com operativo con 4 personas click-to-enter (#206) |

**Ventana de exposure**: ~4 días en `main`, 7 commits commiteados a un repo público bajo `boosterchile/booster-ai`.

**Sitios donde apareció el literal** (al momento del audit):
- `apps/api/src/services/seed-demo.ts:86` — constante `DEMO_PASSWORD`.
- `apps/api/src/services/seed-demo-startup.ts:142` — réplica independiente para conductor demo.
- `docs/demo/guia-uso-demo.md` — 7 menciones.
- `docs/handoff/2026-05-11-demo-features-night-sprint.md` — 2 menciones.

**Distribución asumida** (canales por los que el literal salió de la copia local de Felipe):
- Todo clon del repo entre `8400542` y la sanitización.
- CI runners de GitHub Actions (cachean repos por job).
- Cloud Build artifacts del API (el código compilado contiene el literal hasta T6/OPS-1 del plan).
- Backups automáticos de GitHub (típico 90 días retention en planes Team/Enterprise).
- Mirror GitLab (memoria menciona "GitLab está como mirror con CI semi-roto"; el mirror se actualizó al menos parcialmente).
- Agentes de IA con clones cacheados (Cursor, Copilot, ChatGPT con plugins de repo, etc.).

**Naturaleza del compromise**: el literal NO sale del threat surface al borrarlo de HEAD. La rotación de Firebase Auth quema el password viejo en *ese* tenant, pero no impide que un humano que vio el literal lo haya reusado en otra cuenta de prod (e.g. un sysadmin que reusó `Boost***2026!` como password de prueba en `app.boosterchile.com` para un user real).

## Decision

**Se adopta la Opción C**: aceptar compromise permanente del literal + ejecutar password-spray retroactivo universal pre-rotation + monitoreo de spray attacks 90 días post-deploy.

Operacionalmente esto se traduce en:

1. **Pre-rotation (mientras el literal sigue siendo password válido en Firebase)**: `OPS-X-PASSWORD-SPRAY-RETROACTIVE` (definido en `plan.md`). Spray del literal contra TODOS los UIDs no-demo del tenant `booster-ai-494222` (no muestreo, universo completo) vía Identity Toolkit `accounts:signInWithPassword` REST API a `≤2 RPS`. Output documentado en `docs/handoff/2026-05-14-password-spray-result.md`.

2. **Si 0 matches**: incidente cerrado con compromise asumido pero sin víctimas conocidas. Documentar y continuar a rotación (OPS-1 del plan).

3. **Si ≥1 matches**: PAUSA H1 entera. `OPS-X.1-INCIDENT-RESPONSE` se activa: suspender UIDs comprometidos (`auth.updateUser(uid, { disabled: true })`), forzar password reset, notificar a usuarios afectados bajo **Ley N° 19.628** (Protección de la Vida Privada) y **Ley N° 21.719** (Datos Personales — vigente desde noviembre 2024), registrar incidente formal.

4. **Post-deploy (90 días)**: monitoreo con métrica `auth.spray_attack_attempt` y alerta SRE si pico anómalo de intentos contra emails demo o cuentas con patrón análogo.

5. **Rotación de Firebase Auth (OPS-1 del plan)**: ejecutada tras OPS-X. Las 3 cuentas demo reciben password random 128-bit nuevo desde Secret Manager; refresh tokens revocados; claim `expires_at = now + 30 días` (decisión Q16 del spec) seteado para limitar exposure adicional.

## Alternatives considered

### Opción A — Aceptar y solo rotar Firebase

- **Descripción**: borrar el literal del repo, rotar passwords de las 3 cuentas Firebase, asumir residual.
- **Costo**: bajo (es lo que el spec original asumía como R4 residual).
- **Riesgo**: alto. No detecta reuso del password en cuentas no-demo. Si un humano del equipo reutilizó `Boost***2026!` para una cuenta real (e.g. un dev creó un user de prueba con ese password "porque ya estaba en mi clipboard"), esa cuenta queda comprometida indefinidamente y nadie lo sabe.
- **Por qué fue rechazada**: cubre la fuente original pero no las copias derivadas. El compromise por reuso humano no es hipotético — es un patrón observado.

### Opción B — `git filter-repo` (o BFG Repo-Cleaner) para purgar el literal del history

- **Descripción**: reescribir los 7 commits eliminando todas las ocurrencias del literal; force-push a `main`; coordinar re-clone con todo el equipo + agentes IA.
- **Costo**: alto.
  - Reescribe SHAs de 7 commits → todas las referencias en handoffs, PRs en revisión, scripts que pinneen commit, ledger entries de agent-rigor, etc. quedan rotas.
  - Invalida firmas GPG/SSH de commits firmados (memoria menciona que el repo usa hooks de signing por default).
  - Fuerza re-clone a todo colaborador. Agentes IA con clones cacheados (Cursor, Copilot, ChatGPT plugins) pueden mantener referencias stale.
  - GitHub no garantiza purga de forks ni de backups; el literal puede seguir en snapshots forenses.
  - No mitiga el riesgo real (humano que reutilizó el password en otra cuenta).
- **Por qué fue rechazada**:
  - El costo de coordinación es desproporcionado al beneficio.
  - **No resuelve el threat actor real** (reuso humano del password en otra cuenta de prod). Filter-repo limpia el repo pero no limpia las memorias humanas.
  - La opción "limpia visualmente" pero introduce inestabilidad operativa (broken refs en docs/handoffs, agentes IA leyendo SHAs viejos).
  - La amenaza fundamental — que un humano memorizó el password y lo reutilizó en cuenta real — solo se detecta con password-spray (Opción C).

### Opción C — Compromise permanente + spray retroactivo universal + monitoring 90d *[elegida]*

- **Descripción**: aceptar que el literal está irrecuperablemente distribuido (R21 residual asumido), pero ejecutar spray retroactivo PRE-rotation para detectar reuso real en cuentas no-demo del tenant. Post-rotation, monitorear 90 días para detectar intentos futuros.
- **Costo**: medio.
  - Tiempo de ejecución del spray: ~N UIDs × 0.5s/call = aprox 10 min para un tenant con ~1000 UIDs no-demo (escalable).
  - Tiempo de monitoreo: cron de métrica + alert policy ya parte de la infra existente.
  - Trabajo coordinado dentro del plan v2 sin tocar git history.
- **Riesgo residual**: bajo-medio.
  - Si el spray encuentra match → escalada a incident response inmediata (R17). Mejor que no saber.
  - Si el spray no encuentra match → asumido razonable que nadie reutilizó el literal externamente. La ventana de 4 días + 3-5 colaboradores humanos hace esto plausible pero no certero.
  - Post-90d sin alerts → cierre formal del residual.
- **Por qué fue elegida**:
  - **Detecta la amenaza real** (reuso humano) sin costo de coordinación de filter-repo.
  - Preserva la integridad del history (commits, signatures, referencias en docs/handoffs).
  - Compatible con agentes IA y CI/CD existente.
  - Acepta honestamente que el compromise estructural ocurrió y se mitiga con detección, no con borrado simbólico.

## Consequences

### Positivas

- El residual queda **detectable**, no asumido a ciegas.
- No se rompen referencias en handoffs, ledger entries, ni clones de equipo/agentes.
- La rotación Firebase + TTL 30d + `is_demo` enforcement (resto del spec) son condiciones suficientes asumiendo OPS-X retorna 0 matches.
- Documentación explícita del incidente sirve como precedente para futuros casos.

### Negativas

- El literal vive permanentemente en git history. Cualquier auditor futuro con acceso al repo lo encontrará. La justificación debe estar accesible (este ADR es el puntero canónico).
- Si en el futuro emergen evidencias de explotación (acceso a logs históricos, victim report), este ADR debe ser reevaluado y potencialmente superseder por una variante que escale a filter-repo + revelación.
- El monitoring de 90 días requiere infraestructura activa; si se desmantela antes, la decisión "post-90d sin alerts = cierre" queda en falso.

### Operativas

- OPS-X del plan v2 implementa la acción.
- Resultado en `docs/handoff/2026-05-14-password-spray-result.md`.
- Métrica + alerta para los 90 días en `infrastructure/monitoring.tf`.
- Si el spray retorna ≥1 match, **este ADR se supersede** con una nueva ADR que documente el incident response real (no la decisión preventiva).

## Cross-references

- `R21` en `.specs/security-blocking-hotfixes-2026-05-14/spec.md` §9 — registro formal del riesgo.
- `OPS-X-PASSWORD-SPRAY-RETROACTIVE` en `.specs/security-blocking-hotfixes-2026-05-14/plan.md` — implementación.
- ADR-031 — Retention Lock DTE (otro caso de decisión irreversible en este mismo ciclo de hotfixes).
- ADR-009 — Servicios server-to-server con ADC/OAuth (contexto: por qué API keys son legacy; el literal demo fue una excepción que se cierra acá).
- Ley N° 19.628 (Protección de la Vida Privada), Ley N° 21.719 (Datos Personales) — marco regulatorio si OPS-X retorna match positivo.
