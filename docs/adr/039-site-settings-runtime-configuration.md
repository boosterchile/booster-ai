# ADR-039 — Site Settings Runtime Configuration

**Estado**: Aceptado
**Fecha**: 2026-05-13
**Decisores**: Felipe Vicencio (PO)
**Supersede**: —

## Contexto

Hasta este ADR, los elementos de marca y copy comercial del frontend
público (logo, headline, propuesta de valor, cards de personas demo,
badges de certificación) vivían **hardcoded** en el bundle de
`apps/web`. Cada cambio — incluso una corrección de una palabra —
requería:

1. Editar el código fuente
2. PR + review + CI verde + merge
3. Build del bundle nuevo
4. Deploy de Cloud Run web
5. Cache CDN invalidation

Tiempo total: ~25 min en happy path, mayor si CI falla o hay race
con otros deploys.

Para demo Corfo (lunes 2026-05-18) y comunicación comercial general,
necesitamos que el platform-admin pueda **iterar copy y marca sin
redeploy**. Cambios típicos:

- Probar variantes de headline ("Transporta más, impacta menos" vs
  alternativas) en hours
- Subir un logo refinado tras feedback visual
- Ajustar el tagline de una persona demo
- Agregar/quitar una certificación

## Decisión

Crear una tabla **`configuracion_sitio`** (PostgreSQL) que persiste la
configuración del sitio como JSONB versionado. Schema validado por Zod
en `packages/shared-schemas/src/site-settings.ts`.

**Singleton sobre `publicada=true`** vía partial unique index:
```sql
CREATE UNIQUE INDEX configuracion_sitio_publicada_unique
    ON configuracion_sitio (publicada) WHERE publicada = true;
```

Cada `publish` es atómico (transacción): desmarca la versión publicada
anterior, marca la nueva. Cada cambio genera una fila nueva — el
historial completo queda preservado para rollback.

**Assets** (logos, favicons) van a un **bucket GCS público read-only**
(`booster-ai-public-assets-{env}`) con CDN cache. Write restringido al
SA del Cloud Run api. Sanitización SVG anti-XSS en el endpoint de upload.

**Frontend público** lee `GET /public/site-settings` vía TanStack Query
con `staleTime: 5min`. Fallback a `DEFAULT_SITE_CONFIG` hardcoded
(mismo `packages/shared-schemas`) si el endpoint falla, devuelve 404 o
response inválido. Esto asegura que **el sitio nunca se rompe** por un
issue del backend de configuración.

**Frontend admin** (`/app/platform-admin/site-settings`) tiene form de
edición + history + rollback. Gated por `BOOSTER_PLATFORM_ADMIN_EMAILS`
(allowlist, mismo patrón que otras surfaces admin platform-wide).

## Alternativas consideradas

### A. Mantener hardcoded (status quo)
Rechazada. Costo de cada iteración (~25 min + bloquea CI/deploy
pipeline) hace que el copy comercial se itere mucho menos de lo que
debería. Ya impacta el ciclo: tras la primera versión del demo Corfo
hubo 3 iteraciones de copy en una tarde, cada una requirió PR/deploy.

### B. Env vars con redeploy
Rechazada. Permite cambios sin tocar código pero sigue requiriendo
deploy de Cloud Run (~10-15 min). No resuelve el problema; solo lo
mueve a otra capa.

### C. CMS externo (Strapi, Sanity, Contentful)
Rechazada. Adds operational complexity (otro servicio que mantener,
otro auth a configurar, otro vendor lock-in). Sobredimensionado para
el alcance actual (~10 campos editables). Buena opción si en el
futuro necesitamos editorial workflow con múltiples editores y revisión.

### D. Tabla `configuracion_sitio` versionada con publish/rollback (elegida)
Pros:
- Datos cerca del producto, mismo stack (Drizzle/Hono/PostgreSQL).
- Versionado natural — `publicada=true` es estado vigente, demás son
  history.
- Rollback con un click.
- Auditoría implícita (`creado_por_email`, `creado_en`).
- Fallback robusto: si BD/API falla, frontend sirve defaults
  hardcoded.

Cons:
- Singleton vía partial unique index no es portable a otros engines
  (PostgreSQL-specific). Aceptable — stack canónico es Postgres
  (ADR-001).
- 5min de cache puede mostrar versión vieja a usuarios cuyo browser
  ya tenía la query en memoria. Aceptable para copy/marca.

## Schema del config (Zod canónico)

`packages/shared-schemas/src/site-settings.ts` exporta:

```typescript
SiteConfig = {
  identity: { logo_url?, logo_alt, favicon_url?, primary_color? },
  hero: { headline_line1, headline_line2, subhead, microcopy },
  certifications: string[],
  persona_cards: PersonaCard[4],  // exactamente 4
  onboarding?: OnboardingCopy,
  login?: LoginCopy,
}
```

Single source of truth — backend, frontend público y frontend admin
referencian este schema. Mantiene type safety end-to-end.

## Consecuencias

### Positivas
- Iteración de marca + copy en **minutos**, no en releases.
- Audit log natural (history table).
- Rollback inmediato si una publicación rompe algo visual.
- Defaults hardcoded en `DEFAULT_SITE_CONFIG` aseguran no-downtime
  ante fallos del backend de configuración.

### Negativas
- Una nueva tabla, un nuevo endpoint público, un nuevo bucket GCS, un
  nuevo bundle de admin UI a mantener.
- Cache de 5 min puede dar la sensación de "no se aplica" al admin
  recién publicado — mitigado por el botón "Abrir demo en nueva
  pestaña" que evita cache (hard reload).
- Sanitización SVG actual es defensiva (regex anti-XSS); no usa
  DOMPurify. Riesgo bajo porque el upload requiere admin auth, pero
  conviene endurecer en v2 con DOMPurify server-side.

### Acciones derivadas
- v1 (este ADR): identity + hero + certifications + persona_cards
  editables. Onboarding/login copy quedan opcionales en el schema —
  el form admin todavía no los incluye (placeholder para v2).
- v2: agregar onboarding/login copy al form admin, preview iframe
  pre-publish, DOMPurify para sanitización SVG robusta, audit log
  visible en la UI.
- v3 (eventual): si el alcance crece, evaluar migración a CMS externo.

## Costo

- BD: ~1 KB por versión × ~10 versiones/año = ~10 KB/año. Negligible.
- GCS bucket: <100 MB esperados (logos + favicons). Tier free.
- Engineering: ~16 hrs implementación inicial (este PR).
- Operacional: cero — el platform-admin opera el editor solo.

## Referencias

- ADR-001 — Stack selection (Postgres/Drizzle/Hono).
- ADR-011 — Admin console exclusion del coverage.
- ADR-034 — Stakeholder organizations (mismo patrón de admin
  platform-wide).
- ADR-038 — Routes API key migration (mismo bucket GCS pattern).
