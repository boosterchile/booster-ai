import { describe, expect, it } from 'vitest';
import { clienteExternoDelCertificado, titularCertificado } from './titular-certificado.js';

/** `.specs/frente2-cierre` §3.3 (D2): quién es la titular del certificado. */
describe('titularCertificado', () => {
  it('con generador: el generador, venga de donde venga el viaje', () => {
    expect(
      titularCertificado({ generadorCargaEmpresaId: 'gen', origenAlta: 'marketplace' }, 'tra'),
    ).toBe('gen');
    expect(
      titularCertificado(
        { generadorCargaEmpresaId: 'gen', origenAlta: 'propio_transportista' },
        'tra',
      ),
    ).toBe('gen');
  });

  it('viaje propio sin generador: la transportista', () => {
    expect(
      titularCertificado(
        { generadorCargaEmpresaId: null, origenAlta: 'propio_transportista' },
        'tra',
      ),
    ).toBe('tra');
  });

  it('del marketplace sin generador (WhatsApp antes del vínculo): nadie', () => {
    expect(
      titularCertificado({ generadorCargaEmpresaId: null, origenAlta: 'marketplace' }, 'tra'),
    ).toBeNull();
  });

  it('viaje propio sin asignación: nadie', () => {
    expect(
      titularCertificado(
        { generadorCargaEmpresaId: null, origenAlta: 'propio_transportista' },
        null,
      ),
    ).toBeNull();
  });
});

describe('clienteExternoDelCertificado', () => {
  it('solo un viaje propio sin generador y con nombre tiene cliente externo', () => {
    const propio = {
      generadorCargaEmpresaId: null,
      origenAlta: 'propio_transportista',
      clienteExternoNombre: 'Viña Santa Clara SpA',
      clienteExternoRut: '76.543.210-9',
    };
    expect(clienteExternoDelCertificado(propio)).toEqual({
      nombre: 'Viña Santa Clara SpA',
      rut: '76.543.210-9',
    });
    expect(clienteExternoDelCertificado({ ...propio, clienteExternoRut: null })).toEqual({
      nombre: 'Viña Santa Clara SpA',
      rut: null,
    });
    expect(clienteExternoDelCertificado({ ...propio, generadorCargaEmpresaId: 'gen' })).toBeNull();
    expect(clienteExternoDelCertificado({ ...propio, origenAlta: 'marketplace' })).toBeNull();
  });
});
