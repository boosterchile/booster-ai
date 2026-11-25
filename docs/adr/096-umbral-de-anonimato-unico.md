# ADR-096 — Un único umbral de anonimato para datos agregados: 1

**Estado**: Vigente. El PO fijó el valor en el traspaso del rediseño (`docs/design/rediseno-2026-11-25/README.md`, decisión 8, y `FRENTES.md`, encabezado) y autorizó este ADR en el chat del 2026-11-25.
**Fecha**: 2026-11-25
**Decider**: Felipe Vicencio (Product Owner).
**Supera en parte a**:
- [ADR-041](./041-stakeholder-geo-aggregations-bounding-boxes-k-anonymity.md) §2: el umbral deja de ser 5 y deja de ser «invariante por diseño». Lo demás de ese ADR que ADR-042 mantuvo sigue igual.
- [ADR-042](./042-stakeholder-geo-aggregations-comuna-filter-and-domain-alignment.md) §6: los tres niveles se conservan; cambia el valor de `k`.
- [ADR-034](./034-stakeholder-organizations.md): donde dice «k-anonymity ≥ 5».
- [ADR-012](./012-urban-observatory-digital-twins.md) §Privacidad: la mitigación «10+ vehículos por bucket» pasa a 1.

**Spec**: `.specs/una-sola-verdad-por-dato/spec.md` (frente 1 del rediseño).

## Contexto

Había dos umbrales para la misma idea, verificados en `main` (`afc3e044`):

- El observatorio urbano publicaba un grupo solo con 10 vehículos distintos: `K_MIN_VEHICULOS` en `apps/api/src/services/observatorio/proyeccion.ts` y `HAVING COUNT(DISTINCT vehiculo_id) >= 10` en las cuatro vistas materializadas de `infrastructure/observatorio.tf`.
- Los agregados de organizaciones publicaban una celda solo con 5 viajes: `K_ANON` en `apps/api/src/services/stakeholder-aggregations.ts` y otra copia en `apps/api/src/routes/stakeholder-zonas.ts`.

Con la flota actual esos umbrales dejan casi todo vacío. `.specs/observatorio-coquimbo/spec.md` lo anticipaba: «las vistas devolverán pocos buckets o ninguno, porque k = 10 los oculta». El rediseño pone estos datos en pantalla y el frente 1 pide «un único umbral de anonimato para datos agregados».

## Decisión

1. **El umbral es 1 y es uno solo.** Un dato agregado se muestra desde 1 camión (observatorio) o 1 viaje (agregados de organizaciones). Vive en `UMBRAL_ANONIMATO`, en `packages/shared-schemas/src/aggregations/umbral-anonimato.ts`. El observatorio, los agregados, las vistas de BigQuery y los textos de la web toman el valor de ahí o lo repiten con referencia a este ADR.
2. **Lo que nunca se muestra no cambia.** Ninguna respuesta agregada incluye empresa, patente, conductor ni un viaje individual. `filtrarK` sigue quitando `vehiculo_id` y `viaje_id`, y sigue descartando la fila cuyo conteo falta o no es numérico.
3. **Los tres niveles de ADR-042 §6 se conservan** con el valor nuevo: sin viajes, la respuesta dice `insufficient_data`; la hora sin viajes queda enmascarada; el tipo de carga o el combustible sin viajes no aparece.
4. **`aplicarKAnonymity` acepta `k = 1`.** Antes lanzaba un error bajo 2.

## Consecuencias

- **El umbral ya no esconde a quién pertenece un grupo pequeño.** Una celda con 1 viaje es ese viaje, sin su nombre. Quien conozca por otra vía qué empresa opera en una comuna puede atribuirle la cifra. La protección pasa a ser lo que la respuesta omite y a quién se le entrega: el observatorio es una vista interna del panel de administración, y los agregados de organizaciones siguen exigiendo el consentimiento y el ámbito de ADR-028 y ADR-034.
- **Antes de publicar el observatorio fuera de Booster hay que revisar este valor.** ADR-012 pedía una auditoría legal antes de la primera publicación; esa condición sigue vigente y ahora incluye confirmar el umbral.
- **Volver a subir el umbral es cambiar una constante** y las cuatro vistas de `observatorio.tf`, con un ADR que supere a este.
- **Infraestructura.** Las vistas materializadas se recrean con `terraform apply`, que corre el PO. Hasta entonces las vistas desplegadas siguen filtrando con 10 y el observatorio muestra lo mismo que hoy, aunque el API ya acepte 1.

## Alternativas consideradas

- **Mantener 5 y 10.** Descartada por el PO: deja las pantallas vacías con la flota actual y mantiene dos valores para el mismo concepto.
- **Un umbral único de 5.** Unifica, pero sigue sin mostrar datos hoy.
- **Umbral configurable por pantalla.** Contradice el frente 1: el valor debe ser uno.
