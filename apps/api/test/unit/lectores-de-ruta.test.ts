import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * ruta-parada-servicio parte 4b (ADR-088): el vehículo, el arrastre y el
 * conductor de un servicio se leen de su ruta. Las columnas de `asignaciones`
 * siguen existiendo hasta la migración `contract` (parte 8), pero nadie las
 * lee fuera de los archivos que mantienen la ruta igual a la asignación.
 */
const SRC = fileURLToPath(new URL('../../src', import.meta.url));

/** Quienes escriben la ruta a partir de la asignación, y la expresión misma. */
const PERMITIDOS = new Set([
  'db/schema.ts',
  'db/configuracion-de-asignacion.ts',
  'services/crear-ruta-de-asignacion.ts',
  'services/sincronizar-ruta-de-asignacion.ts',
  'services/rellenar-rutas.ts',
]);

const LECTURA = /\bassignments\.(vehicleId|driverUserId|unidadArrastreId)\b/;

function archivos(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const ruta = join(dir, e.name);
    if (e.isDirectory()) {
      return archivos(ruta);
    }
    return e.name.endsWith('.ts') && !e.name.endsWith('.test.ts') ? [ruta] : [];
  });
}

describe('lectores de vehículo, arrastre y conductor', () => {
  it('ningún archivo los lee directo de la asignación', () => {
    const hallazgos = archivos(SRC).flatMap((archivo) => {
      const rel = relative(SRC, archivo);
      if (PERMITIDOS.has(rel)) {
        return [];
      }
      return readFileSync(archivo, 'utf8')
        .split('\n')
        .flatMap((linea, i) => (LECTURA.test(linea) ? [`${rel}:${i + 1}`] : []));
    });
    expect(hallazgos).toEqual([]);
  });
});
