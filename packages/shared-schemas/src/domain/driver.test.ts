import { describe, expect, it } from 'vitest';
import { createDriverBodySchema } from './driver.js';

/**
 * El teléfono pasa a ser obligatorio.
 *
 * Decisión del PO (2026-08-03): «hazlo obligatorio, whatsapp va a ser el canal
 * principal». Los conductores chilenos de camión usan WhatsApp, no correo — y
 * medido en prod, 2 de 7 quedaron sin número, o sea inalcanzables por el canal
 * que más van a usar. Mismo razonamiento que llevó a exigir el email en la
 * Fase B: el dato no se perdió, nunca se pidió.
 */
describe('createDriverBodySchema — teléfono obligatorio (canal WhatsApp)', () => {
  const base = {
    rut: '5864136-7',
    full_name: 'Javier Poblete',
    email: 'fvp@live.cl',
    license_class: 'A5' as const,
    license_number: 'LIC-1',
    license_expiry: '2029-01-01',
  };

  it('sin teléfono NO valida', () => {
    const r = createDriverBodySchema.safeParse(base);
    expect(r.success).toBe(false);
  });

  it('con celular chileno en E.164 valida', () => {
    const r = createDriverBodySchema.safeParse({ ...base, phone: '+56957790379' });
    expect(r.success).toBe(true);
  });

  it('rechaza un número que no es chileno válido', () => {
    for (const malo of ['957790379', '+1 555 0100', '+569577903', 'no-es-telefono']) {
      expect(createDriverBodySchema.safeParse({ ...base, phone: malo }).success).toBe(false);
    }
  });

  it('rechaza un fijo +562: WhatsApp no llega a ese número', () => {
    const r = createDriverBodySchema.safeParse({ ...base, phone: '+56221234567' });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(
        r.error.issues.some((issue) => issue.message === 'Ingresa un teléfono válido (+569...)'),
      ).toBe(true);
    }
  });

  it('null explícito tampoco pasa', () => {
    expect(createDriverBodySchema.safeParse({ ...base, phone: null }).success).toBe(false);
  });
});
