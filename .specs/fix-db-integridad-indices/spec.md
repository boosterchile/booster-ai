# Spec: fix-db-integridad-indices

- Author: Felipe Vicencio (with agent-rigor)
- Date: 2026-06-11
- Status: Approved
- Linked: Auditoría 2026-06-09, seguimiento "Modelo de datos Postgres" — riesgos medios: FK faltante en documentos_conductor, índices redundantes en el hot path de telemetría; baja: UNIQUE de membresías no cubre duplicados stakeholder.

## 1. Objective

Migración 0040 que cierra tres hallazgos de integridad/eficiencia del modelo de datos: (1) `documentos_conductor.conductor_id` no tiene FK — permite documentos huérfanos en un modelo que usa RESTRICT consistentemente; (2) `uq_membresias_usuario_empresa(usuario_id, empresa_id)` con `empresa_id NULL` para memberships stakeholder no previene duplicados (NULL≠NULL en UNIQUE): un user puede tener N memberships en la misma organización; (3) 4 índices redundantes encarecen cada INSERT de telemetría (telemetria_puntos paga 5 estructuras por insert).

## 2. Why now

Mandato PO + son fixes baratos ahora y caros después (los huérfanos/duplicados se acumulan; los índices crecen con 2.16M filas/mes).

## 3. Success criteria

- [ ] FK `documentos_conductor.conductor_id → conductores.id ON DELETE RESTRICT` en DDL y en schema.ts.
- [ ] Unique parcial `uq_membresias_usuario_org_stakeholder (usuario_id, organizacion_stakeholder_id) WHERE organizacion_stakeholder_id IS NOT NULL`.
- [ ] DROP de `idx_telemetria_imei_ts` (duplica el UNIQUE), `idx_telemetria_vehiculo_recibido` (columna solo en proyecciones), `idx_eventos_conduccion_vehiculo_ts` (prefijo de su UNIQUE), `idx_vehiculos_teltonika_imei` (duplica `.unique()`); schema.ts alineado.
- [ ] Journal de drizzle consistente (ADR-044) + integration test de migraciones verde.

## 4. User-visible behaviour

Ninguno. INSERTs de telemetría ~20% menos estructuras de índice; integridad referencial real en documentos de conductores.

## 5. Out of scope

- Particionamiento/retención de telemetria_puntos (tarea #19 con ventana del PO).
- FK para `posiciones_movil_conductor.asignacion_id` (decisión documentada en 0025:16-20 — deliberada).
- Backfill/limpieza de huérfanos si existieran (ver §9: la migración falla ruidoso y el operador resuelve con la query del comentario).

## 6. Constraints

1. Migración aditiva + DROP INDEX IF EXISTS (idempotente ante re-aplicación parcial).
2. Los índices parciales viven solo en SQL (convención existente del repo, schema.ts:1949-1951); el unique parcial nuevo sigue esa convención con comentario en schema.ts.
3. La FK puede fallar si hay huérfanos preexistentes: el fallo es la señal correcta (no se borra data silenciosamente); query de diagnóstico en el comentario de la migración.

## 7. Approach

`apps/api/drizzle/0040_integridad_indices.sql` con statement-breakpoints (convención del repo) + entry en `meta/_journal.json` (idx 40). schema.ts: `.references()` en conductorId; eliminar las 4 declaraciones de índice redundantes; comentario del unique parcial en membresias.

## 8. Alternatives considered

- **A. NULLS NOT DISTINCT en el UNIQUE existente** — Rechazada: cambiaría la semántica del par (usuario, empresa NULL) compartido por TODAS las memberships stakeholder de un user en organizaciones DISTINTAS (las bloquearía); el unique parcial apunta exactamente al caso real.
- **B. Limpiar huérfanos automáticamente en la migración (DELETE)** — Rechazada: borrar datos en una migración automática al startup es inaceptable; fallo ruidoso + intervención humana.

## 9. Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Huérfanos preexistentes rompen la FK al aplicar | L | M | Pre-comercial con soft-delete de conductores (no hay DELETEs físicos); query de diagnóstico en el comentario; fallo no tumba el startup (STRICT=false) y alerta en logs |
| Duplicados stakeholder preexistentes rompen el unique parcial | L | M | Misma política: fallo ruidoso + query de diagnóstico |
| Algún plan de query usaba un índice dropeado | L | L | Análisis de la auditoría: equality/prefijo cubiertos por los UNIQUE; DESC vs ASC irrelevante para btree backward scan |

## 10. Test list

- T1: integration test de migraciones (apps/api test:integration migrations) aplica 0000→0040 limpio en Postgres real.
- T2: insert de documento con conductor inexistente → viola FK (integration o assert en test de drift-alignment si aplica).
- T3: doble membership stakeholder mismo (user, org) → viola unique parcial.
- T4: drizzle journal validation del migrator pasa (orden + tags).

## 11. Rollout

- Migración: sí (0040, al startup del api con advisory lock).
- Rollback: migración inversa documentada en el comentario (DROP CONSTRAINT / DROP INDEX / CREATE INDEX originales).
- Monitoring: log del migrator al aplicar; el integration test de CI ya valida la cadena completa.

## 12. Open questions

None as of 2026-06-11.

## 13. Decision log

- 2026-06-11 — Draft + mandato PO. Unique parcial (no NULLS NOT DISTINCT), fallo-ruidoso (no DELETE silencioso).
