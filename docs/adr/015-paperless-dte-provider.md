# ADR-015 — Paperless seleccionado como proveedor DTE

**Fecha:** 2026-05-04
**Estado:** Aceptado
**Decider:** Felipe Vicencio (Product Owner)
**Related:** [ADR-007 Gestión Documental Obligatoria Chile](./007-chile-document-management.md)

## Contexto

ADR-007 dejó abierta la decisión final del proveedor DTE (Documento Tributario Electrónico) acreditado por SII Chile, recomendando Bsale pero "pendiente de benchmarking comercial". Sprint 1.3 lo necesita resuelto para habilitar la emisión legal de Guía de Despacho (DTE Tipo 52) y Factura Electrónica (DTE Tipo 33/34) — ambos bloqueantes para go-live en Chile (Ley 19.983, Ley 20.727, Resolución Exenta SII N°80/2014).

Booster **no es Emisor Electrónico Tipo I propio** (proceso de meses de certificación con SII). Necesita un proveedor acreditado que actúe como intermediario:

- Firma los DTEs con el **certificado tributario electrónico** del emisor (Booster como facturador, o el RUT del transportista cuando aplica)
- Envía al SII vía web service oficial
- Recibe el **folio autorizado** y devuelve el XML firmado + PDF visual
- Mantiene infraestructura para volúmenes altos sin que Booster gestione web services SII directamente

### Opciones evaluadas

| Provider | Pricing | API | Sandbox | Curva | Foco |
|---|---|---|---|---|---|
| **Bsale** | Plan mensual + por doc | REST + JSON | ✅ | Mayor superficie (ERP completo) | ERP integral con DTE incluido |
| **Paperless** | Pay-as-you-go por doc | REST + JSON | ✅ | Menor (DTE-first) | DTE + integraciones |
| Acepta | Plan + por doc | SOAP/REST mix | ✅ | Mayor (legacy) | Empresa establecida |
| SovosChile | Enterprise | SOAP | ✅ | Alta | Multinacionales |

## Decisión

**Paperless** es el provider DTE seleccionado para Booster AI.

### Rationale

1. **Modelo pay-as-you-go**: alinea costos con volumen real. Booster en early stage (TRL 9-10 piloto) emite pocos docs/mes; pagar plan mensual a Bsale tendría costo fijo desproporcionado al uso.
2. **API DTE-first**: el scope que necesitamos es estrictamente emisión de DTE 52/33/34. Bsale tiene un superficie mucho mayor (POS, inventario, CRM) que no usamos y agrega curva de integración innecesaria.
3. **Curva de integración menor**: documentación enfocada en DTE permite implementar el adapter en un sprint vs varios para Bsale.
4. **Cambio de provider future-proof**: la abstracción `DteEmitter` (ver ADR-007) permite swapear adapter sin tocar el resto del sistema. Si Paperless no escala, migramos a Bsale o Acepta cambiando el adapter, no el dominio.

### Riesgos asumidos

- **Pricing per-doc puede ser más caro a escala alta**: si Booster crece a >10k DTEs/mes, plan mensual de Bsale puede ser más económico. Re-evaluar en TRL 10+.
- **Dependencia de un solo provider**: implementamos `MockAdapter` (para tests + dev) + `PaperlessAdapter` (producción). Si Paperless tiene incidente, los DTEs pendientes quedan en cola hasta que vuelva — no es failover automático. Mitigación: monitoreo + alerta de cola crece >N min.
- **Calibración real de la API**: al momento de este ADR no tenemos cuenta sandbox abierta. La implementación inicial del `PaperlessAdapter` se construye con shape genérico DTE-SII; calibración fina requiere ejecutar contra sandbox real. Sprint 1.4 (wireado) cierra ese loop.

## Implementación

`packages/dte-provider`:

```typescript
export interface DteEmitter {
  emitGuiaDespacho(input: GuiaDespachoInput): Promise<DteResult>;
  emitFactura(input: FacturaInput): Promise<DteResult>;
  queryStatus(folio: string, rutEmisor: string): Promise<DteStatus>;
}

// Adapters
export class PaperlessAdapter implements DteEmitter { ... }
export class MockAdapter implements DteEmitter { ... }

// Factory según env
export function createDteEmitter(config): DteEmitter {
  if (config.provider === 'paperless') return new PaperlessAdapter(config);
  return new MockAdapter(); // tests + dev local
}
```

### Configuración por environment

- **dev / test**: `DTE_PROVIDER=mock` — `MockAdapter` retorna folios determinísticos.
- **staging**: `DTE_PROVIDER=paperless` + `PAPERLESS_API_KEY=...` (sandbox) + `PAPERLESS_BASE_URL=https://api.sandbox.paperless.cl/v1`.
- **prod**: `DTE_PROVIDER=paperless` + `PAPERLESS_API_KEY=...` (producción) + `PAPERLESS_BASE_URL=https://api.paperless.cl/v1`.

API keys via Secret Manager, nunca en el repo (CLAUDE.md §"Sin secretos en el repo").

### Identidad de firma DTE

A diferencia de la firma PAdES de cartas de porte y certificados ESG (que usa la KMS key de Booster como Software Generator), la firma SII de DTEs usa el **certificado tributario electrónico del emisor real** (RUT del transportista que está despachando, no Booster). Paperless gestiona esos certs por RUT en su lado — Booster pasa el RUT del emisor en cada request, Paperless usa el cert correcto.

Configuración por empresa en BD (`empresas.rut_emisor_dte` + `empresas.paperless_emisor_id`) — fuera de scope para Sprint 1.3, se agrega en Sprint 1.4 cuando el wireado lo requiera.

## Consecuencias

- **Positivas**: time-to-market corto, costos alineados a uso real, abstracción permite cambio futuro.
- **Negativas**: dependencia de servicio externo single-vendor; calibración fina pendiente hasta tener sandbox.
- **Acciones de seguimiento**:
  - Crear cuenta sandbox Paperless (Felipe).
  - Calibrar `PaperlessAdapter` contra API real en Sprint 1.4.
  - Definir `empresas.rut_emisor_dte` schema en Sprint 1.4.
  - Re-evaluar economía pay-as-you-go vs plan mensual al alcanzar volumen ≥1k DTEs/mes.
