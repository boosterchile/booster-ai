# Spec — Sin stubs en packages (T10-09)

- Fecha: 2026-10-07
- Estado: Vigente
- Programa: TRL 10, fase B, criterio **T10-09 Sin stubs** (`.specs/trl10/spec.md`, ADR-082)

## Problema

`packages/carta-porte-generator` y `packages/document-indexer` son placeholders de 7 líneas con un `TODO` (`PACKAGE_NAME` y nada más). Ningún workspace los importa. Aparentan capacidades que el producto no tiene.

- **document-indexer:** `.specs/stubs-decision/spec.md` ya decidió eliminarlo (aprobado por el PO el 2026-05-17). La indexación de documentos vive en `apps/api` con Drizzle y, desde ADR-070, en `packages/transport-documents`.
- **carta-porte-generator:** ADR-007 preveía que Booster emitiera la Carta de Porte electrónica. ADR-070 cambió el rol: Booster recibe y archiva documentos de terceros y no emite. Decisión del PO (2026-10-07): eliminar el stub y declarar la Carta de Porte como congelada en `docs/frentes-vivos.md`, con condición de descongelamiento.

## Salidas

- Se borran los dos directorios y sus entradas del lockfile (regenerado con `pnpm install`).
- `docs/frentes-vivos.md` → «Congelados» suma la Carta de Porte con su condición.
- No se editan ADRs ni specs históricas que los mencionan: son registro.

`apps/matching-engine` y `apps/notification-service` no entran aquí; se cierran en T10-21.

## Criterios de éxito

1. `git grep` de los dos nombres fuera de `.specs/` y `docs/` históricos devuelve 0.
2. `pnpm install --frozen-lockfile`, typecheck y build de todo el monorepo en verde.
