import { describe, expect, it } from 'vitest';
import { INICIO_GASTO_GENERADOR_ACTIVO, INICIO_GENERADOR_VE_OFERTAS } from './flags.js';
import {
  type CertificadoInicio,
  type ViajeInicio,
  buildGeneradorHoy,
  textoHuella,
} from './generador.js';
import type { Panel } from './generador.js';

const AHORA = new Date('2026-10-19T15:00:00.000Z');

function viaje(sobre: Partial<ViajeInicio> & Pick<ViajeInicio, 'id' | 'status'>): ViajeInicio {
  return {
    trackingCode: sobre.id,
    origen: 'Bodega, Santiago',
    destino: 'Centro, Rancagua',
    pickupInicio: '2026-10-20T12:00:00.000Z',
    precioClp: 1000,
    transportista: null,
    avancePct: null,
    ofertasPendientes: null,
    ...sobre,
  };
}

function listo<T>(valor: T): Panel<T> {
  return { estado: 'listo', valor };
}

describe('buildGeneradorHoy', () => {
  it('en cero no inventa gasto y la huella queda en cero', () => {
    const negocio = buildGeneradorHoy(listo([]), listo([]), AHORA, { soloLectura: false });
    expect(INICIO_GASTO_GENERADOR_ACTIVO).toBe(false);
    expect(negocio.gastoActivo).toBe(false);
    expect(negocio.cargas).toEqual({ estado: 'vacio' });
    expect(negocio.agenda).toEqual({ estado: 'vacio' });
    expect(negocio.huella.estado).toBe('listo');
    if (negocio.huella.estado === 'listo') {
      expect(negocio.huella.valor.detalle).toBe('Sin certificados este mes');
    }
    expect(negocio.avisos[0]?.titulo).toBe('Certificados al día');
  });

  it('destaca la carga sin match que se retira primero y cuenta el pipeline', () => {
    const viajes: ViajeInicio[] = [
      viaje({
        id: 'tarde',
        status: 'ofertas_enviadas',
        trackingCode: 'BST-4825',
        pickupInicio: '2026-10-21T15:00:00.000Z',
        ofertasPendientes: 1,
      }),
      viaje({
        id: 'pronto',
        status: 'esperando_match',
        trackingCode: 'BST-4821',
        pickupInicio: '2026-10-20T12:00:00.000Z',
        ofertasPendientes: 4,
        origen: 'Planta, Lampa',
        destino: 'Puerto, Valparaíso',
      }),
      viaje({
        id: 'asig',
        status: 'asignado',
        trackingCode: 'BST-4802',
        transportista: 'Logística Andes',
        avancePct: 50,
      }),
      viaje({
        id: 'ruta',
        status: 'en_proceso',
        trackingCode: 'BST-4790',
        transportista: 'Van Oosterwyk',
        avancePct: 75,
        origen: 'Bodega, Quilicura',
        destino: 'Puerto, Concepción',
      }),
    ];
    const negocio = buildGeneradorHoy(listo(viajes), listo([]), AHORA, { soloLectura: false });
    expect(negocio.cargas.estado).toBe('listo');
    if (negocio.cargas.estado !== 'listo') {
      return;
    }
    expect(negocio.cargas.valor.buscando).toBe(2);
    expect(negocio.cargas.valor.asignadas).toBe(1);
    expect(negocio.cargas.valor.enCamino).toBe(1);
    expect(negocio.cargas.valor.destacada?.codigo).toContain('BST-4821');
    expect(INICIO_GENERADOR_VE_OFERTAS).toBe(false);
    expect(negocio.cargas.valor.destacada?.detalle).not.toContain('ofertas enviadas');
    expect(negocio.agenda.estado).toBe('listo');
    if (negocio.agenda.estado === 'listo') {
      const enRuta = negocio.agenda.valor.find((fila) => fila.codigo === 'BST-4790');
      expect(enRuta?.transportista).toBe('Van Oosterwyk');
      expect(enRuta?.avancePct).toBe(75);
      expect(enRuta?.href).toBe('/app/cargas/ruta/track');
    }
    expect(negocio.mapa.pins).toHaveLength(1);
  });

  it('la huella del mes suma los certificados y avisa los nuevos', () => {
    const certs: CertificadoInicio[] = [
      {
        trackingCode: 'BST-1',
        kg: 2500,
        emitidoEn: '2026-10-18T12:00:00.000Z',
        origen: 'A',
        destino: 'B',
      },
      {
        trackingCode: 'BST-2',
        kg: 2300,
        emitidoEn: '2026-10-02T12:00:00.000Z',
        origen: 'A',
        destino: 'B',
      },
      {
        trackingCode: 'viejo',
        kg: 9000,
        emitidoEn: '2026-09-01T12:00:00.000Z',
        origen: 'A',
        destino: 'B',
      },
    ];
    const negocio = buildGeneradorHoy(listo([]), listo(certs), AHORA, { soloLectura: false });
    expect(negocio.huella).toEqual({
      estado: 'listo',
      valor: { texto: textoHuella(4800), detalle: '2 certificados' },
    });
    expect(negocio.avisos[0]?.titulo).toBe('1 certificado nuevo');
  });

  it('un bloque caído no apaga el otro, y el visualizador no ve montos', () => {
    const negocio = buildGeneradorHoy({ estado: 'error' }, { estado: 'cargando' }, AHORA, {
      soloLectura: true,
    });
    expect(negocio.cargas).toEqual({ estado: 'error' });
    expect(negocio.huella).toEqual({ estado: 'cargando' });
    expect(negocio.verMontos).toBe(false);
    expect(negocio.gastoActivo).toBe(false);
  });
});
