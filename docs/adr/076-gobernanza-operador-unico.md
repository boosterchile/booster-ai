# ADR-076 — Gobernanza para operador único: estados de vigencia y protección de rama por checks

**Estado**: Vigente
**Fecha**: 2026-08-16
**Decider**: Felipe Vicencio (Product Owner)
**Supersede en gobernanza a**: el ciclo `Proposed → Accepted` usado en ADR-001..075 (las decisiones técnicas de esos ADR siguen intactas; solo cambia el vocabulario de estado)
**Related**: `docs/frentes-vivos.md` (PR #655), ADR-072 (disciplina inline en `CLAUDE.md` + CI + gates humanos), política de protección de `main`

---

## Contexto

El repo opera con un ciclo de estados de ADR heredado de equipos con varias personas: `Proposed → Accepted`. Ese ciclo presupone un aprobador distinto del proponente. En Booster AI no existe: hay un solo operador, que es a la vez autor, revisor y decisor.

La consecuencia no es que el proceso sea lento; es que **el estado dejó de significar algo**. `Proposed` no indica "pendiente de aprobación" —nadie va a aprobar— sino "no sé si esto rige". Casos verificados al 2026-08-16:

- **ADR-054** (blocking function Gen 1 para el gate de signup Google) quedó en `Proposed`. La ruta fue abandonada el 2026-05-29 a favor de la Alternativa G (enforcement en el límite de API + reaper de cuentas inertes), que se entregó a producción el 2026-06-05 con `SC-1.2.2 Google leg = MET`. El ADR nunca registró el abandono. Entre tanto acumuló ~184 referencias en `.specs/` y `docs/`, cada una apuntando a una decisión muerta.
- **ADR-049** (adopción de plugins de Claude Code) fue superado en responsabilidades por ADR-072, pero conserva ~197 referencias sin redirección.
- **ADR-075** (migración a pnpm 10) sigue en `Proposed` pese a que el trabajo se mergeó en PR #610 y está en producción.

En paralelo, la protección de `main` exige aprobación humana. Como no hay segundo humano, la única vía de merge es `gh pr merge --admin`. Eso es peor que no tener protección: normaliza el bypass. En PR #655, los 23 checks pasaron y el merge se bloqueó igual, por una condición que ningún trabajo futuro podrá satisfacer.

## Decisión

**1. Los estados de ADR pasan a ser de vigencia, no de autorización.** Tres valores, sin firma:

- **`Vigente`** — esta decisión rige hoy.
- **`Superado por ADR-NNN`** — el puntero es obligatorio. Sin puntero el estado es inválido.
- **`No perseguido`** — se evaluó y se descartó. Requiere una línea con la razón y, si aplica, la alternativa elegida.

No hay estado intermedio. Un ADR sin decisión tomada no es un ADR: es una nota de exploración y vive en `.specs/`.

**2. La protección de `main` deja de exigir aprobación y pasa a exigir checks.** Se eliminan los revisores requeridos; se marcan como obligatorios los checks que verifican de forma determinista —`CI/Typecheck`, `CI/Test + Coverage (≥80%)`, `CI/Lint`, `CI/Migration safety`, `Security/Gitleaks`, `Security/CodeQL`, `Security/Trivy`, `Security/npm audit`, `Security/route default-deny harness`—. `--admin` vuelve a ser excepcional y cada uso queda como señal de que algo anómalo pasó.

**3. Las acciones irreversibles conservan gate, con otra forma.** Para `terraform apply` en producción, migraciones `contract` y el modo destructivo del reaper (`REAPER_DESTRUCTIVE=true`), el freno no es la aprobación de un tercero sino **evidencia previa**: lista de verificación escrita antes de ejecutar, y corrida en seco con su salida registrada. Es el patrón que ya se aplicó al reaper (dry-run `scanned=14, skip=14, disable=0, delete=0`, 2026-06-05) y se formaliza aquí como norma.

## Consecuencias

**Positivas.** El estado de un ADR responde la pregunta que efectivamente se hace al abrirlo. Las referencias cruzadas dejan de apuntar a decisiones muertas sin aviso. El merge deja de depender de un bypass rutinario. El rigor se concentra donde es irreversible en vez de repartirse plano sobre todo.

**Negativas.** Se pierde el registro de "esto se propuso y aún no se decide". A cambio se gana que ese caso ya no viva en `docs/adr/`: si no hay decisión, es exploración y va en `.specs/`.

**Costo de migración.** Los ADR existentes se migran al nuevo vocabulario dentro del Slot 3 (cierre documental de SEC-001), no como frente nuevo. Prioridad por número de referencias:

| ADR | Estado destino | Nota |
|---|---|---|
| ADR-054 | `No perseguido` | Migración a Gen 2 descartada; sustituida por la Alternativa G, entregada 2026-06-05 |
| ADR-049 | `Superado por ADR-072` | En responsabilidades de disciplina |
| ADR-075 | `Vigente` | El trabajo se mergeó en PR #610 |
| ADR-052 | verificar | ~310 referencias; el mayor volumen del repo |
| resto en `Proposed` | uno de los tres | barrido único |

## Verificación

```bash
# Ningún ADR queda en el vocabulario viejo
grep -rl '^\*\*Estado\*\*: *\(Proposed\|Accepted\)' docs/adr/ | wc -l   # esperado: 0

# Todo "Superado por" trae puntero resoluble
grep -rhno 'Superado por ADR-[0-9]\{3\}' docs/adr/ | grep -o 'ADR-[0-9]\{3\}' | sort -u \
  | while read a; do ls docs/adr/${a#ADR-}-*.md >/dev/null 2>&1 || echo "PUNTERO ROTO: $a"; done
```

Conviene agregar la primera comprobación al hook de pre-commit, junto a `check-adr-numbering`.
