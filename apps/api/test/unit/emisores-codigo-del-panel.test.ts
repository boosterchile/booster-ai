import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * `.specs/alta-personal-booster` §6.6: `activacion_vence_en` no nulo significa
 * que el código actual lo emitió el panel. Todo UPDATE que reescribe
 * `activationPinHash` con `hashActivationPin(...)` fija `activacionVenceEn` en
 * el mismo objeto del `.set()`: el panel con su vencimiento, el resto en NULL.
 *
 * `.specs/acceso-panel-plataforma` SC9: los emisores del panel son el del
 * personal (`admin-personal-booster.ts`) y la re-emisión del panel de empresas
 * (`admin-empresa-miembros.ts`), ambos solo de platform-admin. Fuera de esos
 * dos archivos, el vencimiento va siempre en `null` literal.
 *
 * Los tests de cada emisor afirman los sitios que existen hoy; este recorre el
 * código para que un UPDATE nuevo tampoco lo omita. Solo quedan fuera los
 * objetos que van directo a un INSERT (`.values()`): la columna nace NULL. Un
 * objeto armado aparte y esparcido en un `.set()` cuenta como UPDATE.
 */

const RAIZ_API = join(import.meta.dirname, '..', '..');
const CARPETAS = ['src', 'scripts'];
const EMISORES_DEL_PANEL = new Set([
  'src/routes/admin-personal-booster.ts',
  'src/routes/admin-empresa-miembros.ts',
]);

function archivosTs(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) {
      return nombre === 'node_modules' ? [] : archivosTs(ruta);
    }
    return nombre.endsWith('.ts') && !nombre.endsWith('.test.ts') ? [ruta] : [];
  });
}

/** Método de la llamada encadenada más cercana que recibe el objeto (`set`, `values`, …). */
function metodoQueRecibe(nodo: ts.Node): string | null {
  let actual: ts.Node | undefined = nodo.parent;
  while (actual) {
    if (ts.isCallExpression(actual) && ts.isPropertyAccessExpression(actual.expression)) {
      return actual.expression.name.text;
    }
    actual = actual.parent;
  }
  return null;
}

function tienePropiedad(objeto: ts.ObjectLiteralExpression, nombre: string): boolean {
  return objeto.properties.some(
    (p) =>
      (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) &&
      ts.isIdentifier(p.name) &&
      p.name.text === nombre,
  );
}

/** El objeto asigna `nombre: null` literal. */
function asignaNull(objeto: ts.ObjectLiteralExpression, nombre: string): boolean {
  return objeto.properties.some(
    (p) =>
      ts.isPropertyAssignment(p) &&
      ts.isIdentifier(p.name) &&
      p.name.text === nombre &&
      p.initializer.kind === ts.SyntaxKind.NullKeyword,
  );
}

interface Emisor {
  archivo: string;
  ubicacion: string;
  metodo: string | null;
  fijaVencimiento: boolean;
  vencimientoNulo: boolean;
}

function emisores(): Emisor[] {
  const encontrados: Emisor[] = [];
  for (const carpeta of CARPETAS) {
    for (const archivo of archivosTs(join(RAIZ_API, carpeta))) {
      const fuente = ts.createSourceFile(
        archivo,
        readFileSync(archivo, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
      );
      const visitar = (nodo: ts.Node): void => {
        if (
          ts.isPropertyAssignment(nodo) &&
          ts.isIdentifier(nodo.name) &&
          nodo.name.text === 'activationPinHash' &&
          ts.isCallExpression(nodo.initializer) &&
          ts.isIdentifier(nodo.initializer.expression) &&
          nodo.initializer.expression.text === 'hashActivationPin' &&
          ts.isObjectLiteralExpression(nodo.parent)
        ) {
          const { line } = fuente.getLineAndCharacterOfPosition(nodo.getStart(fuente));
          encontrados.push({
            archivo: relative(RAIZ_API, archivo),
            ubicacion: `${relative(RAIZ_API, archivo)}:${line + 1}`,
            metodo: metodoQueRecibe(nodo.parent),
            fijaVencimiento: tienePropiedad(nodo.parent, 'activacionVenceEn'),
            vencimientoNulo: asignaNull(nodo.parent, 'activacionVenceEn'),
          });
        }
        ts.forEachChild(nodo, visitar);
      };
      visitar(fuente);
    }
  }
  return encontrados;
}

describe('emisores del código de activación (spec §6.6)', () => {
  const todos = emisores();

  it('cada objeto que reescribe el código fuera de un INSERT fija activacionVenceEn', () => {
    const sinVencimiento = todos
      .filter((e) => e.metodo !== 'values' && !e.fijaVencimiento)
      .map((e) => e.ubicacion);
    expect(sinVencimiento).toEqual([]);
  });

  it('fuera de los emisores del panel, el UPDATE deja el vencimiento en null (SC9)', () => {
    const conVencimiento = todos
      .filter((e) => e.metodo !== 'values' && !EMISORES_DEL_PANEL.has(e.archivo))
      .filter((e) => !e.vencimientoNulo)
      .map((e) => e.ubicacion);
    expect(conVencimiento).toEqual([]);
  });

  it('la re-emisión del panel de empresas cuenta como código del panel (SC9)', () => {
    const reemision = todos.filter(
      (e) => e.archivo === 'src/routes/admin-empresa-miembros.ts' && e.metodo === 'set',
    );
    expect(reemision.length).toBeGreaterThan(0);
    expect(reemision.every((e) => e.fijaVencimiento && !e.vencimientoNulo)).toBe(true);
  });

  it('el recorrido encuentra los emisores de UPDATE y de INSERT', () => {
    // Hoy: la re-emisión del panel de empresas, cuatro en conductores y dos en
    // el panel del personal. Si baja, el recorrido dejó de verlos.
    expect(todos.filter((e) => e.metodo === 'set').length).toBeGreaterThanOrEqual(7);
    expect(todos.some((e) => e.metodo === 'values')).toBe(true);
  });
});
