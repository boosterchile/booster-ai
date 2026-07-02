# Follow-up: consent-scope + audit bloqueante para el endpoint de zonas stakeholder

**Origen**: implementación del endpoint geo k-anon `GET /me/stakeholder/zonas/:slug/agregaciones` (cierre del gap B2 "D11 dormido", PR feat/stakeholder-geo-aggregations-endpoint, 2026-06-22).
**Prioridad**: P2 (la privacidad de individuos YA está garantizada por k-anon≥5; esto es control de acceso de negocio + audit).

## Contexto

El endpoint cablea el servicio k-anon `stakeholder-aggregations.ts` (ADR-041/042). Autoriza por **rol** (`stakeholder_sostenibilidad`, modelo ADR-034) + aplica el **gate de privacidad** (k-anon≥5, dataset-level `insufficient_data`, filtro comuna, ventana 30d, estado `entregado`). Los datos son **agregados anónimos de zonas geográficas públicas curadas** (puertos, mercados, polos industriales) cross-carrier → no re-identifican individuos.

## Lo que queda abierto (2 TODOs en el handler)

1. **Consent-scope**: el modelo de consent ESG (`checkStakeholderConsent`, ADR-028) **no puede expresar "qué stakeholder ve qué zona"** — sus `scopeType` (`generador_carga`/`transportista`/`organizacion`/`portafolio_viajes`) apuntan a `empresas.id` por UUID, mientras una zona agrega viajes cross-empresa por `slug`. Hoy cualquier usuario con rol stakeholder ve cualquier zona. Como los datos son k-anon de zonas públicas, no hay fuga de individuos; pero si se quiere restringir visibilidad por consent/tier, hay que **definir el modelo de consent para zonas** (¿una zona requiere consent? ¿de quién? ¿o es transparencia pública para stakeholders?).

2. **Audit bloqueante**: `recordStakeholderAccess` (ADR-028) requiere `(stakeholderId, consentId)` NOT NULL que no existen para acceso a zona. Hoy se deja **traza estructurada** vía logger (`userId`, `actorFirebaseUid`, `zonaSlug`, `totalViajes`, `insufficientData`). Cablear el audit bloqueante cuando se resuelva (1).

## Bloqueador

Decisión de **Producto/legal**: el modelo de consent para datos agregados de zonas públicas (vs el modelo per-empresa existente). Posiblemente amerita un ADR que extienda ADR-028/068 o declare las zonas como transparencia pública sin consent per-zona.

## Acción sugerida

- Si "transparencia pública para stakeholders": dejar como está (rol + k-anon) + cablear solo el audit (sin consentId, relajando la FK o con una entrada de audit no atada a consent).
- Si "restringido por consent/tier": ADR del modelo de consent-zona + implementar el check + el audit.
