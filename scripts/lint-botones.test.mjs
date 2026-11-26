import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { main, scanContent, scanTree } from './lint-botones.mjs';

// node:test (no vitest): scripts/ raíz no está en el workspace de vitest,
// mismo criterio que lint-rls.test.mjs.

describe('lint-botones: falla con un botón pintado a mano', () => {
  it('un <button> nativo', () => {
    const h = scanContent(
      `export const X = () => (
  <div>
    <button type="button" className="rounded bg-primary-600 px-3 py-2 text-white">Guardar</button>
  </div>
);`,
    );
    assert.equal(h.length, 1);
    assert.equal(h[0].linea, 3);
    assert.match(h[0].motivo, /<button> nativo/);
  });

  it('un <button> sin clases también cuenta', () => {
    assert.equal(scanContent('const X = () => <button onClick={f} />;').length, 1);
  });

  it('role="button" en otro elemento', () => {
    const h = scanContent('const X = () => <div role="button" onClick={f}>x</div>;');
    assert.equal(h.length, 1);
    assert.match(h[0].motivo, /role="button" en <div>/);
  });

  it('un PressableArea pintado como botón (relleno de acción y texto blanco)', () => {
    const h = scanContent(
      'const X = () => <PressableArea className="rounded bg-primary-600 px-4 text-white">x</PressableArea>;',
    );
    assert.equal(h.length, 1);
    assert.match(h[0].motivo, /PressableArea pintado como botón/);
  });

  it('también en un template literal con interpolaciones', () => {
    const h = scanContent(
      'const X = () => <PressableArea className={`flex ${a} bg-amber-600 text-white`}>x</PressableArea>;',
    );
    assert.equal(h.length, 1);
  });
});

describe('lint-botones: no falla con los componentes compartidos', () => {
  it('Button y PressableArea de layout', () => {
    const h = scanContent(`import { Button, PressableArea } from '@booster-ai/ui-components';
export const X = () => (
  <>
    <Button variant="primary">Guardar</Button>
    <PressableArea className="flex w-full items-center gap-3 rounded-lg border p-4 hover:bg-neutral-50">fila</PressableArea>
  </>
);`);
    assert.deepEqual(h, []);
  });

  it('un <button> dentro de un comentario o un string no cuenta', () => {
    const h = scanContent(`// antes había un <button> aquí
const texto = '<button>';
export const X = () => <p>{texto}</p>;`);
    assert.deepEqual(h, []);
  });

  it('role="tab" u otro rol no cuenta', () => {
    assert.deepEqual(scanContent('const X = () => <Button role="tab">x</Button>;'), []);
  });
});

describe('lint-botones: recorrido del árbol', () => {
  it('lee apps/web/src, ignora los tests y devuelve 1 con hallazgos', () => {
    const raiz = mkdtempSync(join(tmpdir(), 'lint-botones-'));
    try {
      mkdirSync(join(raiz, 'apps/web/src/components'), { recursive: true });
      writeFileSync(join(raiz, 'apps/web/src/components/a.tsx'), 'const A = () => <button />;');
      writeFileSync(join(raiz, 'apps/web/src/components/a.test.tsx'), 'render(<button />);');
      writeFileSync(join(raiz, 'apps/web/src/components/b.tsx'), 'const B = () => <Button />;');
      const hallazgos = scanTree(raiz);
      assert.equal(hallazgos.length, 1);
      assert.equal(hallazgos[0].archivo, 'apps/web/src/components/a.tsx');

      const salida = {
        texto: '',
        write(t) {
          this.texto += t;
        },
      };
      const errores = {
        texto: '',
        write(t) {
          this.texto += t;
        },
      };
      assert.equal(main(raiz, salida, errores), 1);
      assert.match(errores.texto, /apps\/web\/src\/components\/a\.tsx:1/);
    } finally {
      rmSync(raiz, { recursive: true, force: true });
    }
  });

  it('devuelve 0 sin hallazgos', () => {
    const raiz = mkdtempSync(join(tmpdir(), 'lint-botones-'));
    try {
      mkdirSync(join(raiz, 'apps/web/src'), { recursive: true });
      writeFileSync(join(raiz, 'apps/web/src/b.tsx'), 'const B = () => <Button />;');
      const salida = {
        texto: '',
        write(t) {
          this.texto += t;
        },
      };
      assert.equal(main(raiz, salida, salida), 0);
      assert.match(salida.texto, /ningún botón pintado a mano/);
    } finally {
      rmSync(raiz, { recursive: true, force: true });
    }
  });
});
