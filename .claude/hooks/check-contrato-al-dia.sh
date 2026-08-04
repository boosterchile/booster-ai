#!/bin/bash
# Avisa si CLAUDE.md o AGENTS.md de la rama principal remota traen cambios que
# este clon todavía no tiene. Detecta clones paralelos y worktrees rezagados.
#
# Criterio: ASCENDENCIA, no diferencia de contenido. El aviso salta solo si el
# último commit que tocó el contrato en el remoto NO es ancestro de HEAD.
# Editar el contrato en una rama de trabajo NO dispara aviso: ese commit remoto
# sigue siendo ancestro por más que el archivo difiera en el working tree.
#
# Distingue "al día" de "no pude verificar": el silencio solo significa lo primero.

root="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
cd "$root" || exit 0

# Resuelve el remoto por URL, no por nombre: puede llamarse origin, github, upstream.
remoto="$(git remote -v | awk '/boosterchile\/booster-ai.*\(fetch\)/ {print $1; exit}')"
if [ -z "$remoto" ]; then
  echo "AVISO: no identifico el remoto canónico en $root — no puedo verificar los contratos."
  exit 0
fi

if ! git fetch -q "$remoto" main 2>/dev/null; then
  echo "AVISO: fetch a '$remoto' falló en $root — contratos NO verificados."
  echo "       Puede ser red, credenciales o remoto mal configurado. No asumas que están al día."
  exit 0
fi

cabeza="$(git rev-parse FETCH_HEAD 2>/dev/null)"
if [ -z "$cabeza" ]; then
  echo "AVISO: no pude resolver FETCH_HEAD en $root — contratos NO verificados."
  exit 0
fi

for f in CLAUDE.md AGENTS.md; do
  # Último commit del remoto que tocó el archivo. Vacío = no existe allá, nada que comparar.
  ultimo="$(git rev-list -1 "$cabeza" -- "$f")"
  [ -n "$ultimo" ] || continue

  # 0 = ya lo tenemos · 1 = rezagado · >1 = git no pudo decidir (p.ej. clon shallow)
  git merge-base --is-ancestor "$ultimo" HEAD 2>/dev/null
  case $? in
    0) ;;
    1)
      echo "AVISO: $f cambió en $remoto/main y este clon no lo tiene ($root)"
      echo "       $(git log -1 --format='%h (%ad) %s' --date=short "$ultimo")"
      echo "       Trae el cambio antes de operar: git merge $remoto/main"
      ;;
    *)
      echo "AVISO: no pude comparar $f contra $remoto/main en $root — contrato NO verificado."
      echo "       Puede ser un clon shallow o un HEAD sin commits."
      ;;
  esac
done
exit 0
