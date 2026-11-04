import { describe, expect, it } from 'vitest';
import {
  type DatosInicio,
  buildInicioVista,
  comunaDesdeDireccion,
  contarFlota,
  fechaLargaEs,
  horaEnZona,
  inicialesEmpresa,
  nombreDePila,
  pasosAlta,
  saludoPorHora,
  textoProximoRetiro,
  textoVencimientoOferta,
} from './modelo.js';

function instanteConHora(objetivo: number): Date {
  const base = Date.parse('2026-06-15T12:00:00.000Z');
  for (let i = 0; i < 48; i += 1) {
    const fecha = new Date(base + i * 3_600_000);
    if (horaEnZona(fecha) === objetivo) {
      return fecha;
    }
  }
  throw new Error(`no hallé la hora ${objetivo} en America/Santiago`);
}

function datosVacios(sobre: Partial<DatosInicio> = {}): DatosInicio {
  return {
    ofertas: { estado: 'listo', valor: [] },
    servicios: { estado: 'listo', valor: [] },
    cumplimiento: { estado: 'listo', valor: { vencidos: 0, porVencer30d: 0, documentos: [] } },
    flota: { estado: 'listo', valor: [] },
    vehiculos: { estado: 'listo', valor: 4 },
    conductores: { estado: 'listo', valor: 2 },
    cobraHoy: 'disponible',
    ...sobre,
  };
}

const ctx = {
  nombreCompleto: 'Felipe Vicencio',
  legalName: 'Transportes Van Oosterwyk',
  esAdmin: false,
  ahora: new Date('2026-10-19T15:00:00.000Z'),
};

describe('saludo y fecha en America/Santiago', () => {
  it('parte el día a las 5, la tarde a las 12 y la noche a las 20', () => {
    expect(saludoPorHora(horaEnZona(instanteConHora(4)))).toBe('Buenas noches');
    expect(saludoPorHora(horaEnZona(instanteConHora(5)))).toBe('Buenos días');
    expect(saludoPorHora(horaEnZona(instanteConHora(11)))).toBe('Buenos días');
    expect(saludoPorHora(horaEnZona(instanteConHora(12)))).toBe('Buenas tardes');
    expect(saludoPorHora(horaEnZona(instanteConHora(19)))).toBe('Buenas tardes');
    expect(saludoPorHora(horaEnZona(instanteConHora(20)))).toBe('Buenas noches');
  });

  it('fecha larga en español, con el día de la semana en mayúscula', () => {
    const texto = fechaLargaEs(new Date('2026-10-19T15:00:00.000Z'));
    expect(texto.startsWith('Lunes')).toBe(true);
    expect(texto.toLowerCase()).toContain('19');
    expect(texto.toLowerCase()).toContain('octubre');
    expect(texto).not.toContain(',');
  });
});

describe('identidad de la empresa', () => {
  it('iniciales de las dos primeras palabras, sin la razón social', () => {
    expect(inicialesEmpresa('Transportes Van Oosterwyk')).toBe('TV');
    expect(inicialesEmpresa('Booster SpA')).toBe('BO');
    expect(nombreDePila('Felipe Vicencio')).toBe('Felipe');
    expect(nombreDePila('   ')).toBe('');
  });
});

describe('textos de atención', () => {
  it('vence en minutos o en horas', () => {
    const ahora = Date.parse('2026-10-19T15:00:00.000Z');
    expect(textoVencimientoOferta(new Date(ahora + 42 * 60_000).toISOString(), ahora)).toBe(
      'La próxima vence en 42 min',
    );
    expect(textoVencimientoOferta(new Date(ahora + 3 * 60 * 60_000).toISOString(), ahora)).toBe(
      'La próxima vence en 3 h',
    );
    expect(textoVencimientoOferta('no-es-fecha', ahora)).toBeNull();
    expect(textoVencimientoOferta(new Date(ahora - 60_000).toISOString(), ahora)).toBe(
      'La próxima está vencida',
    );
  });

  it('arma el retiro con hora de Santiago y omite la comuna si la dirección no la trae', () => {
    const ahora = new Date('2026-10-19T15:00:00.000Z');
    expect(comunaDesdeDireccion('Bodega norte, Quilicura')).toBe('Quilicura');
    expect(comunaDesdeDireccion('Av. Apoquindo 4500')).toBeNull();
    const conLugar = textoProximoRetiro(
      new Date(ahora.getTime() + 20 * 60 * 60_000).toISOString(),
      'Bodega norte, Quilicura',
      ahora,
    );
    expect(conLugar).toMatch(/^Retiro mañana \d{2}:\d{2} · Quilicura$/);
    expect(textoProximoRetiro(null, 'Av. Apoquindo 4500', ahora)).toBeNull();
  });
});

describe('flota', () => {
  it('separa conectados, sin señal (>30 min) y sin GPS', () => {
    const ahora = Date.parse('2026-10-19T15:00:00.000Z');
    const conteo = contarFlota(
      [
        {
          plate: 'AAAA11',
          teltonikaImei: '1',
          timestampDevice: new Date(ahora - 10 * 60_000).toISOString(),
          latitude: -33.4,
          longitude: -70.6,
        },
        {
          plate: 'HFTD17',
          teltonikaImei: '2',
          timestampDevice: new Date(ahora - 40 * 60_000).toISOString(),
          latitude: -33.4,
          longitude: -70.6,
        },
        {
          plate: 'KKLL99',
          teltonikaImei: null,
          timestampDevice: null,
          latitude: null,
          longitude: null,
        },
        {
          plate: 'DDDD44',
          teltonikaImei: '4',
          timestampDevice: new Date(ahora - 60_000).toISOString(),
          latitude: null,
          longitude: null,
        },
      ],
      ahora,
    );
    expect(conteo).toMatchObject({
      total: 4,
      conectados: 1,
      sinSenal: 1,
      sinGps: 2,
      patentesSinSenal: ['HFTD17'],
    });
  });

  it('no cuenta retirados y trata browser_gps por su posición', () => {
    const ahora = Date.parse('2026-10-19T15:00:00.000Z');
    const conteo = contarFlota(
      [
        {
          plate: 'RET11',
          status: 'retirado',
          teltonikaImei: '9',
          timestampDevice: new Date(ahora - 90 * 60_000).toISOString(),
          latitude: -33.4,
          longitude: -70.6,
        },
        {
          plate: 'CEL22',
          status: 'activo',
          teltonikaImei: null,
          teltonikaSource: 'browser_gps',
          timestampDevice: new Date(ahora - 5 * 60_000).toISOString(),
          latitude: -33.4,
          longitude: -70.6,
        },
      ],
      ahora,
    );
    expect(conteo).toMatchObject({
      total: 1,
      conectados: 1,
      sinSenal: 0,
      sinGps: 0,
      patentesSinSenal: [],
    });
  });
});

describe('alta', () => {
  it('marca hecho solo cuando ya existe al menos un ítem', () => {
    const pasos = pasosAlta({ vehiculos: 1, conductores: 0, documentos: 2 });
    expect(pasos.find((paso) => paso.id === 'empresa')?.hecho).toBe(true);
    expect(pasos.find((paso) => paso.id === 'vehiculo')?.hecho).toBe(true);
    expect(pasos.find((paso) => paso.id === 'conductores')?.hecho).toBe(false);
    expect(pasos.find((paso) => paso.id === 'documentos')?.hecho).toBe(true);
  });
});

describe('buildInicioVista', () => {
  it('oculta las filas en cero y no menciona Por cobrar', () => {
    const vista = buildInicioVista(datosVacios(), ctx);
    expect(vista.modo).toBe('operacion');
    expect(vista.atencion).toEqual({ tipo: 'calmo' });
    expect(vista.saludo).toBe(`${saludoPorHora(horaEnZona(ctx.ahora))}, Felipe`);
    expect(vista.saludo).not.toContain('Transportes');
    expect(vista.accesos.map((acceso) => acceso.label).join(' ')).not.toMatch(/por cobrar/i);
    expect(vista.accesos.some((acceso) => acceso.label === 'Cobra hoy')).toBe(true);
    expect(vista.accesos.some((acceso) => acceso.id === 'dispositivos')).toBe(false);
    expect(vista.enRuta).toEqual({ estado: 'listo', enRuta: 0, porRetirar: 0 });
  });

  it('dueño ve trayectos y dispositivos', () => {
    const vista = buildInicioVista(datosVacios(), { ...ctx, esAdmin: true });
    expect(vista.accesos.map((acceso) => acceso.to)).toEqual(
      expect.arrayContaining(['/app/trayectos', '/app/admin/dispositivos']),
    );
  });

  it('empresa nueva: sin vehículos, conductores ni documentos observados', () => {
    const vista = buildInicioVista(
      datosVacios({
        vehiculos: { estado: 'listo', valor: 0 },
        conductores: { estado: 'listo', valor: 0 },
      }),
      ctx,
    );
    expect(vista.modo).toBe('empresa-nueva');
    expect(vista.saludo).toBe('¡Bienvenido, Felipe!');
    expect(vista.fecha).toBeNull();
    expect(vista.enRuta).toBeNull();
    expect(vista.conectados).toBeNull();
    expect(vista.pasos?.filter((paso) => paso.hecho)).toHaveLength(1);
    expect(vista.atencion).toEqual({ tipo: 'calmo' });
  });

  it('un error aislado no se cuenta como cero ni apaga el resto', () => {
    const ahora = ctx.ahora.getTime();
    const vista = buildInicioVista(
      datosVacios({
        ofertas: {
          estado: 'listo',
          valor: [{ expires_at: new Date(ahora + 42 * 60_000).toISOString() }],
        },
        cumplimiento: { estado: 'error' },
      }),
      ctx,
    );
    expect(vista.atencion.tipo).toBe('filas');
    if (vista.atencion.tipo !== 'filas') {
      return;
    }
    expect(vista.atencion.pendientes).toBeNull();
    expect(vista.atencion.filas.map((fila) => fila.id)).toEqual(['ofertas', 'cumplimiento']);
    const ofertas = vista.atencion.filas[0];
    expect(ofertas?.kind).toBe('dato');
    if (ofertas?.kind === 'dato') {
      expect(ofertas.titulo).toBe('1 oferta por responder');
      expect(ofertas.subtitulo).toBe('La próxima vence en 42 min');
    }
    expect(
      vista.atencion.filas.some((fila) => fila.kind === 'error' && fila.bloque === 'Cumplimiento'),
    ).toBe(true);
  });

  it('arma las cuatro filas y los dos KPIs cuando hay datos', () => {
    const ahora = ctx.ahora.getTime();
    const vista = buildInicioVista(
      datosVacios({
        ofertas: {
          estado: 'listo',
          valor: [
            { expires_at: new Date(ahora + 90 * 60_000).toISOString() },
            { expires_at: new Date(ahora + 42 * 60_000).toISOString() },
            { expires_at: new Date(ahora + 4 * 60 * 60_000).toISOString() },
          ],
        },
        servicios: {
          estado: 'listo',
          valor: [
            {
              status: 'recogido',
              sinConductor: false,
              pickupInicio: null,
              direccionOrigen: 'Origen',
            },
            {
              status: 'asignado',
              sinConductor: true,
              pickupInicio: new Date(ahora + 20 * 60 * 60_000).toISOString(),
              direccionOrigen: 'Bodega norte, Quilicura',
            },
            {
              status: 'asignado',
              sinConductor: true,
              pickupInicio: new Date(ahora + 30 * 60 * 60_000).toISOString(),
              direccionOrigen: 'Planta, Santiago',
            },
          ],
        },
        cumplimiento: {
          estado: 'listo',
          valor: {
            vencidos: 4,
            porVencer30d: 3,
            documentos: [
              { tipo: 'soap', estado: 'vencido', referencia: 'KXJR42', clase: 'vehiculo' },
            ],
          },
        },
        flota: {
          estado: 'listo',
          valor: [
            {
              plate: 'HFTD17',
              teltonikaImei: 'a',
              timestampDevice: new Date(ahora - 40 * 60_000).toISOString(),
              latitude: -33,
              longitude: -70,
            },
            {
              plate: 'LBPW88',
              teltonikaImei: 'b',
              timestampDevice: new Date(ahora - 50 * 60_000).toISOString(),
              latitude: -33,
              longitude: -70,
            },
          ],
        },
      }),
      ctx,
    );
    if (vista.atencion.tipo !== 'filas') {
      throw new Error('se esperaban filas');
    }
    expect(vista.atencion.filas).toHaveLength(4);
    expect(vista.atencion.pendientes).toBe(4);
    expect(
      vista.atencion.filas.map((fila) => (fila.kind === 'dato' ? fila.titulo : fila.kind)),
    ).toEqual([
      '3 ofertas por responder',
      '2 servicios sin conductor',
      '4 documentos vencidos',
      '2 vehículos sin señal',
    ]);
    const docs = vista.atencion.filas[2];
    if (docs?.kind === 'dato') {
      expect(docs.subtitulo).toContain('+3 por vencer en 30 días');
      expect(docs.subtitulo).toContain('SOAP');
    }
    const senal = vista.atencion.filas[3];
    if (senal?.kind === 'dato') {
      expect(senal.subtitulo).toContain('Sin reportar +30 min');
      expect(senal.subtitulo).toContain('HF·TD·17');
      expect(senal.href).toBe('/app/flota');
    }
    expect(vista.enRuta).toEqual({ estado: 'listo', enRuta: 1, porRetirar: 2 });
    expect(vista.conectados).toMatchObject({
      estado: 'listo',
      conectados: 0,
      sinSenal: 2,
      total: 2,
    });
    expect(vista.accesos.find((acceso) => acceso.id === 'ofertas')?.badge).toBe(3);
    expect(vista.accesos.find((acceso) => acceso.id === 'servicios')?.badge).toBe(2);
    expect(vista.accesos.find((acceso) => acceso.id === 'cumplimiento')?.badge).toBe(4);
    expect(vista.accesos.find((acceso) => acceso.id === 'flota')?.testId).toBe(
      'dashboard-link-flota',
    );
  });

  it('el saludo usa el primer nombre y no la empresa', () => {
    const vista = buildInicioVista(datosVacios(), {
      ...ctx,
      nombreCompleto: 'María José Pérez',
      legalName: 'Transportes Van Oosterwyk',
    });
    expect(vista.saludo).toBe(`${saludoPorHora(horaEnZona(ctx.ahora))}, María`);
    expect(vista.empresa).toBe('Transportes Van Oosterwyk');
  });

  it('sin nombre deja el saludo de la hora, sin la empresa', () => {
    const hora = saludoPorHora(horaEnZona(ctx.ahora));
    for (const nombreCompleto of ['', '   ']) {
      const vista = buildInicioVista(datosVacios(), { ...ctx, nombreCompleto });
      expect(vista.saludo).toBe(hora);
      expect(vista.saludo).not.toContain('Transportes');
    }
  });

  it('dos vehículos sin señal son una fila y un pendiente', () => {
    const ahora = ctx.ahora.getTime();
    const vista = buildInicioVista(
      datosVacios({
        flota: {
          estado: 'listo',
          valor: [
            {
              plate: 'HFTD17',
              teltonikaImei: 'a',
              timestampDevice: new Date(ahora - 40 * 60_000).toISOString(),
              latitude: -33,
              longitude: -70,
            },
            {
              plate: 'LBPW88',
              teltonikaImei: 'b',
              timestampDevice: new Date(ahora - 50 * 60_000).toISOString(),
              latitude: -33,
              longitude: -70,
            },
          ],
        },
      }),
      ctx,
    );
    if (vista.atencion.tipo !== 'filas') {
      throw new Error('se esperaba una fila');
    }
    expect(vista.atencion.filas).toHaveLength(1);
    expect(vista.atencion.filas[0]?.kind === 'dato' && vista.atencion.filas[0].titulo).toBe(
      '2 vehículos sin señal',
    );
    expect(vista.atencion.pendientes).toBe(1);
  });

  it('mientras faltan vehículos no declara empresa nueva', () => {
    const vista = buildInicioVista(datosVacios({ vehiculos: { estado: 'cargando' } }), ctx);
    expect(vista.modo).toBe('resolviendo');
    expect(vista.pasos).toBeNull();
    expect(vista.enRuta?.estado).toBe('listo');
  });
});
