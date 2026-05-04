# @booster-ai/carta-porte-generator

Generador de **Carta de Porte** chilena conforme [Ley 18.290 del Tránsito Art. 174](https://bcn.cl/2f72s). Produce un PDF A4 portrait con todos los campos legales mínimos.

Implementa el diseño de [ADR-007 § "Carta de Porte (generación)"](../../docs/adr/007-chile-document-management.md).

## Estado actual

- ✅ Schema Zod completo (`CartaPorteInput`, `EmpresaInfo`, `ConductorInfo`, `VehiculoInfo`, `Ubicacion`, `CargaInfo`)
- ✅ PDF generation con `@react-pdf/renderer` v4
- ✅ 3 errores tipados (`CartaPorteError`, `CartaPorteValidationError`, `CartaPorteRenderError`)
- ✅ 14 tests
- ⏳ Firma KMS — fuera de scope (responsabilidad del caller, ver `packages/certificate-generator/firmar-pades`)

## Instalación

```jsonc
"dependencies": {
  "@booster-ai/carta-porte-generator": "workspace:*"
}
```

## Uso

```ts
import { generarCartaPorte } from '@booster-ai/carta-porte-generator';

const { pdfBuffer, sha256, sizeBytes } = await generarCartaPorte({
  trackingCode: 'BOO-ABC123',
  fechaEmision: new Date(),
  fechaSalida: new Date(Date.now() + 3600_000),
  duracionEstimadaHoras: 6,
  remitente: {
    rut: '12345678-9',
    razonSocial: 'Cliente SA',
    giro: 'Comercio mayorista',
    direccion: 'Av. Apoquindo 4500',
    comuna: 'Las Condes',
  },
  transportista: {
    rut: '76123456-7',
    razonSocial: 'Transportes Chile SpA',
    giro: 'Transporte de carga',
    direccion: 'Camino Lo Echevers 1234',
    comuna: 'Quilicura',
  },
  conductor: {
    rut: '11111111-1',
    nombreCompleto: 'Juan Pérez',
    numeroLicencia: 'LIC-12345',
    claseLicencia: 'A3', // A1-A5 para transporte comercial
  },
  vehiculo: {
    patente: 'AB-CD-12',
    marca: 'Volvo',
    modelo: 'FH 460',
    anio: 2022,
    capacidadKg: 25_000,
    tipoVehiculo: 'camion_pesado',
  },
  origen: {
    direccion: 'Av. Apoquindo 4500',
    comuna: 'Las Condes',
    region: 'Metropolitana',
  },
  destino: {
    direccion: 'Calle Comercio 100',
    comuna: 'Concepción',
    region: 'Biobío',
  },
  cargas: [{
    descripcion: 'Cemento ensacado',
    cantidad: 200,
    unidadMedida: 'sacos',
    pesoKg: 5_000,
    tipoCarga: 'construccion',
  }],
  observaciones: 'Entregar entre 9:00 y 13:00.',
  folioGuiaDte: 'DTE-52-12345', // opcional, si ya hay guía emitida
});

// Subir a Cloud Storage. La firma PAdES la hace el caller.
await uploadToGcs(pdfBuffer, `carta-porte/${trackingCode}.pdf`);
```

## Manejo de errores

```ts
import {
  CartaPorteValidationError,
  CartaPorteRenderError,
} from '@booster-ai/carta-porte-generator';

try {
  await generarCartaPorte(input);
} catch (err) {
  if (err instanceof CartaPorteValidationError) {
    // 400 Bad Request
    return c.json({ error: 'invalid_input', fields: err.fieldErrors }, 400);
  }
  if (err instanceof CartaPorteRenderError) {
    // 500 Internal — bug en el package o input que pasa Zod pero rompe @react-pdf
    logger.error({ err: err.cause }, 'PDF render failed');
    return c.json({ error: 'pdf_render_failed' }, 500);
  }
  throw err;
}
```

## Layout del PDF

A4 portrait, 1 página, secciones en orden:

1. **Header**: título "CARTA DE PORTE" + tracking code + fechas + folio DTE asociado
2. **Remitente** (Generador de Carga)
3. **Transportista** + **Conductor** (2 columnas)
4. **Vehículo** (patente, marca/modelo, tipo, capacidad)
5. **Ruta** (origen + destino + duración estimada)
6. **Tabla de cargas** (descripción / cantidad / unidad / peso) + total
7. **Observaciones** (opcional, fondo amarillo)
8. **Footer fijo** con referencia a Ley 18.290 + URL de verificación

Tipografía Helvetica embed-able en el bundle PDF, sin dependencia de fonts del sistema. Color institucional `#1FA058` (verde Booster) en el divider del header.

## Firma digital — quién la hace

**Este package NO firma**. El PDF retornado es plano (PAdES B-LT viene después).

Plan de firma típico en `apps/document-service`:

```ts
import { generarCartaPorte } from '@booster-ai/carta-porte-generator';
import { firmarPdfConPades } from '@booster-ai/certificate-generator';

const { pdfBuffer, sha256 } = await generarCartaPorte(input);
const signed = await firmarPdfConPades(pdfBuffer, {
  kmsKeyId: env.CARTA_PORTE_SIGNING_KEY_ID,
  signerName: 'Booster AI',
});
// signed.pdfBuffer ahora tiene la firma PAdES embebida
```

## Determinismo

Los tests verifican que el `sizeBytes` es idéntico para mismo input. El `sha256` puede variar si `@react-pdf/renderer` incluye `CreationDate` dinámico en el PDF metadata — eso depende de la versión. Si necesitás determinismo estricto del hash, normalizar el PDF post-render con `pdf-lib` removiendo metadata.

## Testing

```bash
pnpm --filter @booster-ai/carta-porte-generator typecheck
pnpm --filter @booster-ai/carta-porte-generator test
```

## Referencias

- [ADR-007 — Chile Document Management](../../docs/adr/007-chile-document-management.md)
- Ley 18.290 Art. 174 — [bcn.cl/2f72s](https://bcn.cl/2f72s)
- @react-pdf/renderer — [react-pdf.org](https://react-pdf.org/)
