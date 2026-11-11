/** Generador determinista (mulberry32): mismo número de caso, misma secuencia. */
export function generador(semilla: number) {
  let estado = semilla >>> 0;
  const siguiente = () => {
    estado = (estado + 0x6d2b79f5) >>> 0;
    let t = estado;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    real: (min: number, max: number) => min + siguiente() * (max - min),
    entero: (min: number, max: number) => min + Math.floor(siguiente() * (max - min + 1)),
    probabilidad: (p: number) => siguiente() < p,
  };
}

export type Generador = ReturnType<typeof generador>;

export function barajar<T>(g: Generador, lista: readonly T[]): T[] {
  const copia = [...lista];
  for (let i = copia.length - 1; i > 0; i -= 1) {
    const j = g.entero(0, i);
    const a = copia[i] as T;
    copia[i] = copia[j] as T;
    copia[j] = a;
  }
  return copia;
}
