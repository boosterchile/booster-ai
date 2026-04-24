---
description: Ejecutar la suite de tests y verificar contra exit criteria del spec
---

# /test — Suite de tests + verificación

Después de `/build`, ejecuta tests y verifica que los exit criteria del spec se cumplen con evidencia.

## Proceso

1. **Ejecutar suite completa**:
   ```bash
   pnpm ci   # lint + typecheck + test + coverage + build
   ```
2. **Si falla**: volver a `/build` a corregir. No avanzar con fails.
3. **Verificar coverage** del código nuevo: debe ser ≥80% en líneas, ramas y funciones.
4. **Correr tests E2E** relevantes:
   ```bash
   pnpm --filter @booster-ai/web test:e2e -- --grep "<related-feature>"
   ```
5. **Verificar contra cada exit criterion del spec**:
   - Para cada criterio, generar evidencia concreta (output de test, screenshot, curl, trace).
   - Pegar evidencia en el PR description en sección "Evidencia".
6. **Smoke test manual** (si aplica, features con UI): abrir la PWA en modo dev y probar el flujo.

## Anti-rationalizations

| Tentación | Por qué es un error |
|-----------|---------------------|
| "Tests fallan solo por timeout, no es mi cambio" | Investigar siempre. Los tests flakey tapan regresiones reales. |
| "Coverage 79% es casi 80%" | El gate es 80%. Sube o deja documentado por qué no. |
| "No hice E2E porque ya hay unit tests" | E2E cubre integraciones que los unit tests no. |

## Exit criteria

- [ ] `pnpm ci` pasa completamente
- [ ] Coverage ≥80% en el código tocado
- [ ] Tests E2E relevantes pasan
- [ ] PR description tiene sección "Evidencia" con output concreto por cada criterio del spec
- [ ] Smoke test manual ejecutado si hay UI
