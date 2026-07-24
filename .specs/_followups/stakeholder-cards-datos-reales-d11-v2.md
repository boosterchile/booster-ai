# Follow-up: cards de stakeholder con datos reales (rehacer bajo D11 v2)

**Origen**: cierre de **PR #256** (`feat/d11-t11-ui-cards-reales`, T11) en el triage de rezagados del 2026-07-24. Se cerró **sin merge por irrescatable**; la **feature NO está hecha** — este stub evita que el cierre se lea como "entregado".

## Deuda viva en main

`apps/web/.../stakeholder-zonas.tsx` sigue mostrando **`ZONAS_DEMO`** (curaduría editorial hardcodeada) + banner amarillo "Datos demo". Eso está en main **a propósito**: cerrar #256 no lo reemplazó por nada. Encaja con la deuda general de [[demo-subsystem-debt]] (retirar el subsistema demo con el go-live de carriers reales).

## Por qué #256 no se pudo rescatar

1. Su diseño era **D11 v1**, que fue **BLOQUEADO en review** (10 BLOCKING de `code-reviewer` + `ux-designer`) y re-planeado como **D11 v2** — #253/#258/#265/#267, **todos merged** (verificado 2026-07-24).
2. Estaba **apilado sobre `feat/d11-t10-ui-drill-down`** = rama de **PR #255, cerrado sin merge** → base huérfana, no ancestro de main.
3. Sus dependencias **no existen en main**: el endpoint lista `GET /stakeholder/zonas` (T8, abortado) y la ruta `/app/stakeholder/zonas/$slug` (T10).
4. El diff "+176/−397" era contra esa base fantasma; **contra main real son ~1157 archivos** que revertirían trabajo vivo (la rama cuelga de un main de ~2 meses atrás).

## Cómo se retoma

**Rehacer limpio bajo D11 v2**, no rescatar la rama. Lo que sigue siendo válido de #256 es la *intención*, no el código:

- Reemplazar `ZONAS_DEMO` por datos reales servidos por el backend de **D11 v2** (verificar primero qué endpoint expone v2 hoy — el `GET /stakeholder/zonas` de T8 fue abortado).
- Estados explícitos loading / error / empty / data, y **"Sin data suficiente"** en celdas sin muestra (v1 usaba `viajes_30d: null` como señal).
- Sustituir el banner "Datos demo" por la nota neutra con link al ADR correspondiente **solo cuando** los datos sean reales.
- Drill-down por zona: depende de que exista la ruta de detalle en v2 (en v1 era T10/#255, que nunca entró).

Antes de construir, leer los cimientos vigentes (todos en main, verificado 2026-07-24):

- **ADR-042** (Accepted) — filtro por `originComunaCode` + alineación schema/domain; supersede parcialmente ADR-041 (mantiene k-anonymity, ventana 30d y el proceso "nueva zona").
- `docs/specs/2026-05-11-stakeholder-geo-aggregations-d11.md` (spec D11).
- `docs/plans/2026-05-17-d11-stakeholder-geo-aggregations.md` — **plan v1, status BLOCKED**: es el plan que este PR implementaba. No usarlo como guía sin re-planear.

⚠️ Corrección al reporte de triage: éste anotaba "pending ADR-043"; **ADR-043 está Accepted** y trata de drift schema↔domain, no del contrato de D11.

## Estado

- **ABIERTO** — feature pendiente, sin PR asociado. Rama remota `feat/d11-t11-ui-cards-reales` viva (no borrada) solo como referencia histórica; **no** rebasear desde ahí.
