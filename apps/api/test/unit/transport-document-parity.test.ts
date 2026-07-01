import {
  docTypeSchema,
  documentSourceSchema,
  extractionStatusSchema,
} from '@booster-ai/shared-schemas';
import { describe, expect, it } from 'vitest';
import { docTypeEnum, documentSourceEnum, extractionStatusEnum } from '../../src/db/schema.js';

/**
 * Paridad DDL Drizzle (`documentos_transporte`) ↔ schema Zod de dominio
 * (`@booster-ai/shared-schemas` transport-document). Frente F4-4a (ADR-070).
 *
 * El enum SQL y el enum Zod son espejos manuales (el package shared-schemas
 * no importa Drizzle). Este test es la barrera anti-drift: cambiar un lado
 * sin el otro rompe acá. Mismo patrón que trip-state-machine-parity.
 */
describe('paridad documentos_transporte ↔ enums Zod dominio', () => {
  it('doc_type: DDL ≡ docTypeSchema (códigos SII literales + other)', () => {
    expect(docTypeEnum.enumValues).toEqual(docTypeSchema.options);
  });

  it('extraction_status: DDL ≡ extractionStatusSchema (5 estados español)', () => {
    expect(extractionStatusEnum.enumValues).toEqual(extractionStatusSchema.options);
  });

  it('source: DDL ≡ documentSourceSchema (3 orígenes)', () => {
    expect(documentSourceEnum.enumValues).toEqual(documentSourceSchema.options);
  });
});
