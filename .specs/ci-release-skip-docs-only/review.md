# Devils-advocate review — ci-release-skip-docs-only — 2026-06-06T00:00:00Z

## Premise
- Asumido: que el deploy de produccion se origina SIEMPRE desde un push con archivos de codigo/infra "no-docs". Si esa premisa falla, el filtro silencia un deploy real.
- Asumido: que el run docs-only es "no-op". Pero el job `version-or-publish` NO es no-op para docs: corre `changeset publish` y puede publicar paquetes con changesets pendientes acumulados.
- Mas doloroso si es falso: el caso del PR "Version Packages" de Changesets (ver Failure modes F1). Ese merge puede tocar solo `package.json` + `CHANGELOG.md` + borrado de `.changeset/*.md`.

## Scope and second-order effects
- El filtro mata el workflow COMPLETO, no solo `deploy-production`. Eso incluye `version-or-publish`. Consecuencia no consultada: si alguien acumula changesets y luego hace un push docs-only encima de un estado con changesets pendientes, ese push no avanza el pipeline de publish. (Atenuado: un push con changeset toca `.changeset/*.md` que NO esta ignorado; pero ver F1 sobre el flujo de 2 fases.)
- Hyrum's Law: hoy algo puede depender de que "todo merge a main produce un run de release.yml" como senal observable (badge, auditoria de compliance, "cada cambio a prod tiene un run"). Tras el cambio, los merges docs-only desaparecen del historial de Actions. Para un repo con objetivo TRL 10 / compliance, perder la traza "este merge no toco prod" puede importar. No se documento.
- `.github/workflows/*.yml` NO esta en la denylist: un push que solo edita workflows dispara release. Correcto (falla seguro), pero significa que editar este mismo archivo dispara un deploy real no-op. No mencionado.

## Alternatives discarded
- Considerado en spec: `paths` allowlist (rechazado por riesgo de olvido que produciria el fallo peligroso). Rechazo bien fundado y documentado. Direccion correcta.
- NO considerado (debio serlo): filtro a nivel de JOB (`if:` sobre `deploy-production`) en vez de workflow-level paths-ignore. Diferencia material: con `if:` el run SI aparece en Actions (traza de compliance preservada) y `version-or-publish` siempre corre (Changesets nunca se salta), mientras `deploy-production` se skipea condicionalmente. paths-ignore sacrifica ambas cosas. El spec descarta job-level diciendo "es la unica forma soportada por GitHub para paths-ignore": eso es un strawman. La alternativa real no es job-level paths-ignore, es job-level `if` alimentado por `dorny/paths-filter` o `tj-actions/changed-files`. No fue evaluada.
- NO considerado: guard explicito via mensaje de commit. Menor, pero es alternativa.

## Failure modes
- F1 (CRITICO conceptual, OK en estado actual): Changesets opera en dos fases. Fase A: merge de feature (codigo + `.changeset/x.md`) dispara release y la action crea/actualiza el PR "chore(release): version packages" (NO publica). Fase B: merge de ESE PR de version a main debe disparar release de nuevo para que `changeset publish` corra. El diff del PR de version contiene `package.json`, `**/package.json`, `**/CHANGELOG.md` y el borrado de `.changeset/x.md`. Verifique: `.changeset/config.json` tiene `"commit": false`, asi que el bot NO auto-commitea; el merge es manual (squash). Ese squash toca `package.json` (no ignorado), por lo que SI dispara. Hoy funciona. Riesgo residual: la matriz de verify.md NO incluye el caso "merge del PR Version Packages", que es el path por el cual se publica. Si en el futuro los CHANGELOG generados se reubicaran a una ruta ignorada se romperia silenciosamente. Deteccion: ninguna automatica; se notaria cuando un consumidor falle por paquete no publicado.
- F2 (push directo a main): la doc de GitHub indica que para pushes a branches existentes el filtro usa diff head-vs-base de los SHAs del push. Con squash merge (1 commit) es seguro. Pero `git log` muestra commits directos a main sin numero de PR (`b6132d4 chore(ci): bump release NODE_VERSION`, `5c8c00b`, etc.), lo que sugiere pushes directos fuera del flujo squash-PR. Un push directo docs-only a main ahora NO se registra como run. Deteccion: ninguna. Riesgo bajo, pero contradice el supuesto R3 "squash merge = 1 commit con el diff completo".
- F3 (perdida de heartbeat): hoy un merge docs-only fuerza un re-deploy que reejecuta canary + smoke test, actuando como heartbeat accidental de que prod responde. Tras el cambio se pierde. No es funcion disenada; alguien podria depender de ella. Cost: bajo. Deteccion: ninguna.

## Reversibility
- Costo de deshacer en 30 dias: trivial. Borrar el bloque `paths-ignore` (6 lineas) y commitear. Sin migracion, sin estado persistente, sin flag necesario.
- Mecanismo de reversa: revert del commit. De los cambios mas reversibles posibles. Mayor fortaleza del cambio.

## Drift signals
- Comentario preexistente sobre el job deploy-staging (linea 72): fuera de este cambio, no objetable aqui.
- El spec usa "Bajo/nulo" en R3. "nulo" es una afirmacion de certeza no justificada: F2 muestra que NO es nulo si hay pushes directos a main. Reclasificar R3 a "Bajo, asume 100% squash-PR".
- No hay marcadores de deuda sin ticket en el cambio. V4 queda como verificacion observacional post-merge: aceptable por su naturaleza, pero NO hay issue ni owner que la fuerce. Un V4 sin owner es un control latente que nadie ejecutara.

## Evidence quality
- Claim "`*.md` no matchea `.changeset/*.md`" -> Evidence: doc oficial GitHub confirma que `*` no cruza `/`; verifique que `.changeset/` contiene README.md+config.json y los changesets viven en `.changeset/<nombre>.md` (un nivel de dir) -> SUFICIENTE. SC-3 sostiene.
- Claim "es no-op" -> Evidence: ninguna sobre `version-or-publish`. Verifique que hoy no hay changesets pendientes ni CHANGELOG.md generado, o sea el pipeline de publish probablemente nunca se ejercio -> DEBIL. "no-op" se sostiene por estado actual accidental, no por diseno.
- Claim "ningun paso de build consume docs/**, *.md root" -> Evidence: grepe referencias a README/CLAUDE/AGENTS.md; todas son comentarios, ninguna es input de build -> SUFICIENTE.
- Claim SC-4 "no altera required checks" -> Evidence: confirme que el required check es `CI Success` de ci.yml (linea 225); release.yml no expone checks required; ci.yml tiene su propio trigger sin paths-ignore -> SUFICIENTE. SC-4 sostiene.
- Claim "4/5 runs docs-only" -> Evidence: cita run IDs pero no los verifique contra la API de Actions -> DEBIL pero plausible, no load-bearing.

## Verdict
- Veredicto: APPROVE_WITH_RESERVATIONS.
- Objeciones fuertes (atender o documentar como riesgo aceptado):
  1. [P1] La alternativa real (job-level `if:` con changed-files) NO fue evaluada; preserva traza en Actions y nunca salta Changesets. El spec la descarto con un strawman. Documentar por que workflow-level gana pese a sacrificar traza de compliance + ejecucion incondicional de Changesets.
  2. [P1] El caso "merge del PR Version Packages" (flujo 2 fases) NO esta en la matriz de verify.md. Es el path por el que se publica. Agregar fila.
  3. [P2] R3: "nulo" es falso si existen pushes directos docs-only a main (git log sugiere que ocurren). Cambiar a "Bajo, asume squash-PR".
  4. [P2] V4 sin owner/ticket: nadie esta obligado a verificar post-merge que un PR con codigo si disparo. Crear follow-up.
- Riesgos residuales (aceptar y documentar):
  - Perdida de la traza "cada merge a main tiene un run de release" (compliance TRL 10).
  - Perdida del heartbeat accidental de prod en merges docs-only.
- Fuera de alcance: `cancel-in-progress:false`, canary placeholder (`exit 0`), gate de approval (preexistentes).
- NO hay objecion P0 bloqueante: la direccion (denylist falla-seguro) es correcta, el glob es correcto, SC-4 sostiene, y el cambio es trivialmente reversible.
