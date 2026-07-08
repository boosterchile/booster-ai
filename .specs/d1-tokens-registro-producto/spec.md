# D1 — Tokens formalizados del registro "producto"

**Estado**: en definición (H1 = plan de arquitectura, pendiente OK del PO antes de ejecutar).
**Ancla**: implementa las decisiones **D-3 / D-4 / D-5** del `DESIGN.md` (en main). El agente implementa, no define identidad.

## Decisiones de identidad FIJADAS por el PO (no re-decidir)

- **Base**: neutrales **cálidos** ya existentes en `ui-tokens` (beige `#FAF9F7` y familia). Reusar.
- **Primario**: **neutral oscuro** (botones carbón). El color NO es el primario — solo aparece en semántica y en el acento. Máxima sobriedad.
- **Semánticos**: los estándar (success/warning/danger/info), ya en `ui-tokens`. Requisito: el verde `success` debe ser **distinguible** del verde que el `DESIGN.md` reserva como registro **ambiental**.
- **Acento customizable**: **7 presets**, cada uno rampa completa (50→900). Default = **Índigo**. Los 7: Índigo, Azul océano, Terracota, Ciruela, Pizarra (azul-gris), Cobalto (azul brillante), Berenjena (violeta oscuro). Ninguno verde, ninguno fucsia, ninguno colisiona con semánticos. Nombres/familias = PO; **hex exactos los genera y verifica el agente**.

## Requisitos duros

1. **Contraste WCAG por construcción** (test que corre en CI y falla si algún par no pasa):
   - Botón (stop ~600) + texto **blanco** → ≥ 4.5:1.
   - Tint (stop ~50) + texto stop ~800 misma familia → ≥ 4.5:1.
   - Texto normal ≥ 4.5:1; UI/bordes/íconos ≥ 3:1.
   - **Nunca texto negro sobre color.**
   - Verificado en **claro y oscuro**.
2. **Theme-able en runtime** (D-5): el acento cambia en runtime vía variables CSS (no hardcode). Base cálida y primario oscuro quedan **fijos**; solo el acento cambia.

## Criterios de salida (Hitos)

- **H1** — Plan de arquitectura (duplicación + theme-able) presentado. → **gate del PO: parar acá.**
- **H2** — Las 7 rampas generadas + test de contraste WCAG pasando en claro y oscuro (output exhibido).
- **H3** — Duplicación resuelta: una sola fuente de verdad, apps/web consume de ahí, sin regresión visual del refactor.
- **H4** — Selector funcional: cambia el acento en vivo entre los 7 presets (prueba del theming runtime E2E).
- **H5** — `pnpm ci` verde (incluido el test de contraste). PR abierto contra main, MERGEABLE, **sin merge** (gate PO).

## Fuera de alcance de D1

- Selector "bonito" (D2/D3), librería de componentes (D2), patrones de interacción/voz (D3).
- Dark mode como toggle de UX en runtime (D3). D1 solo **define y verifica** los valores en claro y oscuro; no cablea el switch de tema visual.
