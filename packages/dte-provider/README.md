# @booster-ai/dte-provider

Abstracción de proveedores de Documentos Tributarios Electrónicos (DTE) para el SII chileno. Implementa el adapter pattern definido en [ADR-007](../../docs/adr/007-chile-document-management.md).

Booster **NO emite DTEs propios** — delega a un provider acreditado por SII (Bsale recomendado, alternativas: Paperless, Acepta, SovosChile).

## Estado actual

- ✅ Interface `DteProvider` definida
- ✅ Schemas Zod (`GuiaDespachoInput`, `FacturaInput`, `DteResult`, `DteStatus`)
- ✅ 7 errores tipados (`DteValidationError`, `DteRejectedBySiiError`, `DteCertificateError`, `DteProviderUnavailableError`, `DteFolioConflictError`, `DteNotFoundError`, `DteProviderError` base)
- ✅ `MockDteProvider` (in-memory) con 21 tests
- ⏳ `BsaleAdapter` — pendiente, se conecta al provider real
- ⏳ `PaperlessAdapter` — alternativa pendiente

## Instalación

```jsonc
// apps/document-service/package.json
"dependencies": {
  "@booster-ai/dte-provider": "workspace:*"
}
```

## API

### Emit Guía de Despacho (DTE 52)

```ts
import {
  MockDteProvider,
  type DteProvider,
  type GuiaDespachoInput,
} from '@booster-ai/dte-provider';

const provider: DteProvider = new MockDteProvider();
const input: GuiaDespachoInput = {
  rutEmisor: '76123456-7',
  razonSocialEmisor: 'Transportes Test SpA',
  rutReceptor: '12345678-9',
  razonSocialReceptor: 'Cliente SA',
  fechaEmision: new Date(),
  items: [{
    descripcion: 'Transporte Santiago → Concepción',
    cantidad: 1,
    precioUnitarioClp: 850000,
    unidadMedida: 'VIAJE',
  }],
  transporte: {
    rutChofer: '11111111-1',
    nombreChofer: 'Juan Pérez',
    patente: 'AB-CD-12',
    direccionDestino: 'Av. Principal 123',
    comunaDestino: 'Concepción',
  },
  tipoDespacho: 5, // traslados internos
};

const result = await provider.emitGuiaDespacho(input);
console.log(result.folio);     // "1" (mock) o folio SII real
console.log(result.sha256);    // hash del XML para integrity check
console.log(result.xmlSigned); // XML firmado para archivo legal 6 años
```

### Emit Factura Electrónica (DTE 33 / 34)

```ts
const factura = await provider.emitFactura({
  tipoDte: 33, // 33 = afecta IVA, 34 = exenta
  rutEmisor: '76123456-7',
  razonSocialEmisor: 'Transportes Test SpA',
  giroEmisor: 'Transporte de Carga',
  rutReceptor: '12345678-9',
  razonSocialReceptor: 'Cliente SA',
  giroReceptor: 'Comercio',
  fechaEmision: new Date(),
  items: [{
    descripcion: 'Servicio de transporte',
    cantidad: 1,
    precioUnitarioClp: 850000,
    unidadMedida: 'UN',
  }],
  // Vincular a una guía ya emitida (opcional pero recomendado para auditoría):
  referenciaGuia: {
    folio: result.folio,
    fechaEmision: result.fechaEmision,
  },
});
```

### Query Status

```ts
const status = await provider.queryStatus({
  folio: '1',
  rutEmisor: '76123456-7',
  tipoDte: 52,
});
// status.status: 'accepted' | 'pending_sii_validation' | 'rejected' | 'cancelled'
```

### Manejo de errores

```ts
import {
  DteValidationError,
  DteRejectedBySiiError,
  DteCertificateError,
  DteProviderUnavailableError,
  DteFolioConflictError,
  DteNotFoundError,
} from '@booster-ai/dte-provider';

try {
  await provider.emitGuiaDespacho(input);
} catch (err) {
  if (err instanceof DteValidationError) {
    // 400 Bad Request — input inválido
    return c.json({ error: 'invalid_input', fields: err.fieldErrors }, 400);
  }
  if (err instanceof DteRejectedBySiiError) {
    // 422 Unprocessable Entity — SII rechazó por contenido
    return c.json({
      error: 'sii_rejected',
      sii_code: err.siiErrorCode,
      detail: err.siiErrorDetail,
    }, 422);
  }
  if (err instanceof DteCertificateError) {
    // 422 — certificado del emisor inválido o vencido
    return c.json({ error: 'certificate_invalid', rut: err.rutEmisor }, 422);
  }
  if (err instanceof DteFolioConflictError) {
    // 409 Conflict — folio ya en uso
    return c.json({ error: 'folio_conflict', folio: err.folio }, 409);
  }
  if (err instanceof DteProviderUnavailableError) {
    // 503 Service Unavailable — transient, reintentar
    return c.json({
      error: 'provider_down',
      retry_after_seconds: err.retryAfterSeconds,
    }, 503);
  }
  if (err instanceof DteNotFoundError) {
    // 404 Not Found
    return c.json({ error: 'dte_not_found' }, 404);
  }
  // Fallback 502
  throw err;
}
```

## MockDteProvider

Para tests + desarrollo local. Genera folios autoincrementales por `(rutEmisor, tipoDte)`, persiste en memoria, y soporta inyección de fallos:

```ts
// Tests del flujo de error
const provider = new MockDteProvider({
  failNextEmit: 'rejected_sii', // o 'certificate_error', 'unavailable', 'folio_conflict'
});
await expect(provider.emitGuiaDespacho(input)).rejects.toThrowError(
  DteRejectedBySiiError,
);

// Simulación de latencia para tests de timeout
const slow = new MockDteProvider({ artificialLatencyMs: 5000 });

// Folio inicial custom
const fromN = new MockDteProvider({ startingFolio: 1000 });
```

`environment` por default es `'certification'` para que ningún test claim "production" output accidentalmente. Si querés simular prod (sin emitir nada real, obvio): `new MockDteProvider({ environment: 'production' })`.

## Plan de migración a Bsale

Para implementar el adapter real:

1. **Crear `packages/dte-provider/src/bsale.ts`** con clase `BsaleAdapter implements DteProvider`.
2. **Auth**: Bsale usa API token + certificado digital del emisor. Token via env var; cert via Secret Manager (`carrier-{id}-cert-pfx` según ADR-007).
3. **Mapping**: traducir `GuiaDespachoInput` → request body Bsale (formato propio que Bsale convierte a XML SII).
4. **Error mapping**: traducir respuestas Bsale → errores tipados de este package:
   - HTTP 400 → `DteValidationError`
   - HTTP 422 con código SII → `DteRejectedBySiiError`
   - HTTP 401/403 sobre cert → `DteCertificateError`
   - HTTP 5xx → `DteProviderUnavailableError`
5. **Tests de integración** con sandbox Bsale (no production). Usar idempotency key para reintentos seguros.
6. **Switch en factory**: `apps/document-service` reemplaza `new MockDteProvider()` por `new BsaleAdapter({ apiKey, environment })`.

Estimación: 2-3 días dev + 2-3 días testing en sandbox SII.

## Testing del package

```bash
pnpm --filter @booster-ai/dte-provider typecheck
pnpm --filter @booster-ai/dte-provider test
```

## Referencias

- [ADR-007 — Chile Document Management](../../docs/adr/007-chile-document-management.md)
- SII — [Formato DTE](https://www.sii.cl/factura_electronica/formato_dte.htm)
- Ley 19.983 — [Guía de Despacho](https://bcn.cl/2jdwx)
- Ley 20.727 — [Factura Electrónica](https://bcn.cl/2xu0f)
- Bsale API — [https://api.bsale.dev/](https://api.bsale.dev/)
