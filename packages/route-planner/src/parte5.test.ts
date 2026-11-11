import { describe, expect, it } from 'vitest';
import {
  type Configuracion,
  type Parada,
  type Ruta,
  type ServicioDeRuta,
  agregarServicio,
  avisosDeRuta,
  declararConductor,
  declararConfiguracion,
  moverServicio,
  quitarServicio,
  reordenarParadas,
  rutaDeUnServicio,
  separarServicio,
  serviciosEnMasDeUnaRuta,
  validarRuta,
} from './index.js';

/**
 * Lo que la API de rutas necesita del paquete (plan de ruta-parada-servicio,
 * parte 5a, decisiones D1 a D4).
 */
const EMPRESA = 'empresa-1';
const CONFIG: Configuracion = { capacidadKg: 10_000, capacidadM3: 40, carrocerias: ['plano'] };

function servicio(id: string, pesoKg: number | null, extra: Partial<ServicioDeRuta> = {}) {
  return {
    servicioId: id,
    empresaId: EMPRESA,
    tipoCarga: 'carga_seca',
    pesoKg,
    volumenM3: null,
    cancelado: false,
    ...extra,
  } satisfies ServicioDeRuta;
}
const recogida = (id: string, resuelta = false): Parada => ({
  servicioId: id,
  tipo: 'recogida',
  resuelta,
});
const entrega = (id: string, resuelta = false): Parada => ({
  servicioId: id,
  tipo: 'entrega',
  resuelta,
});
function ruta(parcial: Partial<Ruta> = {}): Ruta {
  return {
    empresaId: EMPRESA,
    estado: 'planificada',
    configuracion: CONFIG,
    tieneConductor: true,
    paradas: [],
    servicios: [],
    ...parcial,
  };
}
const sola = (id: string, pesoKg: number | null, parcial: Partial<Ruta> = {}) =>
  ruta({ paradas: [recogida(id), entrega(id)], servicios: [servicio(id, pesoKg)], ...parcial });
const motivos = (v: readonly { motivo: string }[]) => v.map((x) => x.motivo);

describe('rutaDeUnServicio', () => {
  it('arma la ruta planificada de dos paradas, con la configuración y el conductor dados', () => {
    const r = rutaDeUnServicio(servicio('a', 4_000), {
      configuracion: CONFIG,
      tieneConductor: true,
    });
    expect(r).toEqual({
      empresaId: EMPRESA,
      estado: 'planificada',
      configuracion: CONFIG,
      tieneConductor: true,
      paradas: [recogida('a'), entrega('a')],
      servicios: [servicio('a', 4_000)],
    });
    expect(validarRuta(r)).toEqual([]);
  });
});

describe('moverServicio (agrupar, spec §4.2)', () => {
  it('saca el servicio de su ruta, lo pone en la otra y cancela la que queda vacía', () => {
    const r = moverServicio(sola('b', 5_000), sola('a', 4_000), 'b', { recogida: 1, entrega: 2 });
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    expect(r.origen).toMatchObject({ estado: 'cancelada', paradas: [], servicios: [] });
    expect(r.destino.paradas).toEqual([recogida('a'), recogida('b'), entrega('b'), entrega('a')]);
    expect(r.destino.servicios.map((s) => s.servicioId)).toEqual(['a', 'b']);
    expect(serviciosEnMasDeUnaRuta([r.origen, r.destino])).toEqual([]);
  });

  it('si al origen le quedan servicios, sigue planificada', () => {
    const origen = ruta({
      paradas: [recogida('b'), recogida('c'), entrega('b'), entrega('c')],
      servicios: [servicio('b', 1_000), servicio('c', 1_000)],
    });
    const r = moverServicio(origen, sola('a', 4_000), 'b', { recogida: 2, entrega: 3 });
    expect(r).toMatchObject({ ok: true, origen: { estado: 'planificada' } });
    expect(r.ok && r.origen.paradas).toEqual([recogida('c'), entrega('c')]);
  });

  it('no cambia las rutas que recibe', () => {
    const origen = sola('b', 5_000);
    const destino = sola('a', 4_000);
    const copia = JSON.stringify([origen, destino]);
    moverServicio(origen, destino, 'b', { recogida: 0, entrega: 1 });
    expect(JSON.stringify([origen, destino])).toBe(copia);
  });

  it('rechaza en el origen: el servicio no está, o ya se recogió', () => {
    expect(moverServicio(sola('b', 1), sola('a', 1), 'x', { recogida: 0, entrega: 1 })).toEqual({
      ok: false,
      en: 'origen',
      violaciones: [{ motivo: 'servicio_no_esta_en_la_ruta', servicioId: 'x' }],
    });
    const recogido = ruta({
      estado: 'en_curso',
      paradas: [recogida('b', true), entrega('b')],
      servicios: [servicio('b', 1)],
    });
    expect(moverServicio(recogido, sola('a', 1), 'b', { recogida: 0, entrega: 1 })).toEqual({
      ok: false,
      en: 'origen',
      violaciones: [{ motivo: 'servicio_ya_recogido', servicioId: 'b' }],
    });
  });

  it('rechaza en el destino: no cabe por peso, con las cifras del tramo', () => {
    const r = moverServicio(sola('b', 7_000), sola('a', 4_000), 'b', { recogida: 1, entrega: 2 });
    expect(r).toEqual({
      ok: false,
      en: 'destino',
      violaciones: [
        { motivo: 'capacidad_peso_excedida', tramo: 1, masaKg: 11_000, capacidadKg: 10_000 },
      ],
    });
  });

  it('rechaza en el destino: con la ruta en curso, la recogida va después de lo resuelto', () => {
    const enCurso = ruta({
      estado: 'en_curso',
      paradas: [recogida('a', true), entrega('a')],
      servicios: [servicio('a', 1_000)],
    });
    const r = moverServicio(sola('b', 1_000), enCurso, 'b', { recogida: 0, entrega: 1 });
    expect(r).toMatchObject({ ok: false, en: 'destino' });
    expect(!r.ok && motivos(r.violaciones)).toEqual(['recogida_antes_de_parada_resuelta']);
    expect(moverServicio(sola('b', 1_000), enCurso, 'b', { recogida: 1, entrega: 2 }).ok).toBe(
      true,
    );
  });

  it('rechaza mover entre rutas de distinta empresa', () => {
    const otra = sola('a', 1, { empresaId: 'empresa-2' });
    expect(moverServicio(sola('b', 1), otra, 'b', { recogida: 0, entrega: 1 })).toEqual({
      ok: false,
      en: 'destino',
      violaciones: [{ motivo: 'rutas_de_distinta_empresa' }],
    });
  });

  it('rechaza si la carrocería del destino no le sirve a la carga (D3)', () => {
    const fria = ruta({
      paradas: [recogida('b'), entrega('b')],
      servicios: [servicio('b', 1_000, { tipoCarga: 'refrigerada' })],
      configuracion: { ...CONFIG, carrocerias: ['refrigerado'] },
    });
    const r = moverServicio(fria, sola('a', 1_000), 'b', { recogida: 0, entrega: 1 });
    expect(r).toEqual({
      ok: false,
      en: 'destino',
      violaciones: [{ motivo: 'carroceria_incompatible', servicioId: 'b' }],
    });
  });
});

describe('separarServicio (quitar, spec §4.5 y D4)', () => {
  it('el servicio vuelve a una ruta propia con el vehículo y el conductor de la que sale', () => {
    const junta = ruta({
      paradas: [recogida('a'), recogida('b'), entrega('a'), entrega('b')],
      servicios: [servicio('a', 4_000), servicio('b', 5_000)],
    });
    const r = separarServicio(junta, 'b');
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    expect(r.ruta.paradas).toEqual([recogida('a'), entrega('a')]);
    expect(r.ruta.estado).toBe('planificada');
    expect(r.propia).toEqual(
      rutaDeUnServicio(servicio('b', 5_000), { configuracion: CONFIG, tieneConductor: true }),
    );
  });

  it('con la ruta en curso, la propia nace planificada y la original sigue en curso', () => {
    const enCurso = ruta({
      estado: 'en_curso',
      paradas: [recogida('a', true), recogida('b'), entrega('a'), entrega('b')],
      servicios: [servicio('a', 4_000), servicio('b', 5_000)],
    });
    const r = separarServicio(enCurso, 'b');
    expect(r).toMatchObject({
      ok: true,
      ruta: { estado: 'en_curso' },
      propia: { estado: 'planificada' },
    });
  });

  it('no separa un servicio ya recogido ni el único de la ruta', () => {
    const enCurso = ruta({
      estado: 'en_curso',
      paradas: [recogida('a', true), recogida('b'), entrega('a'), entrega('b')],
      servicios: [servicio('a', 4_000), servicio('b', 5_000)],
    });
    const recogido = separarServicio(enCurso, 'a');
    expect(!recogido.ok && motivos(recogido.violaciones)).toEqual(['servicio_ya_recogido']);
    const unico = separarServicio(sola('a', 1), 'a');
    expect(!unico.ok && motivos(unico.violaciones)).toEqual(['servicio_unico_de_la_ruta']);
  });
});

describe('declararConductor y declararConfiguracion (D1)', () => {
  const enCurso = ruta({
    estado: 'en_curso',
    paradas: [recogida('a', true), entrega('a')],
    servicios: [servicio('a', 4_000)],
  });

  it('el conductor se puede relevar con la ruta en curso', () => {
    expect(declararConductor(enCurso, true)).toEqual({ ok: true, ruta: enCurso });
  });

  it('una ruta en curso no puede quedar sin conductor', () => {
    const r = declararConductor(enCurso, false);
    expect(!r.ok && motivos(r.violaciones)).toEqual(['en_curso_sin_conductor']);
  });

  it('planificada: se declara o se quita el conductor', () => {
    expect(declararConductor(sola('a', 1), false)).toMatchObject({
      ok: true,
      ruta: { tieneConductor: false },
    });
  });

  it('una ruta cerrada o cancelada no se toca', () => {
    const r = declararConductor(sola('a', 1, { estado: 'cerrada' }), true);
    expect(!r.ok && motivos(r.violaciones)).toEqual(['ruta_no_editable']);
  });

  it('el vehículo no se cambia con carga recogida: sería un transbordo', () => {
    const r = declararConfiguracion(enCurso, CONFIG);
    expect(r).toEqual({ ok: false, violaciones: [{ motivo: 'vehiculo_con_carga_recogida' }] });
  });

  it('el vehículo se rechaza si su carrocería no le sirve a algún servicio vigente (D3)', () => {
    const mixta = ruta({
      configuracion: null,
      paradas: [recogida('a'), entrega('a'), recogida('f'), entrega('f')],
      servicios: [servicio('a', 1_000), servicio('f', 1_000, { tipoCarga: 'refrigerada' })],
    });
    const r = declararConfiguracion(mixta, CONFIG);
    expect(r).toEqual({
      ok: false,
      violaciones: [{ motivo: 'carroceria_incompatible', servicioId: 'f' }],
    });
    expect(
      declararConfiguracion(mixta, { ...CONFIG, carrocerias: ['plano', 'refrigerado'] }).ok,
    ).toBe(true);
  });

  it('un servicio cancelado no cuenta para la carrocería', () => {
    const conCancelado = ruta({
      configuracion: null,
      paradas: [recogida('a'), entrega('a'), recogida('f'), entrega('f')],
      servicios: [
        servicio('a', 1_000),
        servicio('f', 1_000, { tipoCarga: 'refrigerada', cancelado: true }),
      ],
    });
    expect(declararConfiguracion(conCancelado, CONFIG).ok).toBe(true);
  });

  it('el vehículo se rechaza si no alcanza el peso de algún tramo', () => {
    const r = declararConfiguracion(sola('a', 4_000, { configuracion: null }), {
      ...CONFIG,
      capacidadKg: 3_000,
    });
    expect(r).toEqual({
      ok: false,
      violaciones: [
        { motivo: 'capacidad_peso_excedida', tramo: 0, masaKg: 4_000, capacidadKg: 3_000 },
      ],
    });
  });
});

describe('el volumen avisa, no rechaza (D2)', () => {
  const justa = ruta({
    configuracion: { ...CONFIG, capacidadM3: 30 },
    paradas: [recogida('a'), recogida('b'), entrega('a'), entrega('b')],
    servicios: [servicio('a', 1_000, { volumenM3: 20 }), servicio('b', 1_000, { volumenM3: 15 })],
  });

  it('una ruta que excede el volumen es válida y trae el aviso con sus cifras', () => {
    expect(validarRuta(justa)).toEqual([]);
    expect(avisosDeRuta(justa)).toEqual([
      { motivo: 'capacidad_volumen_excedida', tramo: 1, volumenM3: 35, capacidadM3: 30 },
    ]);
  });

  it('agregar un servicio que excede el volumen se acepta', () => {
    const r = agregarServicio(sola('a', 1_000), servicio('b', 1_000, { volumenM3: 999 }), {
      recogida: 1,
      entrega: 2,
    });
    expect(r.ok).toBe(true);
  });

  it('sin volumen declarado en el vehículo o en algún servicio a bordo, no hay aviso', () => {
    expect(avisosDeRuta({ ...justa, configuracion: { ...CONFIG, capacidadM3: null } })).toEqual([]);
    expect(avisosDeRuta({ ...justa, configuracion: null })).toEqual([]);
    expect(avisosDeRuta(sola('a', 1_000))).toEqual([]);
  });
});

describe('hallazgos de la revisión del 5a', () => {
  const excedida = ruta({
    paradas: [
      recogida('a'),
      entrega('a'),
      recogida('b'),
      entrega('b'),
      recogida('c'),
      entrega('c'),
    ],
    servicios: [servicio('a', 12_000), servicio('b', 1_000), servicio('c', 1_000)],
  });
  const conCancelado = ruta({
    paradas: [recogida('a'), entrega('a'), recogida('x'), entrega('x')],
    servicios: [servicio('a', 1_000), servicio('x', 1_000, { cancelado: true })],
  });

  it('el relevo de conductor no se rechaza por problemas ajenos al conductor (D1)', () => {
    const sobrepeso = ruta({
      estado: 'en_curso',
      paradas: [recogida('a', true), entrega('a')],
      servicios: [servicio('a', 12_000)],
    });
    expect(declararConductor(sobrepeso, true).ok).toBe(true);
    expect(declararConductor({ ...sobrepeso, configuracion: null }, true).ok).toBe(true);
    const sin = declararConductor(sobrepeso, false);
    expect(!sin.ok && motivos(sin.violaciones)).toEqual(['en_curso_sin_conductor']);
  });

  it('sacar un servicio no se rechaza por el sobrepeso de otro', () => {
    expect(quitarServicio(excedida, 'b').ok).toBe(true);
    expect(separarServicio(excedida, 'b').ok).toBe(true);
    const r = moverServicio(excedida, sola('z', 1_000), 'b', { recogida: 2, entrega: 3 });
    expect(r.ok).toBe(true);
  });

  it('la ruta propia de un servicio que no cabe en el vehículo heredado se rechaza', () => {
    const r = separarServicio(excedida, 'a');
    expect(r).toEqual({
      ok: false,
      violaciones: [
        { motivo: 'capacidad_peso_excedida', tramo: 0, masaKg: 12_000, capacidadKg: 10_000 },
      ],
    });
  });

  it('un servicio cancelado no se separa ni se mueve', () => {
    expect(separarServicio(conCancelado, 'x')).toEqual({
      ok: false,
      violaciones: [{ motivo: 'servicio_cancelado', servicioId: 'x' }],
    });
    expect(moverServicio(conCancelado, sola('z', 1), 'x', { recogida: 0, entrega: 1 })).toEqual({
      ok: false,
      en: 'origen',
      violaciones: [{ motivo: 'servicio_cancelado', servicioId: 'x' }],
    });
  });

  it('el único servicio vigente no se separa, aunque la ruta tenga un cancelado', () => {
    const r = separarServicio(conCancelado, 'a');
    expect(!r.ok && motivos(r.violaciones)).toEqual(['servicio_unico_de_la_ruta']);
  });

  it('separar responde primero lo que impide editar: ruta cerrada o servicio recogido', () => {
    const cerrada = separarServicio(sola('a', 1, { estado: 'cerrada' }), 'a');
    expect(!cerrada.ok && motivos(cerrada.violaciones)).toEqual(['ruta_no_editable']);
    const recogido = separarServicio(
      ruta({
        estado: 'en_curso',
        paradas: [recogida('a', true), entrega('a')],
        servicios: [servicio('a', 1)],
      }),
      'a',
    );
    expect(!recogido.ok && motivos(recogido.violaciones)).toEqual(['servicio_ya_recogido']);
  });

  it('un servicio de otra empresa no se separa con el vehículo de esta', () => {
    const mezclada = ruta({
      paradas: [recogida('a'), entrega('a'), recogida('x'), entrega('x')],
      servicios: [servicio('a', 1), servicio('x', 1, { empresaId: 'empresa-2' })],
    });
    const r = separarServicio(mezclada, 'x');
    expect(!r.ok && motivos(r.violaciones)).toEqual(['servicio_de_otra_empresa']);
  });

  it('al separar, la ruta original toma el estado que le corresponde', () => {
    const porCerrar = ruta({
      estado: 'en_curso',
      paradas: [recogida('a', true), entrega('a', true), recogida('b'), entrega('b')],
      servicios: [servicio('a', 1), servicio('b', 1), servicio('c', 1, { cancelado: true })],
    });
    // c no tiene paradas: se arma aparte para no romper el invariante de paradas.
    const valida = { ...porCerrar, servicios: porCerrar.servicios.slice(0, 2) };
    const r = moverServicio(valida, sola('z', 1), 'b', { recogida: 2, entrega: 3 });
    expect(r).toMatchObject({ ok: true, origen: { estado: 'cerrada' } });
    const dos = ruta({
      estado: 'en_curso',
      paradas: [
        recogida('a', true),
        entrega('a', true),
        recogida('b'),
        entrega('b'),
        recogida('d'),
        entrega('d'),
      ],
      servicios: [servicio('a', 1), servicio('b', 1), servicio('d', 1, { cancelado: true })],
    });
    expect(separarServicio(dos, 'b')).toMatchObject({ ok: true, ruta: { estado: 'cerrada' } });
  });

  it('validarRuta no mira la carrocería: una carga ya asignada no bloquea su ruta', () => {
    const vieja = ruta({
      paradas: [recogida('f'), entrega('f'), recogida('a'), entrega('a')],
      servicios: [servicio('f', 1_000, { tipoCarga: 'refrigerada' }), servicio('a', 1_000)],
    });
    expect(validarRuta(vieja)).toEqual([]);
    expect(reordenarParadas(vieja, [2, 3, 0, 1]).ok).toBe(true);
    expect(quitarServicio(vieja, 'a').ok).toBe(true);
  });

  it('declarar un vehículo lista todos los servicios a los que no les sirve', () => {
    const fria = ruta({
      configuracion: null,
      paradas: [recogida('f'), entrega('f'), recogida('g'), entrega('g')],
      servicios: [
        servicio('f', 1, { tipoCarga: 'refrigerada' }),
        servicio('g', 1, { tipoCarga: 'congelada' }),
      ],
    });
    const r = declararConfiguracion(fria, CONFIG);
    expect(!r.ok && r.violaciones).toEqual([
      { motivo: 'carroceria_incompatible', servicioId: 'f' },
      { motivo: 'carroceria_incompatible', servicioId: 'g' },
    ]);
  });

  it('el volumen igual a la capacidad no avisa', () => {
    const justa = ruta({
      configuracion: { ...CONFIG, capacidadM3: 30 },
      paradas: [recogida('a'), recogida('b'), entrega('a'), entrega('b')],
      servicios: [servicio('a', 1_000, { volumenM3: 20 }), servicio('b', 1_000, { volumenM3: 10 })],
    });
    expect(avisosDeRuta(justa)).toEqual([]);
  });
});
