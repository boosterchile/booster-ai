---
description: Code review formal usando agent code-reviewer
---

# /review — Code review formal

Antes de hacer merge, invoca al agent `code-reviewer` para una revisión estructurada. El review NO es opcional ni para features pequeñas.

## Proceso

1. **PR listo y tests pasando** (después de `/test`).
2. **Invocar agent code-reviewer** con contexto:
   - URL del PR
   - Spec + plan asociados
   - Archivos tocados
3. El agent revisará contra `references/code-review-checklist.md` y emitirá:
   - Issues bloqueantes (deben resolverse antes de merge)
   - Sugerencias (mejoras recomendadas pero no bloqueantes)
   - Aprobación o rechazo
4. **Para cambios de seguridad** (auth, permisos, crypto, secrets, compliance): también invocar `security-auditor`.
5. **Para cambios de infra**: también invocar `devops-sre`.
6. **Resolver todos los bloqueantes** en nuevos commits, no force-push (mantener historial del review).
7. **Re-review** si hubo cambios no triviales.

## Lo que el revisor chequea

- ADR compliance (¿el cambio respeta los ADRs relevantes?)
- Type safety (sin `any` no justificado)
- Observabilidad (logs + traces + métricas donde corresponde)
- Tests (cobertura + casos edge + tests deterministas)
- Performance (consultas a BD eficientes, sin N+1)
- Security (Zod en boundaries, sin secretos, sin eval)
- A11y si hay UI (axe-core pasa)
- Documentación (comentarios donde la lógica no es obvia, README actualizado si aplica)

## Exit criteria

- [ ] code-reviewer aprobó
- [ ] security-auditor aprobó (si aplica)
- [ ] devops-sre aprobó (si aplica)
- [ ] 0 bloqueantes abiertos
- [ ] Al menos 1 aprobación humana además de los agents
