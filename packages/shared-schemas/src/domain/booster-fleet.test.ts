import { describe, expect, it } from 'vitest';
import {
  type EntradaPanelBoosterFleet,
  type MantencionEntrada,
  type TrayectoBoosterFleet,
  type VehiculoBoosterFleet,
  clasificarMantencion,
  componerPanelBoosterFleet,
  fechaEnZona,
  panelBoosterFleetSchema,
  programarMantencionSchema,
} from './booster-fleet.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const D = '44444444-4444-4444-8444-444444444444';
const CONDUCTOR = '55555555-5555-4555-8555-555555555555';
const M1 = '66666666-6666-4666-8666-666666666666';
const M2 = '77777777-7777-4777-8777-777777777777';
const HOY = '2026-11-17';

function vehiculo(
  id: string,
  patente: string,
  extra: Partial<VehiculoBoosterFleet> = {},
): VehiculoBoosterFleet {
  return {
    id,
    patente,
    estado: 'activo',
    tieneTeltonika: true,
    ...extra,
  };
}

function trayecto(
  vehiculoId: string,
  extra: Partial<TrayectoBoosterFleet> = {},
): TrayectoBoosterFleet {
  return {
    vehiculoId,
    litrosConsumidos: 30,
    kmCubiertos: 100,
    kmPorLitro: 100 / 30,
    notaCombustible: null,
    posibleRoboCombustible: false,
    posibleRoboHormiga: false,
    ctaCapacidadEstanque: false,
    fuenteCombustible: 'consumo_can',
    ...extra,
  };
}

function entrada(parcial: Partial<EntradaPanelBoosterFleet> = {}): EntradaPanelBoosterFleet {
  return {
    hoy: HOY,
    desde: '2026-11-10T12:00:00.000Z',
    hasta: '2026-11-17T12:00:00.000Z',
    truncado: false,
    mantencionesTruncadas: false,
    vehiculos: [],
    trayectos: [],
    documentosVehiculo: [],
    conductores: [],
    documentosConductor: [],
    mantenciones: [],
    ...parcial,
  };
}

function mantencion(parcial: Partial<MantencionEntrada> = {}): MantencionEntrada {
  return {
    id: M1,
    vehiculoId: A,
    patente: 'AAAA11',
    tipo: 'preventiva',
    titulo: 'Cambio de aceite',
    programadaPara: '2026-12-20',
    kilometrajeObjetivo: 120_000,
    realizadaEn: null,
    canceladaEn: null,
    notas: null,
    ...parcial,
  };
}

describe('fechaEnZona', () => {
  it('usa el día de America/Santiago, no el UTC', () => {
    expect(fechaEnZona(new Date('2026-11-17T02:00:00.000Z'), 'America/Santiago')).toBe(
      '2026-11-16',
    );
    expect(fechaEnZona(new Date('2026-11-17T15:00:00.000Z'), 'America/Santiago')).toBe(
      '2026-11-17',
    );
  });

  it('una zona inválida cae a America/Santiago', () => {
    expect(fechaEnZona(new Date('2026-11-17T02:00:00.000Z'), 'No/Existe')).toBe('2026-11-16');
  });
});

describe('combustible', () => {
  it('el robo gana aunque el camión no tenga Teltonika', () => {
    const panel = componerPanelBoosterFleet(
      entrada({
        vehiculos: [vehiculo(A, 'ROBO11', { tieneTeltonika: false })],
        trayectos: [trayecto(A, { posibleRoboCombustible: true, posibleRoboHormiga: true })],
      }),
    );
    expect(panel.configuracion.nombre).toBe('Booster Fleet');
    expect(panel.configuracion.servicio).toBe('gestion_de_flota');
    expect(panel.combustible.vehiculos[0]).toMatchObject({
      senal: 'posible_robo',
      alertas: ['golpe', 'hormiga'],
    });
    expect(panel.combustible.con_alerta).toBe(1);
  });

  it('sin equipo, sin movimiento y sin sensor quedan en ese orden', () => {
    const panel = componerPanelBoosterFleet(
      entrada({
        vehiculos: [
          vehiculo(A, 'SIN001', { tieneTeltonika: false }),
          vehiculo(B, 'QUI002'),
          vehiculo(C, 'SEN003'),
        ],
        trayectos: [
          trayecto(C, {
            fuenteCombustible: null,
            litrosConsumidos: null,
            kmCubiertos: null,
            kmPorLitro: null,
          }),
        ],
      }),
    );
    expect(panel.combustible.vehiculos.map((v) => v.senal)).toEqual([
      'sin_telemetria',
      'sin_sensor',
      'sin_movimiento',
    ]);
  });

  it('falta de capacidad y dato no confiable no inventan L/100 km', () => {
    const panel = componerPanelBoosterFleet(
      entrada({
        vehiculos: [vehiculo(A, 'CAP001'), vehiculo(B, 'DAT002')],
        trayectos: [
          trayecto(A, {
            fuenteCombustible: 'nivel_porcentaje',
            ctaCapacidadEstanque: true,
            litrosConsumidos: null,
            kmCubiertos: null,
            kmPorLitro: null,
          }),
          trayecto(B, {
            litrosConsumidos: 12,
            kmCubiertos: null,
            kmPorLitro: null,
            notaCombustible: 'dato no confiable · cobertura baja',
          }),
        ],
      }),
    );
    const porPatente = new Map(panel.combustible.vehiculos.map((v) => [v.patente, v]));
    expect(porPatente.get('CAP001')).toMatchObject({
      senal: 'falta_capacidad',
      litros_por_100_km: null,
      alertas: ['falta_capacidad'],
    });
    expect(porPatente.get('DAT002')).toMatchObject({
      senal: 'dato_no_confiable',
      litros: 12,
      litros_por_100_km: null,
    });
  });

  it('el consumo alto exige dos pares y superar el 25 %, no igualarlo', () => {
    const justo = componerPanelBoosterFleet(
      entrada({
        vehiculos: [vehiculo(A, 'AAA001'), vehiculo(B, 'BBB002'), vehiculo(C, 'CCC003')],
        trayectos: [
          trayecto(A, { litrosConsumidos: 40, kmPorLitro: 2.5 }),
          trayecto(B, { litrosConsumidos: 40, kmPorLitro: 2.5 }),
          trayecto(C, { litrosConsumidos: 50, kmPorLitro: 2 }),
        ],
      }),
    );
    expect(justo.combustible.vehiculos.find((v) => v.vehiculo_id === C)?.senal).toBe('en_orden');

    const sobre = componerPanelBoosterFleet(
      entrada({
        vehiculos: [vehiculo(A, 'AAA001'), vehiculo(B, 'BBB002'), vehiculo(C, 'CCC003')],
        trayectos: [
          trayecto(A, { litrosConsumidos: 40, kmPorLitro: 2.5 }),
          trayecto(B, { litrosConsumidos: 40, kmPorLitro: 2.5 }),
          trayecto(C, { litrosConsumidos: 51, kmPorLitro: 100 / 51 }),
        ],
      }),
    );
    expect(sobre.combustible.vehiculos.find((v) => v.vehiculo_id === C)?.senal).toBe(
      'consumo_alto',
    );
    expect(sobre.combustible.litros_por_100_km).toBe(43.7);

    const unPar = componerPanelBoosterFleet(
      entrada({
        vehiculos: [vehiculo(A, 'AAA001'), vehiculo(C, 'CCC003')],
        trayectos: [
          trayecto(A, { litrosConsumidos: 20, kmPorLitro: 5 }),
          trayecto(C, { litrosConsumidos: 80, kmPorLitro: 1.25 }),
        ],
      }),
    );
    expect(unPar.combustible.vehiculos.every((v) => v.senal === 'en_orden')).toBe(true);
  });

  it('bajo 50 km confiables no se compara, y un tramo corto queda en orden', () => {
    const panel = componerPanelBoosterFleet(
      entrada({
        vehiculos: [
          vehiculo(A, 'COR001'),
          vehiculo(B, 'BAS002'),
          vehiculo(C, 'BAS003'),
          vehiculo(M1, 'SHO004'),
        ],
        trayectos: [
          trayecto(A, { kmCubiertos: 40, litrosConsumidos: 20, kmPorLitro: 2 }),
          trayecto(B),
          trayecto(C),
          trayecto(M1, {
            litrosConsumidos: 4,
            kmCubiertos: null,
            kmPorLitro: null,
            notaCombustible: 'El nivel no bajó',
          }),
        ],
        truncado: true,
      }),
    );
    expect(panel.combustible.vehiculos.find((v) => v.vehiculo_id === A)?.senal).toBe('en_orden');
    expect(panel.combustible.truncado).toBe(true);
    expect(panel.combustible.litros).toBe(84);
  });

  it('ignora el trayecto de un vehículo que no está en la flota y al retirado', () => {
    const panel = componerPanelBoosterFleet(
      entrada({
        vehiculos: [vehiculo(A, 'ACT001'), vehiculo(B, 'RET002', { estado: 'retirado' })],
        trayectos: [trayecto(B, { litrosConsumidos: 80 }), trayecto(D, { litrosConsumidos: 80 })],
      }),
    );
    expect(panel.combustible.vehiculos.map((v) => v.patente)).toEqual(['ACT001']);
    expect(panel.combustible.litros).toBeNull();
  });
});

describe('documental', () => {
  it('cada vehículo lista los obligatorios que faltan', () => {
    const panel = componerPanelBoosterFleet(
      entrada({
        vehiculos: [vehiculo(A, 'DOC001')],
        documentosVehiculo: [
          { duenoId: A, tipo: 'soap', fechaVencimiento: '2026-12-01' },
          { duenoId: A, tipo: 'permiso_circulacion', fechaVencimiento: '2027-03-01' },
          { duenoId: A, tipo: 'revision_tecnica', fechaVencimiento: null },
          { duenoId: A, tipo: 'seguro_carga', fechaVencimiento: '2026-11-20' },
          { duenoId: A, tipo: 'padron', fechaVencimiento: null },
          { duenoId: A, tipo: 'poliza_responsabilidad', fechaVencimiento: '2027-01-01' },
        ],
      }),
    );
    const vehiculoDoc = panel.documental.vehiculos[0];
    expect(vehiculoDoc?.al_dia).toBe(false);
    expect(vehiculoDoc?.estado).toBe('sin_fecha');
    expect(vehiculoDoc?.documentos.map((d) => d.tipo)).toEqual([
      'padron',
      'revision_tecnica',
      'seguro_carga',
      'soap',
      'permiso_circulacion',
    ]);
    expect(panel.documental.vehiculos_con_hallazgo).toBe(1);
    expect(panelBoosterFleetSchema.parse(panel).configuracion.slug).toBe('booster-fleet');
  });

  it('vence hoy está por vencer; a 31 días está vigente; ayer está vencido', () => {
    const panel = componerPanelBoosterFleet(
      entrada({
        vehiculos: [vehiculo(A, 'HOY001'), vehiculo(B, 'LEJ002'), vehiculo(C, 'VEN003')],
        documentosVehiculo: [
          ...['revision_tecnica', 'permiso_circulacion', 'soap'].flatMap((tipo) => [
            { duenoId: A, tipo, fechaVencimiento: HOY },
            { duenoId: B, tipo, fechaVencimiento: '2026-12-18' },
            { duenoId: C, tipo, fechaVencimiento: '2026-11-16' },
          ]),
        ],
      }),
    );
    const porId = new Map(panel.documental.vehiculos.map((v) => [v.vehiculo_id, v]));
    expect(porId.get(A)?.al_dia).toBe(false);
    expect(porId.get(A)?.documentos[0]?.estado).toBe('por_vencer');
    expect(porId.get(B)?.al_dia).toBe(true);
    expect(porId.get(C)?.estado).toBe('vencido');
    expect(panel.documental.vehiculos.map((v) => v.vehiculo_id)).toEqual([C, A, B]);
  });

  it('si hay una fila vigente y otra vencida del mismo tipo, manda la vigente', () => {
    const panel = componerPanelBoosterFleet(
      entrada({
        vehiculos: [vehiculo(A, 'REN001')],
        documentosVehiculo: ['revision_tecnica', 'permiso_circulacion', 'soap'].flatMap((tipo) => [
          { duenoId: A, tipo, fechaVencimiento: '2027-02-01' },
          { duenoId: A, tipo, fechaVencimiento: '2027-06-01' },
        ]),
      }),
    );
    expect(panel.documental.vehiculos[0]?.al_dia).toBe(true);
    expect(panel.documental.vehiculos[0]?.documentos[0]?.fecha_vencimiento).toBe('2027-06-01');
  });

  it('la licencia sin archivo y el psicotécnico faltante no dejan al conductor al día', () => {
    const panel = componerPanelBoosterFleet(
      entrada({
        conductores: [
          {
            id: CONDUCTOR,
            nombre: 'Ana Soto',
            rut: '12.345.678-5',
            licenciaVencimiento: '2027-01-01',
          },
          {
            id: D,
            nombre: 'Benito Díaz',
            rut: '9.876.543-2',
            licenciaVencimiento: '2026-01-01',
          },
        ],
        documentosConductor: [
          { duenoId: D, tipo: 'licencia_conducir', fechaVencimiento: '2027-08-01' },
          { duenoId: D, tipo: 'examen_psicotecnico', fechaVencimiento: '2027-08-01' },
          { duenoId: CONDUCTOR, tipo: 'curso_b6', fechaVencimiento: '2026-11-20' },
        ],
      }),
    );
    const ana = panel.documental.conductores.find((c) => c.conductor_id === CONDUCTOR);
    const benito = panel.documental.conductores.find((c) => c.conductor_id === D);
    expect(ana?.documentos.find((d) => d.tipo === 'licencia_conducir')).toMatchObject({
      estado: 'sin_archivo',
      archivo: false,
    });
    expect(ana?.documentos.find((d) => d.tipo === 'examen_psicotecnico')?.estado).toBe('faltante');
    expect(ana?.documentos.some((d) => d.tipo === 'curso_b6')).toBe(true);
    expect(ana?.al_dia).toBe(false);
    expect(benito?.al_dia).toBe(false);
    expect(benito?.documentos.find((d) => d.tipo === 'licencia_conducir')?.estado).toBe('vencido');
    expect(panel.documental.conductores_al_dia).toBe(0);
    expect(panel.documental.conductores.map((c) => c.nombre)[0]).toBe('Benito Díaz');
  });

  it('una fecha ilegible queda sin fecha', () => {
    const panel = componerPanelBoosterFleet(
      entrada({
        vehiculos: [vehiculo(A, 'MAL001')],
        documentosVehiculo: [
          { duenoId: A, tipo: 'revision_tecnica', fechaVencimiento: 'ayer' },
          { duenoId: A, tipo: 'permiso_circulacion', fechaVencimiento: '2027-01-01' },
          { duenoId: A, tipo: 'soap', fechaVencimiento: '2027-01-01' },
        ],
      }),
    );
    expect(panel.documental.vehiculos[0]?.documentos[0]).toMatchObject({
      tipo: 'revision_tecnica',
      estado: 'sin_fecha',
    });
  });
});

describe('mantenciones', () => {
  it('clasifica vencida, próxima, programada y realizada; omite la cancelada', () => {
    const ayer = clasificarMantencion(mantencion({ programadaPara: '2026-11-16' }), HOY);
    const hoy = clasificarMantencion(mantencion({ programadaPara: HOY }), HOY);
    const en15 = clasificarMantencion(mantencion({ programadaPara: '2026-12-02' }), HOY);
    const lejos = clasificarMantencion(mantencion({ programadaPara: '2026-12-03' }), HOY);
    const hecha = clasificarMantencion(
      mantencion({ programadaPara: '2026-11-01', realizadaEn: '2026-11-10T15:00:00.000Z' }),
      HOY,
    );
    const cancelada = clasificarMantencion(
      mantencion({ canceladaEn: '2026-11-10T15:00:00.000Z' }),
      HOY,
    );
    const rota = clasificarMantencion(mantencion({ programadaPara: 'no-fecha' }), HOY);
    expect(ayer?.estado).toBe('vencida');
    expect(hoy?.estado).toBe('proxima');
    expect(en15?.estado).toBe('proxima');
    expect(lejos?.estado).toBe('programada');
    expect(hecha?.estado).toBe('realizada');
    expect(cancelada).toBeNull();
    expect(rota?.estado).toBe('vencida');
  });

  it('ordena el panel y marca el camión que está en taller', () => {
    const panel = componerPanelBoosterFleet(
      entrada({
        vehiculos: [vehiculo(A, 'TAL001', { estado: 'mantenimiento' }), vehiculo(B, 'RUT002')],
        mantenciones: [
          mantencion({ id: M2, programadaPara: '2026-12-20', titulo: 'Lejana' }),
          mantencion({ programadaPara: '2026-11-01', titulo: 'Atrasada' }),
          mantencion({
            id: D,
            vehiculoId: B,
            patente: 'RUT002',
            programadaPara: '2026-11-01',
            realizadaEn: '2026-11-02T12:00:00.000Z',
            titulo: 'Hecha',
          }),
          mantencion({
            id: C,
            canceladaEn: '2026-11-02T12:00:00.000Z',
            titulo: 'No va',
          }),
        ],
        mantencionesTruncadas: true,
      }),
    );
    expect(panel.mantenciones.items.map((item) => item.titulo)).toEqual([
      'Atrasada',
      'Lejana',
      'Hecha',
    ]);
    expect(panel.mantenciones).toMatchObject({
      vencidas: 1,
      proximas: 0,
      programadas: 1,
      truncadas: true,
      en_taller: [{ vehiculo_id: A, patente: 'TAL001' }],
    });
  });
});

describe('programarMantencionSchema', () => {
  it('recorta el título y descarta notas vacías', () => {
    const parsed = programarMantencionSchema.parse({
      vehiculo_id: A,
      tipo: 'correctiva',
      titulo: '  Freno  ',
      programada_para: '2026-11-20',
      notas: '   ',
    });
    expect(parsed.titulo).toBe('Freno');
    expect(parsed.notas).toBeUndefined();
  });

  it('rechaza un día imposible y un título corto', () => {
    expect(
      programarMantencionSchema.safeParse({
        vehiculo_id: A,
        tipo: 'preventiva',
        titulo: 'ok',
        programada_para: '2026-02-31',
      }).success,
    ).toBe(false);
  });
});
