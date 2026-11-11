import { describe, expect, it } from 'vitest';
import {
  type Parada,
  type Ruta,
  type ServicioDeRuta,
  TRANSICIONES_RUTA,
  agregarServicio,
  calcularTramos,
  declararConfiguracion,
  estadoQueCorresponde,
  puedeTransicionarRuta,
  quitarServicio,
  reordenarParadas,
  serviciosEnMasDeUnaRuta,
  validarRuta,
} from './index.js';

const EMPRESA = 'empresa-1';

function servicio(id: string, pesoKg: number | null, extra: Partial<ServicioDeRuta> = {}) {
  return {
    servicioId: id,
    empresaId: EMPRESA,
    pesoKg,
    volumenM3: null,
    cancelado: false,
    ...extra,
  } satisfies ServicioDeRuta;
}

function recogida(id: string, resuelta = false): Parada {
  return { servicioId: id, tipo: 'recogida', resuelta };
}

function entrega(id: string, resuelta = false): Parada {
  return { servicioId: id, tipo: 'entrega', resuelta };
}

function ruta(parcial: Partial<Ruta> = {}): Ruta {
  return {
    empresaId: EMPRESA,
    estado: 'planificada',
    configuracion: { capacidadKg: 10_000, capacidadM3: null },
    tieneConductor: true,
    paradas: [],
    servicios: [],
    ...parcial,
  };
}

/** Recoge A y B, entrega A y después B. */
function rutaDeDos(parcial: Partial<Ruta> = {}): Ruta {
  return ruta({
    paradas: [recogida('a'), recogida('b'), entrega('a'), entrega('b')],
    servicios: [servicio('a', 4_000), servicio('b', 5_000)],
    ...parcial,
  });
}

function motivos(violaciones: readonly { motivo: string }[]): string[] {
  return violaciones.map((v) => v.motivo);
}

describe('calcularTramos', () => {
  it('una ruta de dos paradas tiene un tramo con la masa del servicio', () => {
    const tramos = calcularTramos(
      ruta({ paradas: [recogida('a'), entrega('a')], servicios: [servicio('a', 3_000)] }),
    );
    expect(tramos).toEqual([
      { desde: 0, hasta: 1, masaKg: 3_000, volumenM3: null, serviciosABordo: ['a'], vacio: false },
    ]);
  });

  it('suma la masa de los servicios a bordo en cada tramo', () => {
    const tramos = calcularTramos(rutaDeDos());
    expect(tramos.map((t) => t.masaKg)).toEqual([4_000, 9_000, 5_000]);
    expect(tramos.map((t) => t.serviciosABordo)).toEqual([['a'], ['a', 'b'], ['b']]);
  });

  it('marca vacío el tramo entre una entrega y la recogida siguiente', () => {
    const tramos = calcularTramos(
      ruta({
        paradas: [recogida('a'), entrega('a'), recogida('b'), entrega('b')],
        servicios: [servicio('a', 1_000), servicio('b', 2_000)],
      }),
    );
    expect(tramos.map((t) => t.vacio)).toEqual([false, true, false]);
    expect(tramos[1]?.masaKg).toBe(0);
  });

  it('el volumen es null si un servicio a bordo no lo declara, y 0 en un tramo vacío', () => {
    const tramos = calcularTramos(
      ruta({
        paradas: [recogida('a'), recogida('b'), entrega('b'), entrega('a'), recogida('c')],
        servicios: [
          servicio('a', 1_000, { volumenM3: 10 }),
          servicio('b', 1_000),
          servicio('c', 1_000, { volumenM3: 4 }),
        ],
      }),
    );
    expect(tramos.map((t) => t.volumenM3)).toEqual([10, null, 10, 0]);
  });

  it('un servicio cancelado antes de su recogida no cuenta a bordo', () => {
    const tramos = calcularTramos(
      rutaDeDos({ servicios: [servicio('a', 4_000), servicio('b', 5_000, { cancelado: true })] }),
    );
    expect(tramos.map((t) => t.masaKg)).toEqual([4_000, 4_000, 0]);
  });

  it('un servicio cancelado después de recogido sigue a bordo hasta su entrega', () => {
    const tramos = calcularTramos(
      rutaDeDos({
        estado: 'en_curso',
        paradas: [recogida('a', true), recogida('b', true), entrega('a'), entrega('b')],
        servicios: [servicio('a', 4_000), servicio('b', 5_000, { cancelado: true })],
      }),
    );
    expect(tramos.map((t) => t.masaKg)).toEqual([4_000, 9_000, 5_000]);
  });

  it('una ruta sin paradas o con una sola no tiene tramos', () => {
    expect(calcularTramos(ruta())).toEqual([]);
  });
});

describe('validarRuta', () => {
  it('acepta una ruta de dos servicios dentro de la capacidad', () => {
    expect(validarRuta(rutaDeDos())).toEqual([]);
  });

  it('acepta una ruta sin servicios', () => {
    expect(validarRuta(ruta())).toEqual([]);
  });

  it('rechaza la entrega antes de la recogida', () => {
    const v = validarRuta(
      ruta({ paradas: [entrega('a'), recogida('a')], servicios: [servicio('a', 1_000)] }),
    );
    expect(v).toContainEqual({ motivo: 'entrega_antes_de_recogida', servicioId: 'a' });
  });

  it('rechaza un servicio sin su parada de entrega', () => {
    const v = validarRuta(ruta({ paradas: [recogida('a')], servicios: [servicio('a', 1_000)] }));
    expect(v).toContainEqual({ motivo: 'paradas_del_servicio_invalidas', servicioId: 'a' });
  });

  it('rechaza una parada de un servicio que no está en la ruta', () => {
    const v = validarRuta(ruta({ paradas: [recogida('x'), entrega('x')], servicios: [] }));
    expect(v).toContainEqual({ motivo: 'paradas_del_servicio_invalidas', servicioId: 'x' });
  });

  it('rechaza dos recogidas del mismo servicio', () => {
    const v = validarRuta(
      ruta({
        paradas: [recogida('a'), recogida('a'), entrega('a')],
        servicios: [servicio('a', 1_000)],
      }),
    );
    expect(motivos(v)).toContain('paradas_del_servicio_invalidas');
  });

  it('rechaza el tramo donde la masa supera la capacidad, con su índice', () => {
    const v = validarRuta(rutaDeDos({ configuracion: { capacidadKg: 8_000, capacidadM3: null } }));
    expect(v).toEqual([{ motivo: 'capacidad_peso_excedida', tramo: 1 }]);
  });

  it('acepta la masa igual a la capacidad', () => {
    expect(
      validarRuta(rutaDeDos({ configuracion: { capacidadKg: 9_000, capacidadM3: null } })),
    ).toEqual([]);
  });

  it('no evalúa capacidad mientras no hay vehículo declarado', () => {
    expect(validarRuta(rutaDeDos({ configuracion: null }))).toEqual([]);
  });

  it('rechaza el volumen excedido cuando vehículo y servicios lo declaran', () => {
    const v = validarRuta(
      ruta({
        configuracion: { capacidadKg: 10_000, capacidadM3: 20 },
        paradas: [recogida('a'), recogida('b'), entrega('a'), entrega('b')],
        servicios: [
          servicio('a', 1_000, { volumenM3: 15 }),
          servicio('b', 1_000, { volumenM3: 10 }),
        ],
      }),
    );
    expect(v).toEqual([{ motivo: 'capacidad_volumen_excedida', tramo: 1 }]);
  });

  it('no evalúa volumen si un servicio a bordo no lo declara', () => {
    const v = validarRuta(
      ruta({
        configuracion: { capacidadKg: 10_000, capacidadM3: 20 },
        paradas: [recogida('a'), recogida('b'), entrega('a'), entrega('b')],
        servicios: [servicio('a', 1_000, { volumenM3: 30 }), servicio('b', 1_000)],
      }),
    );
    expect(motivos(v)).toEqual(['capacidad_volumen_excedida']);
    expect(v[0]?.tramo).toBe(0);
  });

  it('una ruta en curso exige vehículo y conductor', () => {
    const v = validarRuta(
      rutaDeDos({ estado: 'en_curso', configuracion: null, tieneConductor: false }),
    );
    expect(motivos(v)).toEqual(['en_curso_sin_vehiculo', 'en_curso_sin_conductor']);
  });

  it('una ruta planificada no exige vehículo ni conductor', () => {
    expect(validarRuta(rutaDeDos({ configuracion: null, tieneConductor: false }))).toEqual([]);
  });

  it('rechaza un servicio asignado a otra empresa', () => {
    const v = validarRuta(
      rutaDeDos({
        servicios: [servicio('a', 4_000), servicio('b', 5_000, { empresaId: 'empresa-2' })],
      }),
    );
    expect(v).toContainEqual({ motivo: 'servicio_de_otra_empresa', servicioId: 'b' });
  });

  it('rechaza un servicio sin peso en una ruta con otros servicios', () => {
    const v = validarRuta(rutaDeDos({ servicios: [servicio('a', 4_000), servicio('b', null)] }));
    expect(v).toContainEqual({
      motivo: 'servicio_sin_peso_en_ruta_consolidada',
      servicioId: 'b',
    });
  });

  it('acepta un servicio sin peso que viaja solo', () => {
    expect(
      validarRuta(
        ruta({ paradas: [recogida('a'), entrega('a')], servicios: [servicio('a', null)] }),
      ),
    ).toEqual([]);
  });

  it('un servicio cancelado no cuenta para la regla del peso', () => {
    expect(
      validarRuta(
        rutaDeDos({
          servicios: [servicio('a', null), servicio('b', 5_000, { cancelado: true })],
        }),
      ),
    ).toEqual([]);
  });
});

describe('serviciosEnMasDeUnaRuta', () => {
  it('devuelve los servicios repetidos entre rutas no canceladas', () => {
    const una = ruta({ paradas: [recogida('a'), entrega('a')], servicios: [servicio('a', 1)] });
    const otra = rutaDeDos();
    expect(serviciosEnMasDeUnaRuta([una, otra])).toEqual(['a']);
  });

  it('ignora las rutas canceladas', () => {
    const una = ruta({
      estado: 'cancelada',
      paradas: [recogida('a'), entrega('a')],
      servicios: [servicio('a', 1)],
    });
    expect(serviciosEnMasDeUnaRuta([una, rutaDeDos()])).toEqual([]);
  });
});

describe('estados de la ruta', () => {
  it('la tabla de transiciones es la de la spec', () => {
    expect(TRANSICIONES_RUTA).toEqual({
      planificada: ['en_curso', 'cancelada'],
      en_curso: ['cerrada'],
      cerrada: [],
      cancelada: [],
    });
    expect(puedeTransicionarRuta('planificada', 'en_curso')).toBe(true);
    expect(puedeTransicionarRuta('en_curso', 'cancelada')).toBe(false);
    expect(puedeTransicionarRuta('cerrada', 'en_curso')).toBe(false);
  });

  it('planificada sin recogidas confirmadas sigue planificada', () => {
    expect(estadoQueCorresponde(rutaDeDos())).toBe('planificada');
  });

  it('pasa a en curso con la primera recogida confirmada', () => {
    expect(
      estadoQueCorresponde(
        rutaDeDos({ paradas: [recogida('a', true), recogida('b'), entrega('a'), entrega('b')] }),
      ),
    ).toBe('en_curso');
  });

  it('planificada sin servicios pasa a cancelada', () => {
    expect(estadoQueCorresponde(ruta())).toBe('cancelada');
  });

  it('planificada con todos sus servicios cancelados pasa a cancelada', () => {
    expect(
      estadoQueCorresponde(
        rutaDeDos({
          servicios: [servicio('a', 1, { cancelado: true }), servicio('b', 1, { cancelado: true })],
        }),
      ),
    ).toBe('cancelada');
  });

  it('en curso con paradas pendientes sigue en curso', () => {
    expect(
      estadoQueCorresponde(
        rutaDeDos({
          estado: 'en_curso',
          paradas: [recogida('a', true), recogida('b', true), entrega('a', true), entrega('b')],
        }),
      ),
    ).toBe('en_curso');
  });

  it('se cierra cuando todas las paradas están resueltas', () => {
    expect(
      estadoQueCorresponde(
        rutaDeDos({
          estado: 'en_curso',
          paradas: [
            recogida('a', true),
            recogida('b', true),
            entrega('a', true),
            entrega('b', true),
          ],
        }),
      ),
    ).toBe('cerrada');
  });

  it('se cierra cuando lo pendiente es de un servicio cancelado', () => {
    expect(
      estadoQueCorresponde(
        rutaDeDos({
          estado: 'en_curso',
          paradas: [recogida('a', true), recogida('b'), entrega('a', true), entrega('b')],
          servicios: [servicio('a', 1), servicio('b', 1, { cancelado: true })],
        }),
      ),
    ).toBe('cerrada');
  });

  it('cerrada y cancelada no cambian', () => {
    expect(estadoQueCorresponde(rutaDeDos({ estado: 'cerrada' }))).toBe('cerrada');
    expect(estadoQueCorresponde(ruta({ estado: 'cancelada' }))).toBe('cancelada');
  });
});

describe('agregarServicio', () => {
  const unServicio = ruta({
    paradas: [recogida('a'), entrega('a')],
    servicios: [servicio('a', 4_000)],
  });

  it('inserta la recogida y la entrega en las posiciones pedidas', () => {
    const r = agregarServicio(unServicio, servicio('b', 5_000), { recogida: 1, entrega: 3 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.ruta.paradas).toEqual([recogida('a'), recogida('b'), entrega('a'), entrega('b')]);
      expect(r.ruta.servicios.map((s) => s.servicioId)).toEqual(['a', 'b']);
    }
  });

  it('no modifica la ruta recibida', () => {
    const antes = JSON.stringify(unServicio);
    agregarServicio(unServicio, servicio('b', 5_000), { recogida: 1, entrega: 3 });
    expect(JSON.stringify(unServicio)).toBe(antes);
  });

  it('rechaza si rompe la capacidad en algún tramo', () => {
    const r = agregarServicio(unServicio, servicio('b', 7_000), { recogida: 1, entrega: 3 });
    expect(r).toEqual({
      ok: false,
      violaciones: [{ motivo: 'capacidad_peso_excedida', tramo: 1 }],
    });
  });

  it('acepta el mismo servicio si no coincide a bordo con el otro', () => {
    const r = agregarServicio(unServicio, servicio('b', 7_000), { recogida: 2, entrega: 3 });
    expect(r.ok).toBe(true);
  });

  it('rechaza un servicio que ya está en la ruta', () => {
    const r = agregarServicio(unServicio, servicio('a', 1), { recogida: 0, entrega: 1 });
    expect(r).toEqual({
      ok: false,
      violaciones: [{ motivo: 'servicio_ya_en_la_ruta', servicioId: 'a' }],
    });
  });

  it('rechaza la entrega en la misma posición o antes que la recogida', () => {
    const r = agregarServicio(unServicio, servicio('b', 1), { recogida: 2, entrega: 2 });
    expect(r).toEqual({
      ok: false,
      violaciones: [{ motivo: 'entrega_antes_de_recogida', servicioId: 'b' }],
    });
  });

  it('rechaza posiciones fuera de la ruta', () => {
    for (const posicion of [
      { recogida: -1, entrega: 1 },
      { recogida: 3, entrega: 4 },
      { recogida: 1, entrega: 5 },
      { recogida: 0.5, entrega: 2 },
    ]) {
      const r = agregarServicio(unServicio, servicio('b', 1), posicion);
      expect(r).toEqual({ ok: false, violaciones: [{ motivo: 'posicion_invalida' }] });
    }
  });

  it('rechaza un servicio de otra empresa', () => {
    const r = agregarServicio(unServicio, servicio('b', 1, { empresaId: 'empresa-2' }), {
      recogida: 2,
      entrega: 3,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(motivos(r.violaciones)).toContain('servicio_de_otra_empresa');
    }
  });

  it('rechaza un servicio sin peso junto a otro', () => {
    const r = agregarServicio(unServicio, servicio('b', null), { recogida: 2, entrega: 3 });
    expect(r.ok).toBe(false);
  });

  it('en curso acepta una recogida después de la última parada resuelta', () => {
    const enCurso = ruta({
      estado: 'en_curso',
      paradas: [recogida('a', true), entrega('a')],
      servicios: [servicio('a', 4_000)],
    });
    expect(agregarServicio(enCurso, servicio('b', 5_000), { recogida: 1, entrega: 3 }).ok).toBe(
      true,
    );
  });

  it('en curso rechaza una recogida antes de una parada resuelta', () => {
    const enCurso = ruta({
      estado: 'en_curso',
      paradas: [recogida('a', true), entrega('a')],
      servicios: [servicio('a', 4_000)],
    });
    const r = agregarServicio(enCurso, servicio('b', 5_000), { recogida: 0, entrega: 3 });
    expect(r).toEqual({
      ok: false,
      violaciones: [{ motivo: 'recogida_antes_de_parada_resuelta', servicioId: 'b' }],
    });
  });

  it('una ruta cerrada o cancelada no se edita', () => {
    for (const estado of ['cerrada', 'cancelada'] as const) {
      const r = agregarServicio(ruta({ estado }), servicio('b', 1), { recogida: 0, entrega: 1 });
      expect(r).toEqual({ ok: false, violaciones: [{ motivo: 'ruta_no_editable' }] });
    }
  });
});

describe('quitarServicio', () => {
  it('quita el servicio y sus dos paradas', () => {
    const r = quitarServicio(rutaDeDos(), 'a');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.ruta.paradas).toEqual([recogida('b'), entrega('b')]);
      expect(r.ruta.servicios.map((s) => s.servicioId)).toEqual(['b']);
    }
  });

  it('quitar el último servicio deja una ruta vacía que corresponde cancelar', () => {
    const r = quitarServicio(
      ruta({ paradas: [recogida('a'), entrega('a')], servicios: [servicio('a', 1)] }),
      'a',
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.ruta.paradas).toEqual([]);
      expect(estadoQueCorresponde(r.ruta)).toBe('cancelada');
    }
  });

  it('rechaza un servicio que no está en la ruta', () => {
    expect(quitarServicio(rutaDeDos(), 'x')).toEqual({
      ok: false,
      violaciones: [{ motivo: 'servicio_no_esta_en_la_ruta', servicioId: 'x' }],
    });
  });

  it('rechaza quitar un servicio ya recogido', () => {
    const enCurso = rutaDeDos({
      estado: 'en_curso',
      paradas: [recogida('a', true), recogida('b'), entrega('a'), entrega('b')],
    });
    expect(quitarServicio(enCurso, 'a')).toEqual({
      ok: false,
      violaciones: [{ motivo: 'servicio_ya_recogido', servicioId: 'a' }],
    });
    expect(quitarServicio(enCurso, 'b').ok).toBe(true);
  });

  it('una ruta cerrada no se edita', () => {
    expect(quitarServicio(rutaDeDos({ estado: 'cerrada' }), 'a')).toEqual({
      ok: false,
      violaciones: [{ motivo: 'ruta_no_editable' }],
    });
  });
});

describe('reordenarParadas', () => {
  it('aplica el orden nuevo', () => {
    const r = reordenarParadas(rutaDeDos(), [1, 0, 3, 2]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.ruta.paradas).toEqual([recogida('b'), recogida('a'), entrega('b'), entrega('a')]);
    }
  });

  it('rechaza un orden que deja una entrega antes de su recogida', () => {
    const r = reordenarParadas(rutaDeDos(), [2, 1, 0, 3]);
    expect(r).toEqual({
      ok: false,
      violaciones: [{ motivo: 'entrega_antes_de_recogida', servicioId: 'a' }],
    });
  });

  it('rechaza un orden que no es una permutación de las paradas', () => {
    for (const orden of [
      [0, 1, 2],
      [0, 1, 2, 2],
      [0, 1, 2, 4],
      [0, 1, 2, 3, 4],
    ]) {
      expect(reordenarParadas(rutaDeDos(), orden)).toEqual({
        ok: false,
        violaciones: [{ motivo: 'orden_invalido' }],
      });
    }
  });

  it('rechaza mover una parada resuelta', () => {
    const enCurso = rutaDeDos({
      estado: 'en_curso',
      paradas: [recogida('a', true), recogida('b'), entrega('a'), entrega('b')],
    });
    expect(reordenarParadas(enCurso, [1, 0, 2, 3])).toEqual({
      ok: false,
      violaciones: [{ motivo: 'parada_resuelta_movida' }],
    });
    expect(reordenarParadas(enCurso, [0, 2, 1, 3]).ok).toBe(true);
  });

  it('rechaza un orden que rompe la capacidad', () => {
    const r = reordenarParadas(
      ruta({
        configuracion: { capacidadKg: 6_000, capacidadM3: null },
        paradas: [recogida('a'), entrega('a'), recogida('b'), entrega('b')],
        servicios: [servicio('a', 4_000), servicio('b', 5_000)],
      }),
      [0, 2, 1, 3],
    );
    expect(r).toEqual({
      ok: false,
      violaciones: [{ motivo: 'capacidad_peso_excedida', tramo: 1 }],
    });
  });

  it('una ruta cancelada no se edita', () => {
    expect(reordenarParadas(ruta({ estado: 'cancelada' }), [])).toEqual({
      ok: false,
      violaciones: [{ motivo: 'ruta_no_editable' }],
    });
  });
});

describe('declararConfiguracion', () => {
  it('declara vehículo y conductor en una ruta planificada', () => {
    const r = declararConfiguracion(rutaDeDos({ configuracion: null, tieneConductor: false }), {
      configuracion: { capacidadKg: 9_000, capacidadM3: null },
      tieneConductor: true,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.ruta.configuracion).toEqual({ capacidadKg: 9_000, capacidadM3: null });
      expect(r.ruta.tieneConductor).toBe(true);
    }
  });

  it('rechaza una configuración que no alcanza para algún tramo', () => {
    const r = declararConfiguracion(rutaDeDos({ configuracion: null }), {
      configuracion: { capacidadKg: 8_999, capacidadM3: null },
      tieneConductor: true,
    });
    expect(r).toEqual({
      ok: false,
      violaciones: [{ motivo: 'capacidad_peso_excedida', tramo: 1 }],
    });
  });

  it('no se cambia después de una recogida', () => {
    const enCurso = rutaDeDos({
      estado: 'en_curso',
      paradas: [recogida('a', true), recogida('b'), entrega('a'), entrega('b')],
    });
    const r = declararConfiguracion(enCurso, {
      configuracion: { capacidadKg: 20_000, capacidadM3: null },
      tieneConductor: true,
    });
    expect(r).toEqual({ ok: false, violaciones: [{ motivo: 'servicio_ya_recogido' }] });
  });

  it('una ruta cerrada no se edita', () => {
    const r = declararConfiguracion(rutaDeDos({ estado: 'cerrada' }), {
      configuracion: { capacidadKg: 20_000, capacidadM3: null },
      tieneConductor: true,
    });
    expect(r).toEqual({ ok: false, violaciones: [{ motivo: 'ruta_no_editable' }] });
  });
});
