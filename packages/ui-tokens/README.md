# @booster-ai/ui-tokens

Design tokens de Booster AI. Fuente única de verdad para color, tipografía,
spacing, radius, shadows, breakpoints, z-index y duraciones de animación.

## Status

`READY` — usado por `apps/web`, `apps/marketing` y leído por Claude Design
como brief técnico de marca.

## Uso

```ts
import { tokens, semanticColors, fontSize, textStyles } from '@booster-ai/ui-tokens';

// Como objeto agregado para configurar Tailwind:
tokens.colors.primary[500];     // '#1FA058' (Booster green)
tokens.spacing[4];              // '16px'
tokens.radius.md;               // '8px'

// Tokens semánticos directo:
semanticColors.bgCanvas;        // '#FAF9F7'
semanticColors.textPrimary;     // '#1A1917'

// Estilos pre-compuestos:
textStyles.h2;                  // { fontFamily, fontSize, fontWeight, ... }
```

## Estructura

- `colors.ts` — paleta + aliases semánticos
- `typography.ts` — fontFamily, sizes, weights, textStyles pre-compuestos
- `spacing.ts` — escala 4px modular hasta 384px
- `radius.ts` — sm/md/lg/xl/full
- `shadow.ts` — xs/sm/md/lg/xl + focusRing accesible
- `breakpoint.ts` — match Tailwind defaults
- `z-index.ts` — capas canónicas
- `duration.ts` — fast/default/slow + easings

## Filosofía

Los tokens son inmutables (`as const`) — TypeScript valida que ningún
caller cree colores fuera de la paleta. Cualquier valor visual nuevo
tiene que agregarse acá primero, no inline.

Cambios al brief de marca van en `DESIGN.md` (root del repo). Cambios
técnicos van acá. Si modificás un token core (ej. `primary.500`),
revisá los prototipos en Claude Design para que mantengan consistencia.

## Scripts

- `pnpm typecheck` — validación de tipos
- `pnpm test` — suite vitest (vacía — los tokens son data, no se testean)
