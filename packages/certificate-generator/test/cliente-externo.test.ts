import { describe, expect, it } from 'vitest';
import { generarPdfBase } from '../src/generar-pdf-base.js';
import { CASOS } from './casos-pdf.js';
import { plano, textoPorPagina } from './texto-pdf.js';

/**
 * `.specs/frente2-cierre` §3.3 (D2): un viaje propio con cliente externo se
 * certifica bajo la transportista. El PDF nombra al cliente, no inventa un
 * generador de carga.
 */
describe('PDF de un viaje propio con cliente externo', () => {
  it('imprime «Cliente» con el nombre y RUT del cliente y no «Generador de carga»', async () => {
    const transportista = CASOS.normal?.transportista;
    if (!CASOS.normal || !transportista) {
      throw new Error('fixture sin caso normal');
    }
    const bytes = await generarPdfBase({
      ...CASOS.normal,
      // La titular del certificado (y de la ruta del PDF) es la transportista.
      empresaShipper: { id: 'transp', legalName: 'Transportes Ejemplo Ltda.', rut: '77.000.000-1' },
      clienteExterno: { nombre: 'Viña Santa Clara SpA', rut: '76.543.210-9' },
    });
    const texto = plano((await textoPorPagina(bytes)).join(' '));
    expect(texto).toContain('Cliente Viña Santa Clara SpA (76.543.210-9)');
    expect(texto).not.toContain('Generador de carga');
    expect(texto).toContain('Transportista Transportes Ejemplo Ltda. (77.000.000-1)');
  });

  it('sin cliente externo sigue imprimiendo el generador de carga', async () => {
    if (!CASOS.normal) {
      throw new Error('fixture sin caso normal');
    }
    const texto = plano((await textoPorPagina(await generarPdfBase(CASOS.normal))).join(' '));
    expect(texto).toContain('Generador de carga Logística del Sur SpA (76.123.456-K)');
    expect(texto).not.toMatch(/\bCliente\b/);
  });
});
