# ADR-022 — Metodología de cálculo de emisiones (incluye evitadas) y factor WTW diesel B5 Chile

**Status**: Accepted
**Date**: 2026-05-05
**Decider**: Felipe Vicencio (Product Owner)
**Related**:
- [ADR-005 Telemetría IoT](./005-telemetry-iot.md)
- [ADR-021 GLEC v3 compliance](./021-glec-v3-compliance.md)
- [docs/research/013-glec-audit.md](../research/013-glec-audit.md) — auditoría QA cerrada
- [docs/market-research/004-decisiones-bloqueantes-resueltas.md §D1](../market-research/004-decisiones-bloqueantes-resueltas.md)

---

## Contexto

La auditoría [BUG-013](../research/013-glec-audit.md) detectó que `packages/carbon-calculator` usaba **3.77 kgCO₂e/litro** como factor WTW (Well-to-Wheel) para diesel B5 Chile, lo que sobrestima emisiones ~16% respecto al consenso GLEC v3.0 + DEFRA 2024. Esto es bloqueante para emitir certificados auditables (F1, F2 del feature brief 003) bajo NCG 519 / IFRS S2.

Adicionalmente, el feature **F1 — Certificado de empty-return CO₂ evitado firmado** ([feature brief 003](../market-research/003-feature-brief-prioridades.md)) requiere una metodología explícita y publicable de "emisiones evitadas" — distinto de "emisiones causadas" — que sea defendible ante un auditor SFC durante el proceso de certificación GLEC.

## Decisión

### 1. Factor WTW diesel B5 Chile

Adoptar **3.21 kgCO₂e/litro** para diesel B5 (Chile) como valor por defecto del modo `por_defecto` en `packages/carbon-calculator`.

**Fuentes consensuadas**:
- GLEC Framework v3.0 (2024) — tabla de fuel emission factors, diesel road transport, referencia DEFRA UK 2024 Conversion Factors v1.0
- DEFRA UK 2024 GHG Conversion Factors (full set), publicación oficial UK government
- IPCC AR6 WG3 (2022) consistency check para CO₂ component
- B5 ajuste: -0.5% sobre fossil-only por contenido biodiesel chileno (Decreto 60/2013 MINENERGIA)

**Margen aceptado**: ±2% según ISO 14083 §5.2 (data quality default tier).

### 2. Sistema de versionado de metodología

Toda emisión calculada lleva campo `methodology_version` (string semver, ej. `glec-v3.0-cl-2026.05`). Cambios de factor o metodología incrementan versión:
- `MAJOR`: cambio de framework (ej. GLEC → ISO 14083 alone)
- `MINOR`: cambio de factor (ej. 3.21 → 3.18 si DEFRA 2025 lo actualiza)
- `PATCH`: corrección de bug sin impacto >0.5% en valor calculado

Certificados PADES emitidos quedan firmados con su `methodology_version` y `kms_key_version` originales — **no se invalidan automáticamente cuando cambia el factor**. Una nueva versión del certificado puede emitirse cuando el cliente lo solicite, manteniendo la versión vieja como evidencia histórica.

### 3. Metodología de emisiones evitadas (F1)

**Definición**: las emisiones evitadas de un viaje con backhaul son la diferencia entre el escenario contrafactual (camión retornaría vacío) y el escenario real (camión retorna con carga del marketplace).

```
avoided_emissions_kgco2e = empty_return_emissions_counterfactual - actual_carry_emissions

Donde:
  empty_return_emissions_counterfactual =
    distance_km · curb_weight_t · default_intensity_empty_kgco2e_per_tkm

  actual_carry_emissions =
    actual_fuel_consumed_l · wtw_factor_kgco2e_per_l
    (si modo exacto_canbus, sino estimado por carga + distancia)
```

**Reglas estrictas para evitar greenwashing**:

1. **Solo aplica si el matching marca `is_backhaul_optimized = true`** en `trip_requests` (Fase 0 D2). El matching algorithm declara el flag SOLO cuando el camión ya tenía un viaje programado de origen→destino y el match aprovecha el retorno destino→origen.
2. **El descuento NO es aditivo entre viajes**. Cada viaje certifica sus propias emisiones evitadas; no se acumula "crédito" reusable.
3. **El certificado de evitado es separado del certificado de emisiones causadas**. Un viaje produce dos certificados PADES: uno de emisiones (Scope 3 upstream/downstream del shipper) y uno de evitadas (claim Scope 3 reduction del shipper).
4. **El claim del shipper sobre emisiones evitadas es informativo, no es un offset**. El certificado lo dice explícitamente: "Estas emisiones evitadas representan optimización logística verificada, no constituyen un crédito de carbono compensable ni un offset bajo VCS, GS, ACR ni CDM."

### 4. Tres modos de cálculo (ratificados de ADR-021)

| Modo | Input requerido | Incertidumbre típica | Cuándo aplica |
|---|---|---|---|
| `exacto_canbus` | Litros consumidos del CAN-bus + distancia GPS | <5% | Vehículos con telemetría Codec8 + CAN integration |
| `modelado` | Distancia + carga + tipo vehículo + condición ruta | 10-15% | Vehículos con GPS pero sin CAN |
| `por_defecto` | Distancia + carga + tipo vehículo (categoría GLEC) | 20-30% | Onboarding sin telemetría |

El modo se registra en `trip_requests.precision_method`.

## Consecuencias

### Positivas

- Emisiones reportadas alineadas con consenso GLEC + DEFRA, defendibles ante auditor SFC.
- Sistema de versionado permite actualizaciones futuras sin invalidar certificados históricos.
- Metodología de evitadas explícita protege contra accusations de greenwashing.
- F1 (Certificado empty-return) y F2 (Reporte IFRS S2) tienen base metodológica firme para `/spec`.

### Negativas / costos

- Certificados emitidos pre-corrección con factor 3.77 sobrestiman ~16%. Requiere migration script para regenerar certificados pendientes (los ya firmados se mantienen como evidencia histórica con su versión original anotada).
- Cualquier auditor externo puede pedir trazabilidad de fuentes — mantener PDFs de DEFRA/GLEC v3 archivados en `references/` o linkeable.
- Cambios futuros de factor (DEFRA actualiza anualmente cada marzo) requieren proceso disciplinado: agente abre PR de update con citation de nueva fuente, ADR-022a (changelog) registra el cambio.

### Acciones derivadas

1. Crear migration script que regenera certificados emitidos pre-2026-05-05 con factor antiguo, marcándolos como `superseded_by_methodology_version`.
2. Archivar PDFs oficiales de GLEC v3.0 + DEFRA 2024 en `references/glec/` con SHA-256 de cada documento (evita drift de fuentes online).
3. Documentar internamente el proceso anual de revisión de factor (cada marzo cuando DEFRA publica nueva versión).
4. F1 spec referencia este ADR como fuente única de verdad metodológica.

## Validación

- [ ] Migration script de regeneración corrida y verificada.
- [ ] PDFs de fuentes archivados en `references/glec/` con hashes.
- [ ] `packages/carbon-calculator` actualizado con factor 3.21 + tests que validan los 3 modos.
- [ ] BUG-013 cerrado.
- [ ] F1 spec inicia citando este ADR.

## Histórico

- 2026-05-05: Aprobación de factor 3.21 + metodología emisiones evitadas + sistema de versionado.
