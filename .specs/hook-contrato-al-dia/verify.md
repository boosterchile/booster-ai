# Verify — hook contrato al día

**Fecha**: 2026-08-03 · **PR**: [#647](https://github.com/boosterchile/booster-ai/pull/647) (mergeado) · **Commit**: `23fb6f9` → squash `32337e9` en `main`

Evidencia de los 7 criterios de [`spec.md`](spec.md) §4. Salidas transcritas de
la corrida real, no reconstruidas.

## Sintaxis

```
$ bash -n .claude/hooks/check-contrato-al-dia.sh
OK sintaxis
```

## C1 · Clon al día → silencio

```
$ cd ~/booster-ai && bash .claude/hooks/check-contrato-al-dia.sh
rama: chore/hook-contrato-al-dia
[exit=0]        ← sin salida
```

## C2 · Clon rezagado → aviso

`~/Developer/booster-ai`, HEAD `ca8ad4a` del 2026-06-14.

```
rama: fix/sse-stream-ticket-x-empresa-id · HEAD: ca8ad4a 2026-06-14
AVISO: CLAUDE.md cambió en github/main y este clon no lo tiene (/Users/felipevicencio/Developer/booster-ai)
       b91a39f (2026-08-03) Chore/corregir contratos (#646)
       Trae el cambio antes de operar: git merge github/main
AVISO: AGENTS.md cambió en github/main y este clon no lo tiene (/Users/felipevicencio/Developer/booster-ai)
       b91a39f (2026-08-03) Chore/corregir contratos (#646)
       Trae el cambio antes de operar: git merge github/main
[exit=0]
```

Este clon tiene dos remotos —`origin` → GitLab, `github` → GitHub— y el hook
eligió `github`. Cubre §2.3: la resolución por URL funciona donde la resolución
por nombre habría fallado.

## C3 · Rama que edita el contrato → silencio

El falso positivo que motivó el cambio. Probado en un clon desechable con remoto
apuntado al canónico, para no tocar el `CLAUDE.md` real:

```
rama: feat/edito-el-contrato
CLAUDE.md difiere de main? -> SÍ, difiere
[exit=0]        ← sin salida
```

El archivo difiere del remoto y el hook calla. Con el criterio anterior habría
avisado en cada sesión de esa rama.

## C4 · No pude verificar ≠ al día

Cubierto por inspección de las tres ramas de salida, no por ejecución: forzar un
`fetch` fallido o un clon shallow exigía degradar red o fabricar un repo
truncado. Las tres rutas escriben a stdout antes de `exit 0`:

- remoto no identificado → `AVISO: no identifico el remoto canónico`
- `fetch` fallido → `AVISO: fetch a '<remoto>' falló ... contratos NO verificados`
- `merge-base` con exit >1 → `AVISO: no pude comparar ... contrato NO verificado`

**Deuda declarada**: C4 es el único criterio sin ejecución real.

## C5 · El hook se ejecuta al iniciar sesión

Primer intento **descartado por inconcluyente**: `claude --debug -p` no emite
nada sobre hooks ni con `2>&1` — el log quedó en una sola línea (`ok`). Ausencia
de log no prueba que el hook no corriera.

Método que sí concluye — centinela temporal en el comando del hook:

```
$ claude -p "responde solo: ok"
$ cat hook-check.txt
CENTINELA Mon Aug  3 23:21:59 -04 2026 cwd=/Users/felipevicencio/booster-ai
→ EL HOOK SÍ SE EJECUTÓ AL INICIAR SESIÓN
```

Centinela removido después: `grep -c CENTINELA .claude/settings.json` → `0`.

(De paso: `timeout 180 claude ...` salió con **127** porque macOS BSD no trae
`timeout` — no era el hook.)

## C6 · El script dejó de estar ignorado

```
$ git check-ignore -v .claude/hooks/check-contrato-al-dia.sh
(sin match) → git ya lo puede versionar
```

Antes emparejaba `.gitignore:136:.claude/*`.

## C7 · `settings.json` solo agrega el bloque `hooks`

```
$ jq -e '.hooks.SessionStart[].hooks[] | select(.type=="command") | .command' .claude/settings.json
"\"$CLAUDE_PROJECT_DIR/.claude/hooks/check-contrato-al-dia.sh\""
[exit=0]
```

El diff contra `main` agrega únicamente el bloque `hooks`;
`extraKnownMarketplaces` y `enabledPlugins` quedan intactos. Biome corrió sobre
el archivo en el pre-commit (lint-staged) y no lo reformateó.

## Gates

**Pre-commit**: gitleaks (0 leaks) · Biome vía lint-staged · check-adr-numbering.

**CI**: **23/23 verdes**, `mergeStateStatus=CLEAN`.

```
total=23 · pass=23 · fail=0 · pending=0
```

Incluye Trivy (fs + config), CodeQL, Docker build + smoke (api), Integration
tests (DB + Redis), Test + Coverage (≥80%), Typecheck y Lint.

No aplican `tests`/`build` propios: el entregable es un script bash de tooling
del agente, fuera de `apps/` y `packages/`.
