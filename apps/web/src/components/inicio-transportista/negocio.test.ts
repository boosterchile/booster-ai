import { describe, expect, it } from 'vitest';
import type { DatosInicio } from './modelo.js';
import { INICIO_PLATA_ACTIVA, buildNegocioHoy, pesosClp } from './negocio.js';

const AHORA = new Date('2026-10-19T15:00:00.000Z');

function datos(sobre: Partial<DatosInicio> = {}): DatosInicio {
  return {
    ofertas: { estado: 'listo', valor: [] },
    servicios: { estado: 'listo', valor: [] },
    cumplimiento: { estado: 'listo', valor: { vencidos: 0, porVencer30d: 0, documentos: [] } },
    flota: { estado: 'listo', valor: [] },
    vehiculos: { estado: 'listo', valor: 1 },
    conductores: { estado: 'listo', valor: 1 },
    cobraHoy: 'disponible',
    ...sobre,
  };
}

describe('buildNegocioHoy', () => {
  it('cada bloque en cero tiene estado vacío o un aviso calmo, y plata sigue apagada', () => {
    const negocio = buildNegocioHoy(datos(), AHORA);
    expect(INICIO_PLATA_ACTIVA).toBe(false);
    expect(negocio.ofertas).toEqual({ estado: 'vacio' });
    expect(negocio.retiros).toEqual({ estado: 'vacio' });
    expect(negocio.senal.estado).toBe('listo');
    if (negocio.senal.estado === 'listo') {
      expect(negocio.senal.valor.titulo).toBe('Flota al día');
    }
    expect(negocio.documentos.estado).toBe('listo');
    if (negocio.documentos.estado === 'listo') {
      expect(negocio.documentos.valor.titulo).toBe('Documentos al día');
    }
  });

  it('carga y error quedan en el bloque y no en los demás', () => {
    const cargando = buildNegocioHoy(
      datos({
        ofertas: { estado: 'cargando' },
        servicios: { estado: 'error' },
        flota: { estado: 'cargando' },
      }),
      AHORA,
    );
    expect(cargando.ofertas).toEqual({ estado: 'cargando' });
    expect(cargando.retiros).toEqual({ estado: 'error' });
    expect(cargando.mapa).toEqual({ estado: 'cargando' });
    expect(cargando.documentos.estado).toBe('listo');
  });

  it('la oferta más próxima trae ruta, precio y vencimiento', () => {
    const negocio = buildNegocioHoy(
      datos({
        ofertas: {
          estado: 'listo',
          valor: [
            {
              expires_at: new Date(AHORA.getTime() + 5 * 60 * 60_000).toISOString(),
              precioClp: 1000,
              origen: 'Lejos, Puerto Montt',
              destino: 'Sur, Castro',
            },
            {
              expires_at: new Date(AHORA.getTime() + 3 * 60 * 60_000).toISOString(),
              precioClp: 420000,
              origen: 'Bodega, Santiago',
              destino: 'Centro, Rancagua',
            },
          ],
        },
      }),
      AHORA,
    );
    expect(negocio.ofertas).toEqual({
      estado: 'listo',
      valor: {
        cantidad: 2,
        ruta: 'Santiago → Rancagua',
        precio: pesosClp(420000),
        vence: 'vence en 3 h',
      },
    });
  });

  it('deja 5 retiros y una sola acción de asignar, en el primero sin conductor', () => {
    const servicios = Array.from({ length: 6 }, (_, indice) => ({
      id: `a-${indice}`,
      status: indice === 5 ? 'completado' : 'asignado',
      sinConductor: indice === 1 || indice === 3,
      pickupInicio: new Date(AHORA.getTime() + (indice + 1) * 60 * 60_000).toISOString(),
      direccionOrigen: `Bodega, Comuna${indice}`,
      direccionDestino: 'Puerto, Destino',
      patente: 'KXJR42',
      conductor: indice === 1 || indice === 3 ? null : 'Juan Pérez',
    }));
    const negocio = buildNegocioHoy(
      datos({ servicios: { estado: 'listo', valor: servicios } }),
      AHORA,
    );
    expect(negocio.retiros.estado).toBe('listo');
    if (negocio.retiros.estado !== 'listo') {
      return;
    }
    expect(negocio.retiros.valor).toHaveLength(5);
    const conAsignar = negocio.retiros.valor.filter((fila) => fila.asignarId != null);
    expect(conAsignar).toHaveLength(1);
    expect(conAsignar[0]?.asignarId).toBe('a-1');
    expect(negocio.retiros.valor[1]?.sinConductor).toBe(true);
    expect(negocio.retiros.valor[3]?.asignarId).toBeNull();
  });
});
