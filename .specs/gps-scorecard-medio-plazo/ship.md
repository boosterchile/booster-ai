# Ship — scorecard GPS de medio plazo

No hay deploy. El merge no publica nada (`release.yml` es `workflow_dispatch`).
Nada llama `cargarScorecardMedioPlazo` desde un request: hasta que alguien lo
invoque, producción no cambia.

Rollback: revertir el PR. No hay migración ni secretos.
