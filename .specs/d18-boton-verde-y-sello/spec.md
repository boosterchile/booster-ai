# D-18 — Botón principal verde y sello «Medido» / «Estimado»

**Estado**: aceptada (instrucción del PO en el chat, 2026-11-24).
**Ancla**: DESIGN.md §8.1 y D-18 (#1082).
**Reemplaza**: la decisión «`primary` del Button usa el ACENTO» de `.specs/d2-ola1-primitivas/spec.md`. D-18 nombra al `Button` compartido y prevalece.

## Objetivo

Que el código compartido cumpla D-18: el botón principal es verde Booster en toda la plataforma, y existe un sello que distingue lo ambiental por forma y palabra, no por color.

## Entradas

- Tokens D1 (`@booster-ai/ui-tokens`): `primary-*`, `neutral-*`.
- `Button` de `@booster-ai/ui-components` (hoy `bg-accent-600`).

## Salidas y criterios de éxito

**Button**

- La variante `primary` usa `bg-primary-600 text-white`, con `primary-700` en hover y `primary-800` en active. No usa ninguna clase `accent-*`.
- No cambia con el acento elegido en `/apariencia`.
- Las otras variantes (`secondary`, `ghost`, `danger`), el tamaño por registro, `disabled` y `loading` quedan igual.

**Sello** (`MeasurementSeal`, grupo semántico-fijo)

- `kind`: `measured` muestra la palabra «Medido»; `estimated` muestra «Estimado». La palabra es fija: el componente no acepta `children`.
- Cada tipo tiene forma propia, distinguible sin color: «Medido» lleva borde continuo e ícono de visto; «Estimado» lleva borde punteado e ícono de aproximación (≈).
- El ícono es decorativo (`aria-hidden`); el nombre accesible es la palabra.
- No lee `accent-*` ni las custom properties de registro o densidad.
- Sin violaciones de axe.

**Contraste** (test en `ui-tokens`, WCAG AA)

- Blanco sobre `primary-600` ≥ 4.5, y mejor que negro.
- Texto del sello sobre su fondo ≥ 4.5; borde del sello sobre superficie clara ≥ 3.

**Demostrable**: el sello aparece en `/apariencia` junto a las demás primitivas.

## Verificación

`pnpm run ci` en Node 24, salida en el PR. Revisión visual de `/apariencia` en el navegador.

## Fuera de alcance

- Usar el sello en pantallas de producto (rutas, flota, certificados). Qué presentación de ADR-091 lleva «Medido» lo decide el PO: «Distancia medida con Teltonika» mide la distancia pero modela el consumo.
- Botones que no usan el `Button` compartido.
- El PDF del certificado (`certificate-generator`).
