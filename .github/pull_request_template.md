# Pull Request

## Resumen

<!-- 1-3 líneas: qué cambia y por qué. -->

## Tipo de cambio

- [ ] feat (nueva funcionalidad)
- [ ] fix (bug)
- [ ] refactor (sin cambio funcional)
- [ ] perf (optimización)
- [ ] test (añadir/editar tests)
- [ ] docs (solo documentación)
- [ ] chore (mantenimiento)
- [ ] security (fix de seguridad)

## Spec + Plan + Skill

- Spec: `docs/specs/<fecha>-<slug>.md` (si aplica)
- ADR relevante: `docs/adr/<NNN>-<slug>.md`
- Skill invocado: `skills/<name>/SKILL.md`

## Cambios

<!-- Lista breve de archivos/módulos tocados con 1 línea cada uno. -->

## Evidencia (OBLIGATORIO antes de merge)

### Tests
```
<!-- Pega aquí el output de `pnpm test` (resumen, no todo). -->
```

### Typecheck + Lint
```
<!-- Output de `pnpm typecheck` y `pnpm lint`. -->
```

### Build
```
<!-- Output de `pnpm build` (success). -->
```

### Coverage
```
<!-- Resumen de coverage del código tocado. Mínimo 80% líneas. -->
```

### Manual verification (si aplica)

<!-- Screenshots, curl output, trace de Cloud Trace, etc. -->

## Plan de rollback

<!-- Si esto se rompe en producción, ¿cómo lo reviertes? -->

## Impacto operacional

- [ ] Observabilidad: logs estructurados + trace + métrica custom
- [ ] Alertas nuevas / SLOs afectados documentados
- [ ] Runbook actualizado si aplica
- [ ] DB migration con down migration probada (si aplica)
- [ ] Feature flag por defecto OFF (si aplica)

## Seguridad

- [ ] Sin secretos en código (gitleaks CI pasó)
- [ ] Validación Zod en boundaries nuevos
- [ ] Authz verificada en endpoints nuevos
- [ ] Logs redactados para PII si procesa datos sensibles
- [ ] Sin dependencias nuevas con CVEs HIGH/CRITICAL abiertas

## Compliance Chile (si aplica)

- [ ] Ley 19.628 — consent + retención + redaction
- [ ] SII — DTE con retention lock + firma + hash
- [ ] Documentos legales con estructura conforme Ley 18.290

## Reviewer checklist

Por el reviewer (code-reviewer + security-auditor + sre-oncall según aplique):

- [ ] ADR compliance
- [ ] Type safety end-to-end
- [ ] Tests deterministas + edge cases
- [ ] Performance (sin N+1, índices usados)
- [ ] A11y (si hay UI)

---

🤖 Generado siguiendo el flujo `/spec → /plan → /build → /test → /review → /ship` definido en `.claude/commands/`.
