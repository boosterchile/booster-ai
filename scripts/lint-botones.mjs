#!/usr/bin/env node
/**
 * Regla de lint del frente 8 del rediseño (`.specs/frente8-lint-botones`):
 * ningún archivo de `apps/web/src` pinta un botón a mano. Los botones salen de
 * `@booster-ai/ui-components` (`Button`; `PressableArea` para filas y
 * tarjetas que se presionan).
 *
 * Falla cuando un archivo `.tsx` de `apps/web/src` (los tests no cuentan):
 *   1. escribe un `<button>` nativo;
 *   2. pone `role="button"` a otro elemento;
 *   3. pinta un `PressableArea` como botón: relleno de color de acción con
 *      texto blanco en su `className`.
 *
 * Lee el árbol sintáctico de TypeScript, no el texto, para no confundir un
 * `<button>` dentro de un comentario o de un string. Corre en `pnpm lint`.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

export const SRC_DIR = 'apps/web/src';

/** Relleno de acción: un color de marca, de estado o de alerta, en tono 400 o más. */
const RELLENO_DE_ACCION =
  /(^|\s)(hover:)?bg-(primary|accent|danger|success|warning|amber|red|green|emerald|orange|blue)-[4-9]00(\s|$)/;
const TEXTO_BLANCO = /(^|\s)text-white(\s|$)/;

/** Texto estático de un atributo JSX: string literal o template sin expresiones. */
function textoDeAtributo(attr) {
  const init = attr.initializer;
  if (!init) {
    return '';
  }
  if (ts.isStringLiteral(init)) {
    return init.text;
  }
  if (ts.isJsxExpression(init) && init.expression) {
    // Template literal o string: se toman sus partes estáticas.
    return init.expression
      .getText()
      .replace(/\$\{[^}]*\}/g, ' ')
      .replace(/[`'"]/g, ' ');
  }
  return '';
}

function atributo(node, nombre) {
  return node.attributes.properties.find(
    (p) => ts.isJsxAttribute(p) && p.name.getText() === nombre,
  );
}

/**
 * Hallazgos de un archivo. `contenido` es el texto TSX; `archivo` solo se usa
 * para el mensaje.
 */
export function scanContent(contenido, archivo = 'archivo.tsx') {
  const sf = ts.createSourceFile(
    archivo,
    contenido,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const hallazgos = [];
  const linea = (n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;

  function visitar(node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(sf);
      if (tag === 'button') {
        hallazgos.push({
          archivo,
          linea: linea(node),
          motivo: '<button> nativo: usa Button (o PressableArea) de @booster-ai/ui-components',
        });
      } else {
        const role = atributo(node, 'role');
        if (role && textoDeAtributo(role).trim() === 'button') {
          hallazgos.push({
            archivo,
            linea: linea(node),
            motivo: `role="button" en <${tag}>: usa Button (o PressableArea) de @booster-ai/ui-components`,
          });
        }
      }
      if (tag === 'PressableArea') {
        const cls = atributo(node, 'className');
        const texto = cls ? textoDeAtributo(cls) : '';
        if (RELLENO_DE_ACCION.test(texto) && TEXTO_BLANCO.test(texto)) {
          hallazgos.push({
            archivo,
            linea: linea(node),
            motivo:
              'PressableArea pintado como botón (relleno de acción y texto blanco): usa Button',
          });
        }
      }
    }
    ts.forEachChild(node, visitar);
  }

  visitar(sf);
  return hallazgos;
}

function archivosTsx(dir) {
  const out = [];
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) {
      out.push(...archivosTsx(ruta));
    } else if (nombre.endsWith('.tsx') && !/\.test\.tsx$/.test(nombre)) {
      out.push(ruta);
    }
  }
  return out;
}

/** Recorre `raiz/apps/web/src` y devuelve todos los hallazgos. */
export function scanTree(raiz = process.cwd()) {
  const base = resolve(raiz, SRC_DIR);
  return archivosTsx(base).flatMap((ruta) =>
    scanContent(readFileSync(ruta, 'utf8'), relative(raiz, ruta)),
  );
}

export function main(raiz = process.cwd(), salida = process.stdout, errores = process.stderr) {
  const hallazgos = scanTree(raiz);
  if (hallazgos.length === 0) {
    salida.write('lint-botones: ningún botón pintado a mano en apps/web/src.\n');
    return 0;
  }
  for (const h of hallazgos) {
    errores.write(`${h.archivo}:${h.linea}  ${h.motivo}\n`);
  }
  errores.write(
    `\nlint-botones: ${hallazgos.length} botón(es) pintado(s) a mano en apps/web/src (frente 8).\n`,
  );
  return 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
