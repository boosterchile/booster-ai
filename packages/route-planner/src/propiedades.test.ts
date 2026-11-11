import { describe, expect, it } from 'vitest';
import {
  MOTIVOS_RECHAZO,
  type Resultado,
  type Ruta,
  type ServicioDeRuta,
  agregarServicio,
  calcularTramos,
  declararConfiguracion,
  quitarServicio,
  reordenarParadas,
  validarRuta,
} from './index.js';

/**
 * Tests de propiedad sobre rutas generadas (spec ruta-parada-servicio §10-1).
 * El generador es determinista: mismo número de caso, misma secuencia.
 */
function generador(semilla: number) {
  let estado = semilla >>> 0;
  const siguiente = () => {
    estado = (estado + 0x6d2b79f5) >>> 0;
    let t = estado;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    entero: (min: number, max: number) => min + Math.floor(siguiente() * (max - min + 1)),
    probabilidad: (p: number) => siguiente() < p,
  };
}

type Generador = ReturnType<typeof generador>;

const EMPRESA = 'empresa-1';
const CASOS = 300;
const OPERACIONES_POR_CASO = 25;

function servicioAleatorio(g: Generador, id: string): ServicioDeRuta {
  return {
    servicioId: id,
    empresaId: g.probabilidad(0.05) ? 'empresa-2' : EMPRESA,
    pesoKg: g.probabilidad(0.1) ? null : g.entero(100, 6_000),
    volumenM3: g.probabilidad(0.5) ? g.entero(1, 30) : null,
    cancelado: false,
  };
}

function rutaInicial(g: Generador): Ruta {
  return {
    empresaId: EMPRESA,
    estado: 'planificada',
    configuracion: g.probabilidad(0.2)
      ? null
      : {
          capacidadKg: g.entero(3_000, 12_000),
          capacidadM3: g.probabilidad(0.5) ? g.entero(10, 60) : null,
        },
    tieneConductor: g.probabilidad(0.8),
    paradas: [],
    servicios: [],
  };
}

function permutacion(g: Generador, n: number): number[] {
  const orden = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i -= 1) {
    const j = g.entero(0, i);
    const a = orden[i] ?? 0;
    orden[i] = orden[j] ?? 0;
    orden[j] = a;
  }
  return orden;
}

function operacionAleatoria(g: Generador, ruta: Ruta, numero: number): Resultado {
  const dado = g.entero(0, 9);
  if (dado <= 4) {
    const largo = ruta.paradas.length;
    const recogida = g.entero(-1, largo + 1);
    return agregarServicio(ruta, servicioAleatorio(g, `s${numero}`), {
      recogida,
      entrega: g.entero(recogida, largo + 2),
    });
  }
  if (dado <= 6) {
    const candidatos = ruta.servicios.map((s) => s.servicioId);
    const id = candidatos[g.entero(0, Math.max(0, candidatos.length - 1))] ?? 'inexistente';
    return quitarServicio(ruta, g.probabilidad(0.1) ? 'inexistente' : id);
  }
  if (dado <= 8) {
    return reordenarParadas(ruta, permutacion(g, ruta.paradas.length));
  }
  return declararConfiguracion(ruta, {
    configuracion: { capacidadKg: g.entero(2_000, 15_000), capacidadM3: null },
    tieneConductor: true,
  });
}

/** Confirma la primera parada pendiente, como haría el conductor. */
function avanzar(ruta: Ruta): Ruta {
  const indice = ruta.paradas.findIndex((p) => !p.resuelta);
  if (indice === -1 || ruta.configuracion === null || !ruta.tieneConductor) {
    return ruta;
  }
  return {
    ...ruta,
    estado: 'en_curso',
    paradas: ruta.paradas.map((p, i) => (i === indice ? { ...p, resuelta: true } : p)),
  };
}

describe('propiedades de las operaciones', () => {
  it('toda operación aceptada deja una ruta válida y toda rechazada explica por qué', () => {
    let aceptadas = 0;
    let rechazadas = 0;
    for (let caso = 1; caso <= CASOS; caso += 1) {
      const g = generador(caso);
      let ruta = rutaInicial(g);
      for (let n = 0; n < OPERACIONES_POR_CASO; n += 1) {
        const antes = JSON.stringify(ruta);
        const resultado = operacionAleatoria(g, ruta, n);
        expect(JSON.stringify(ruta), `caso ${caso}, operación ${n}: mutó la entrada`).toBe(antes);
        if (resultado.ok) {
          aceptadas += 1;
          expect(validarRuta(resultado.ruta), `caso ${caso}, operación ${n}`).toEqual([]);
          ruta = resultado.ruta;
        } else {
          rechazadas += 1;
          expect(resultado.violaciones.length, `caso ${caso}, operación ${n}`).toBeGreaterThan(0);
          for (const v of resultado.violaciones) {
            expect(MOTIVOS_RECHAZO).toContain(v.motivo);
          }
        }
        if (g.probabilidad(0.15)) {
          ruta = avanzar(ruta);
          expect(validarRuta(ruta), `caso ${caso}, tras avanzar en ${n}`).toEqual([]);
        }
      }
    }
    // El generador ejercita las dos ramas; si no, la propiedad no prueba nada.
    expect(aceptadas).toBeGreaterThan(1_000);
    expect(rechazadas).toBeGreaterThan(1_000);
  });

  it('las paradas resueltas nunca cambian de posición', () => {
    for (let caso = 1; caso <= CASOS; caso += 1) {
      const g = generador(caso + 10_000);
      let ruta = rutaInicial(g);
      for (let n = 0; n < OPERACIONES_POR_CASO; n += 1) {
        const resueltas = ruta.paradas.map((p, i) => ({ p, i })).filter(({ p }) => p.resuelta);
        const resultado = operacionAleatoria(g, ruta, n);
        if (resultado.ok) {
          for (const { p, i } of resueltas) {
            expect(resultado.ruta.paradas[i], `caso ${caso}, operación ${n}`).toEqual(p);
          }
          ruta = resultado.ruta;
        }
        if (g.probabilidad(0.2)) {
          ruta = avanzar(ruta);
        }
      }
    }
  });
});

describe('propiedades de los tramos', () => {
  it('cada servicio está a bordo exactamente entre su recogida y su entrega', () => {
    for (let caso = 1; caso <= CASOS; caso += 1) {
      const g = generador(caso + 20_000);
      let ruta = rutaInicial(g);
      for (let n = 0; n < OPERACIONES_POR_CASO; n += 1) {
        const resultado = operacionAleatoria(g, ruta, n);
        if (resultado.ok) {
          ruta = resultado.ruta;
        }
      }
      const tramos = calcularTramos(ruta);
      expect(tramos.length).toBe(Math.max(0, ruta.paradas.length - 1));
      for (const s of ruta.servicios) {
        const desde = ruta.paradas.findIndex(
          (p) => p.servicioId === s.servicioId && p.tipo === 'recogida',
        );
        const hasta = ruta.paradas.findIndex(
          (p) => p.servicioId === s.servicioId && p.tipo === 'entrega',
        );
        tramos.forEach((tramo, i) => {
          expect(tramo.serviciosABordo.includes(s.servicioId), `caso ${caso}, tramo ${i}`).toBe(
            i >= desde && i < hasta,
          );
        });
      }
      for (const tramo of tramos) {
        const esperado = ruta.servicios
          .filter((s) => tramo.serviciosABordo.includes(s.servicioId))
          .reduce((suma, s) => suma + (s.pesoKg ?? 0), 0);
        expect(tramo.masaKg).toBe(esperado);
        expect(tramo.vacio).toBe(tramo.serviciosABordo.length === 0);
      }
    }
  });
});
