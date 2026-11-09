import { describe, expect, it } from 'vitest';
import type { DatosInicio } from '../inicio-transportista/modelo.js';
import { buildNegocioHoy } from '../inicio-transportista/negocio.js';
import { INICIO_FACTURADO_IVA_ACTIVO, INICIO_GASTO_GENERADOR_ACTIVO } from './flags.js';
import { type ViajeInicio, buildGeneradorHoy } from './generador.js';
import { buildMixtaHoy } from './mixta.js';

const AHORA = new Date('2026-10-19T16:30:00.000Z');

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

function viaje(sobre: Partial<ViajeInicio> & Pick<ViajeInicio, 'id' | 'status'>): ViajeInicio {
  return {
    trackingCode: sobre.id,
    origen: 'Bodega, Santiago',
    destino: 'Centro, Rancagua',
    pickupInicio: '2026-10-19T21:00:00.000Z',
    precioClp: 290000,
    transportista: null,
    avancePct: null,
    ofertasPendientes: null,
    ...sobre,
  };
}

function modelo(
  sobre: Partial<DatosInicio> = {},
  viajes: ViajeInicio[] = [],
  opts: { soloLectura?: boolean; filtro?: 'todo' | 'transporte' | 'generador' } = {},
) {
  const negocio = buildNegocioHoy(datos(sobre), AHORA);
  const generador = buildGeneradorHoy(
    { estado: 'listo', valor: viajes },
    { estado: 'listo', valor: [] },
    AHORA,
    { soloLectura: opts.soloLectura ?? false },
  );
  return buildMixtaHoy(negocio, generador, opts.filtro ?? 'todo', AHORA, {
    soloLectura: opts.soloLectura ?? false,
  });
}

describe('buildMixtaHoy', () => {
  it('en cero deja la plata sin monto y sin neto', () => {
    const hoy = modelo();
    expect(INICIO_FACTURADO_IVA_ACTIVO).toBe(false);
    expect(INICIO_GASTO_GENERADOR_ACTIVO).toBe(false);
    expect(hoy.ofertas).toEqual({ estado: 'vacio' });
    expect(hoy.cargas).toEqual({ estado: 'vacio' });
    expect(hoy.agenda).toEqual({ estado: 'vacio' });
    expect(hoy.facturado?.valor).toBeNull();
    expect(hoy.gasto?.valor).toBeNull();
    expect(hoy.plataTitulo).toBe('Plata octubre');
    expect(JSON.stringify(hoy)).not.toMatch(/neto/i);
  });

  it('arma una sola agenda con Transporte y Mi carga, ordenada por ventana', () => {
    const hoy = modelo(
      {
        servicios: {
          estado: 'listo',
          valor: [
            {
              id: 'a-tarde',
              status: 'asignado',
              sinConductor: true,
              pickupInicio: '2026-10-20T11:00:00.000Z',
              direccionOrigen: 'Bodega, Lampa',
              direccionDestino: 'Centro, Rancagua',
              patente: 'HFTD17',
            },
            {
              id: 'a-temprano',
              status: 'asignado',
              sinConductor: false,
              pickupInicio: '2026-10-19T19:30:00.000Z',
              direccionOrigen: 'Planta, Quilicura',
              direccionDestino: 'Puerto, San Antonio',
              patente: 'KXJR42',
              conductor: 'Juan Pérez',
            },
          ],
        },
      },
      [viaje({ id: 't-802', trackingCode: 'BST-4802', status: 'asignado' })],
    );
    expect(hoy.agenda.estado).toBe('listo');
    if (hoy.agenda.estado !== 'listo') {
      return;
    }
    expect(hoy.agenda.valor.map((fila) => fila.etiqueta)).toEqual([
      'Transporte',
      'Mi carga',
      'Transporte',
    ]);
    expect(hoy.agenda.valor.map((fila) => fila.hora)).toEqual(['16:30', '18:00', '08:00']);
    expect(hoy.agenda.valor[1]?.codigo).toBe('BST-4802');
    expect(hoy.agenda.valor[2]?.estado).toBe('Sin conductor');
    expect(hoy.agenda.valor[2]?.accion?.label).toBe('Asignar');
    expect(hoy.agenda.valor[0]?.accion).toBeUndefined();
  });

  it('el filtro esconde el lado que no corresponde y el visualizador asigna con Ver', () => {
    const base = {
      servicios: {
        estado: 'listo' as const,
        valor: [
          {
            id: 'a-1',
            status: 'asignado',
            sinConductor: true,
            pickupInicio: '2026-10-19T19:30:00.000Z',
            direccionOrigen: 'Bodega, Lampa',
            direccionDestino: 'Centro, Rancagua',
            patente: 'HFTD17',
          },
        ],
      },
      ofertas: {
        estado: 'listo' as const,
        valor: [
          {
            expires_at: '2026-10-19T19:30:00.000Z',
            precioClp: 420000,
            origen: 'Planta, Santiago',
            destino: 'Centro, Rancagua',
          },
        ],
      },
    };
    const viajes = [viaje({ id: 't-1', status: 'asignado' })];
    const transporte = modelo(base, viajes, { filtro: 'transporte' });
    expect(transporte.cargas).toBeNull();
    expect(transporte.gasto).toBeNull();
    expect(transporte.ofertas?.estado).toBe('listo');
    if (transporte.agenda.estado === 'listo') {
      expect(transporte.agenda.valor.every((fila) => fila.etiqueta === 'Transporte')).toBe(true);
    }
    const generador = modelo(base, viajes, { filtro: 'generador', soloLectura: true });
    expect(generador.ofertas).toBeNull();
    expect(generador.facturado).toBeNull();
    expect(generador.verMontos).toBe(false);
    const lectura = modelo(base, viajes, { soloLectura: true });
    if (lectura.agenda.estado === 'listo') {
      const asignar = lectura.agenda.valor.find((fila) => fila.accion);
      expect(asignar?.accion?.label).toBe('Ver');
    }
    if (lectura.ofertas?.estado === 'listo') {
      expect(lectura.ofertas.valor.precio).toBeNull();
    }
  });

  it('si un lado de la agenda falla, el otro sigue', () => {
    const hoy = modelo({ servicios: { estado: 'error' } }, [
      viaje({ id: 't-1', status: 'en_proceso', trackingCode: 'BST-4790' }),
    ]);
    expect(hoy.falloTransporte).toBe(true);
    expect(hoy.falloGenerador).toBe(false);
    expect(hoy.agenda.estado).toBe('listo');
    if (hoy.agenda.estado === 'listo') {
      expect(hoy.agenda.valor).toHaveLength(1);
      expect(hoy.agenda.valor[0]?.etiqueta).toBe('Mi carga');
    }
  });
});
