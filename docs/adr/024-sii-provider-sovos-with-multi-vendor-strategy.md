# ADR-024 — Selección de proveedor SII (Sovos/Paperless) y estrategia multi-vendor LATAM

**Status**: Accepted
**Date**: 2026-05-05
**Decider**: Felipe Vicencio (Product Owner)
**Related**:
- [ADR-007 Gestión documental Chile](./007-chile-document-management.md) — supersede §Decisión sobre provider
- [docs/market-research/004-decisiones-bloqueantes-resueltas.md §D3](../market-research/004-decisiones-bloqueantes-resueltas.md)

---

## Contexto

[ADR-007 §Decisión](./007-chile-document-management.md) dejó la elección de proveedor SII como "pendiente de benchmarking comercial", recomendando provisionalmente Bsale. Auditoría F7 del 2026-05-05 confirma que `packages/dte-provider` está en placeholder y bloquea F7 (DTE + Carta Porte automáticos al cierre del viaje), F6 parcial (Trust Score con component DTE compliance) y F9 (API pública con descarga de DTE).

Booster opera como **marketplace B2B** que emite DTE Tipo 52 (Guía de Despacho) **en nombre de N transportistas distintos**, cada uno con su propio RUT y su propio certificado tributario electrónico SII. La capacidad multi-tenant del proveedor es un **requisito arquitectónico no negociable**.

Adicionalmente, el [playbook 001 de posicionamiento](../../playbooks/001-posicionamiento-competitivo.md) plantea expansión Q3 2027 a Colombia (DIAN), seguido de México (CFDI) y Perú (SUNAT). El proveedor primario debe minimizar fricción de re-integración por país, y la arquitectura debe permitir adapters por país/proveedor sin rewrite del core.

## Decisión

### 1. Proveedor primario Chile: Sovos/Paperless

Adoptar **Sovos/Paperless** (ex-Paperless Chile, adquirida por Sovos en 2017) como proveedor SII primario para Chile.

**Razones decisivas**:

1. **Multi-tenancy nativo**: arquitectura cliente-tenant probada en producción (URLs `cliente.paperless.cl` confirman pattern). Bsale, SimpleAPI, Haulmer no lo soportan o no lo confirman.
2. **Escala probada**: 2B+ transacciones/año, 40k+ sistemas integrados — sin riesgo de saturación al crecer Booster.
3. **Multi-país LATAM (vía Sovos global)**: CL+PE+AR+MX+BR cubiertos por el mismo proveedor — un contrato, una integración base, una UI de operación.
4. **Compliance enterprise**: ISO 27001 + SSAE16. Requisito implícito al vender a S.A. abiertas listadas CMF (NCG 519, target #1 del playbook).
5. **Cliente referenciable**: Cencosud (`cencosud.paperless.cl`) es un proxy de calidad para retailers chilenos grandes.

### 2. Arquitectura adapter-pattern en `packages/dte-provider`

Para evitar lock-in y permitir expansión multi-país, el package implementa interface `DteEmitter` con N adapters intercambiables vía configuración:

```typescript
// packages/dte-provider/src/interface.ts
export interface DteEmitter {
  emitGuiaDespacho(input: GuiaDespachoInput): Promise<DteResult>;
  emitFactura(input: FacturaInput): Promise<DteResult>;
  queryStatus(folio: string, rutEmisor: string): Promise<DteStatus>;
  voidDocument(folio: string, rutEmisor: string, reason: string): Promise<void>;
}

// packages/dte-provider/src/adapters/
//   sovos.ts        - SovosAdapter (PRIMARIO Chile)
//   bsale.ts        - BsaleAdapter (BACKUP Chile, single-tenant — degraded)
//   mock.ts         - MockAdapter (dev + tests sin sandbox)
//   defontana.ts    - DefontanaAdapter (futuro Chile, multi-país regional)
//   alanube.ts      - AlanubeAdapter (futuro Colombia primario)
//   edicom.ts       - EdicomAdapter (futuro México primario)
```

Selección del adapter activo se hace por **tupla `(country, carrierPreference)`**:
- Default Chile → Sovos
- Carrier puede pedir explícitamente Bsale (degraded mode, 1 RUT) si ya tiene cuenta Bsale propia
- Country expansión → adapter regional pre-validado

### 3. Alternativas LATAM pre-validadas (no se contratan ahora, se documentan para evitar re-investigación)

| País target | Primario sugerido | Alternativa | Razón |
|---|---|---|---|
| Chile | **Sovos/Paperless** ✅ | Bsale (degraded), Defontana | Multi-tenant + escala |
| Colombia | **Alanube** | Sovos (vía DIAN integration), Siigo | Alanube se posiciona "líder en 8 países" + foco principal CO |
| México | **Edicom** | Sovos | Edicom fue primer PAC certificado por SAT, fuerte en MX |
| Perú | **Sovos** | Defontana | Sovos opera Paperless Perú directamente |
| Argentina | **Sovos** | Edicom AR | Sovos cubre AR; Edicom tiene oficina local |
| Brasil | **Pagero (TR)** | Sovos | Pagero adquirió Gosocket (líder B2B regional); TR backing enterprise |

Cuando se inicie expansión a un país nuevo, el agente NO re-investiga el mercado de PAC — toma la sugerencia de esta tabla, valida supuestos vigentes (12 meses), produce ADR-024a/b/c según país, y agrega el adapter correspondiente.

### 4. Política de credenciales por carrier

Cada carrier en Booster tiene su propio:
- Certificado tributario electrónico (`.pfx`) almacenado en Secret Manager bajo `secrets/carrier-{carrierId}-sii-cert`.
- Cuenta Sovos/Paperless con autorización explícita a Booster como emisor (proceso interno Sovos one-time).
- Tabla `carriers.sii_provider_account_id` registra la cuenta del carrier en el provider activo.

Acceso a credenciales: solo `apps/document-service` (service account dedicado), nunca expuestas al cliente PWA, nunca logueadas (Pino redaction strict).

### 5. Plan de implementación

```
Sprint X (post-aprobación ADR):
  - Felipe contacta Sovos Chile (+56 22 5952932), solicita:
    * Sandbox UAT credentials
    * Pricing enterprise para marketplace multi-tenant 50→500 carriers/12 meses
    * Confirmación Carta Porte Ley 18.290 soporte
    * NDA recíproco para acceso a API docs completas
    * Confirmación que Acepta migration ya estabilizada (relevante por ADR-007 §Acepta)

Sprint X+1:
  - Implementar packages/dte-provider con interface + MockAdapter
  - Tests de unit con MockAdapter
  - Bloquea: spec F7

Sprint X+2 (cuando Sandbox Sovos disponible):
  - Implementar SovosAdapter
  - Integration tests contra sandbox UAT
  - Carrier credential workflow (upload .pfx + Secret Manager + autorización Sovos)

Sprint X+3:
  - Smoke test contra sandbox con un viaje sintético
  - Cutover a producción solo con aprobación PO + un viaje real piloto
```

## Consecuencias

### Positivas

- Multi-tenant resuelto sin deuda técnica.
- Expansión LATAM con plan claro por país (no re-investigación cada vez).
- Adapter pattern evita vendor lock-in: si Sovos sube precio inaceptable o falla SLA, swap a Bsale (degraded) o Defontana.
- Arquitectura compatible con NCG 519 / IFRS S2 (compliance enterprise).

### Negativas / costos

- Costo Sovos enterprise estimado USD 800-1.500/mes base + per-doc (vs USD 30/mes Bsale). Justificable per amortización per-carrier.
- API Sovos gated por NDA → tests E2E dependen de sandbox UAT, no de docs públicas.
- Time-to-first-DTE más largo: enterprise procurement típicamente 4-8 semanas. Mitigación: `MockAdapter` permite dev paralelo.
- Carrier debe completar onboarding adicional (autorizar Booster en su cuenta Sovos). Mitigación: documentar el proceso en `apps/web` rol Carrier con video tutorial.

### Acciones derivadas

1. Felipe contacta Sovos Chile esta semana.
2. Agente implementa `packages/dte-provider` con interface + MockAdapter independiente del status comercial.
3. Cuando sandbox UAT disponible: agente implementa SovosAdapter + integration tests.
4. Spec F7 inicia con MockAdapter; SovosAdapter activado en producción cuando sandbox + smoke test ok.
5. Documentar en `references/sii/` los snapshots de páginas Sovos consultadas (archivar contra cambios web futuros).

## Validación

- [ ] Sandbox UAT Sovos disponible.
- [ ] `packages/dte-provider` con MockAdapter operativo + tests.
- [ ] `packages/dte-provider` con SovosAdapter operativo + integration tests passing.
- [ ] Carrier workflow de credentials documentado y operativo.
- [ ] Smoke test con viaje real piloto exitoso.

## Supersede

Este ADR cierra el "pendiente de benchmarking comercial" de [ADR-007 §Decisión](./007-chile-document-management.md). El resto del ADR-007 (arquitectura, retention, tipos de documento, OCR) sigue vigente.

## Histórico

- 2026-05-05: Decisión Sovos primario + adapter pattern + alternativas LATAM pre-validadas.
