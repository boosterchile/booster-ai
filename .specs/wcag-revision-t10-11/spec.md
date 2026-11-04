# Spec — revisión WCAG 2.1 AA verificable de los flujos críticos (T10-11)

- **Programa**: TRL 10 ([ADR-082](../../docs/adr/082-objetivo-trl10-supersede-precomercial.md)), criterio T10-11.
- **Estado**: aceptada por el agente dentro del mandato "sigue con el programa TRL 10" (2026-10-10). No cambia contratos públicos.
- **Antecedente**: `docs/audits/wcag-2026-10-09.md` cerró las violaciones de axe. Dejó abierta, como revisión manual, la parte que axe no detecta: teclado y foco, reflow, errores de formulario y mensajes de estado.

## Problema

axe detecta cerca de un tercio de los criterios WCAG. T10-11 exige que el informe no deje hallazgos AA abiertos. Varios de los criterios "manuales" tienen una parte programática que se puede comprobar en el DOM con Playwright, en cada PR:

- si el foco llega a cada control;
- si el foco se ve;
- si hay scroll horizontal a 320 px;
- si el error está asociado al campo;
- si el mensaje está en una región viva.

Lo que queda fuera es la escucha real con un lector de pantalla.

## Entradas

Las 18 pantallas que hoy pasan por `expectSinViolacionesGraves` en `apps/web/e2e-conductor/` (los 7 flujos de T10-10).

## Salidas

1. `apps/web/e2e-conductor/a11y.ts` exporta `revisarPantalla(page, pantalla, opciones?)`. Corre en orden:
   - **A1 axe** (lo de hoy): 0 violaciones `serious` o `critical` con `wcag2a`, `wcag2aa`, `wcag21a` y `wcag21aa`.
   - **A2 reflow** (1.4.10; cubre también 1.4.4 a 200 %):
     - Con viewport de 320 × 640 px CSS, el documento no tiene scroll horizontal: `scrollWidth − clientWidth ≤ 1`.
     - Ningún elemento visible desborda el viewport por la derecha, salvo que esté dentro de un contenedor con scroll horizontal propio, que la excepción de 1.4.10 permite para contenido bidimensional (mapas, tablas).
     - También se mide a 640 px, el equivalente a 200 % de zoom en 1280.
     - Al terminar se restaura el viewport original.
   - **A3 teclado** (2.1.1, 2.1.2, 2.4.7):
     - **Alcance.** Desde el inicio del documento, con `Tab` repetido, el foco recorre todos los controles enfocables visibles: `a[href]`, `button`, `input`, `select`, `textarea`, `summary` y `[tabindex]` ≥ 0, sin `disabled` ni `inert`.
     - **Sin trampa.** El foco vuelve al documento o al primer control antes de `n + 10` pulsaciones, donde `n` es la cantidad de controles.
     - **Foco visible.** Cada control enfocado tiene un indicador. Puede ser un `outline` de al menos 1 px con estilo distinto de `none`, o un `box-shadow`, borde o fondo distinto del estado sin foco.
   - **A4 errores y estado** (3.3.1, 3.3.3, 4.1.3), solo cuando el paso lo pide (`opciones.errores` / `opciones.estado`):
     - todo campo con `aria-invalid="true"` tiene `aria-describedby` hacia un nodo existente con texto;
     - el mensaje indicado está dentro de `role="alert"`, `role="status"` o un `aria-live` distinto de `off`.
2. Los specs reemplazan `expectSinViolacionesGraves` por `revisarPantalla`. Se agregan dos pasos de error:
   - **login con clave incorrecta**, que ya existe;
   - **nueva carga enviada sin datos obligatorios**, que es nuevo.

   Se agrega además el paso de estado de la invitación stakeholder.
3. Correcciones en `apps/web/src` para lo que A2–A4 encuentren, con test unitario cuando el cambio es de comportamiento.
4. `docs/audits/wcag-2026-10-09.md` actualizado con los hallazgos nuevos y su estado. "Lo que no cubre" queda reducido a la escucha con lector de pantalla.

## Criterios de éxito

- Rojo exhibido: la primera corrida con A2–A4 lista los hallazgos reales antes de corregir (o declara 0 con el detalle de lo medido).
- Las 7 suites pasan con A1–A4 en dos corridas completas seguidas.
- `pnpm --filter @booster-ai/web` test, typecheck, lint y build en verde.
- El informe no deja hallazgos programáticos abiertos. La escucha con NVDA o VoiceOver queda declarada como residual humano, no como cumplida.

## Fuera de alcance

- La escucha con lector de pantalla y el juicio sobre la calidad de los textos alternativos (1.1.1) y las etiquetas (2.4.6) más allá de que existan.
- Pantallas fuera de los 7 flujos.
