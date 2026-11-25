import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Guardián del formateador único (`.specs/una-sola-verdad-por-dato`, criterio
 * 2). Recorre `apps/web/src` y falla si un archivo distinto de
 * `lib/formato-emisiones.ts` escribe una cifra de emisiones por su cuenta.
 */

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const FORMATEADOR = 'lib/formato-emisiones.ts';

/**
 * Archivos que leen un campo de emisiones sin mostrarlo: lo pasan, lo suman
 * o lo validan, y la cifra la escribe otro archivo con el formateador.
 */
const SOLO_TRANSPORTAN: Record<string, string> = {
  'components/inicio/use-inicio-data.ts':
    'convierte `kg_co2e` del API en número; lo muestra `inicio/generador.ts`',
};

const CAMPO_EMISIONES = /\.\s*[A-Za-z0-9_]*(?:co2e|kgco2|carbon_emissions)[A-Za-z0-9_]*/i;
const FORMATO_NUMERICO = /\.toFixed\(|\.toLocaleString\(|Intl\.NumberFormat/;
const TEXTO_CO2 = /CO₂|CO2(?!E\b)/;

function archivos(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entrada) => {
    const ruta = join(dir, entrada.name);
    if (entrada.isDirectory()) {
      return archivos(ruta);
    }
    return /\.tsx?$/.test(entrada.name) && !/\.test\.tsx?$/.test(entrada.name) ? [ruta] : [];
  });
}

/** Quita comentarios de bloque y de línea; conserva `https://`. */
function sinComentarios(fuente: string): string {
  return fuente.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

interface Hallazgo {
  archivo: string;
  linea: number;
  motivo: string;
  texto: string;
}

function revisar(): Hallazgo[] {
  const hallazgos: Hallazgo[] = [];
  for (const ruta of archivos(RAIZ)) {
    const archivo = relative(RAIZ, ruta).split('\\').join('/');
    if (archivo === FORMATEADOR) {
      continue;
    }
    const codigo = sinComentarios(readFileSync(ruta, 'utf8'));
    const importaFormateador = /from '[./]+(?:\/lib)?\/formato-emisiones\.js'/.test(codigo);
    const lineas = codigo.split('\n');
    lineas.forEach((texto, indice) => {
      const anotar = (motivo: string) =>
        hallazgos.push({ archivo, linea: indice + 1, motivo, texto: texto.trim() });
      if (TEXTO_CO2.test(texto)) {
        anotar('escribe «CO₂» a mano; usa CO2E o formatoEmisiones');
      }
      if (!CAMPO_EMISIONES.test(texto)) {
        return;
      }
      if (FORMATO_NUMERICO.test(texto)) {
        anotar('da formato numérico a un campo de emisiones');
      }
      if (!importaFormateador && !(archivo in SOLO_TRANSPORTAN)) {
        anotar('lee un campo de emisiones y no importa formato-emisiones');
      }
    });
  }
  return hallazgos;
}

describe('cifras de emisiones en apps/web', () => {
  it('todas pasan por lib/formato-emisiones.ts', () => {
    const hallazgos = revisar().map((h) => `${h.archivo}:${h.linea} — ${h.motivo} — ${h.texto}`);
    expect(hallazgos).toEqual([]);
  });

  it('las excepciones declaradas siguen existiendo y siguen sin formatear', () => {
    for (const archivo of Object.keys(SOLO_TRANSPORTAN)) {
      const codigo = sinComentarios(readFileSync(join(RAIZ, archivo), 'utf8'));
      expect(CAMPO_EMISIONES.test(codigo), `${archivo} ya no lee emisiones`).toBe(true);
      expect(FORMATO_NUMERICO.test(codigo), `${archivo} da formato numérico`).toBe(false);
    }
  });
});
