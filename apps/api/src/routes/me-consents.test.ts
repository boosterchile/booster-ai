import { describe, expect, it } from 'vitest';
import { grantBodySchema } from './me-consents.js';

const CATEGORIAS = [
  'emisiones_carbono',
  'rutas',
  'distancias',
  'combustibles',
  'certificados',
  'perfiles_vehiculos',
] as const;

const base = {
  stakeholder_id: 'a0000000-0000-4000-8000-000000000001',
  scope_type: 'transportista',
  scope_id: 'b0000000-0000-4000-8000-000000000002',
  consent_document_url: 'https://storage.googleapis.com/consentimientos/doc.pdf',
} as const;

describe('grantBodySchema: data_categories', () => {
  it('acepta todas las categorías', () => {
    expect(grantBodySchema.safeParse({ ...base, data_categories: [...CATEGORIAS] }).success).toBe(
      true,
    );
  });

  it('exige al menos una categoría, con el mensaje de siempre', () => {
    const result = grantBodySchema.safeParse({ ...base, data_categories: [] });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('al menos 1 categoría requerida');
  });

  it('rechaza más elementos que categorías existen', () => {
    const result = grantBodySchema.safeParse({
      ...base,
      data_categories: [...CATEGORIAS, 'rutas'],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual([
      expect.objectContaining({
        code: 'too_big',
        maximum: CATEGORIAS.length,
        path: ['data_categories'],
      }),
    ]);
  });

  it('comprueba el largo antes que los elementos: un solo issue', () => {
    const result = grantBodySchema.safeParse({
      ...base,
      data_categories: Array.from({ length: CATEGORIAS.length + 1 }, () => 'otra'),
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues).toHaveLength(1);
  });

  it('sigue rechazando una categoría desconocida dentro del tope', () => {
    const result = grantBodySchema.safeParse({ ...base, data_categories: ['rutas', 'otra'] });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['data_categories', 1]);
  });
});
