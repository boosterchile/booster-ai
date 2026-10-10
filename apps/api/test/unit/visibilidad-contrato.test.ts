import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CLAVES_PRIVADAS_GENERADOR } from '@booster-ai/shared-schemas';
import { describe, expect, it } from 'vitest';

/**
 * ADR-079 §5 / Verificación 3 — test de contrato de visibilidad: las rutas
 * que sirven a transportista y conductor, y el bot de WhatsApp, no
 * referencian claves privadas del generador; y el server monta la guardia
 * runtime en esas rutas. Un cambio que exponga una clave rompe CI.
 */
const RAIZ = join(__dirname, '..', '..');
const RUTAS_TRANSPORTISTA = [
  'src/routes/offers.ts',
  'src/routes/assignments.ts',
  'src/routes/chat.ts',
  'src/routes/conductores.ts',
];

function archivosBot(): string[] {
  const dir = join(RAIZ, '..', 'whatsapp-bot', 'src');
  const out: string[] = [];
  const recorrer = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) {
        recorrer(p);
      } else if (e.name.endsWith('.ts') && !e.name.endsWith('.test.ts')) {
        out.push(p);
      }
    }
  };
  recorrer(dir);
  return out;
}

describe('contrato de visibilidad ADR-079 §5', () => {
  it.each(RUTAS_TRANSPORTISTA)('%s no referencia claves privadas del generador', (archivo) => {
    const src = readFileSync(join(RAIZ, archivo), 'utf-8');
    for (const clave of CLAVES_PRIVADAS_GENERADOR) {
      expect(src, `${archivo} contiene ${clave}`).not.toContain(clave);
    }
  });

  it('el bot de WhatsApp no referencia claves privadas del generador', () => {
    const archivos = archivosBot();
    expect(archivos.length).toBeGreaterThan(0);
    for (const archivo of archivos) {
      const src = readFileSync(archivo, 'utf-8');
      for (const clave of CLAVES_PRIVADAS_GENERADOR) {
        expect(src, `${archivo} contiene ${clave}`).not.toContain(clave);
      }
    }
  });

  it('server.ts monta la guardia runtime en /offers/* y /assignments/*', () => {
    const server = readFileSync(join(RAIZ, 'src/server.ts'), 'utf-8');
    expect(server).toMatch(/app\.use\('\/offers\/\*', guardiaVisibilidadTransportista\)/);
    expect(server).toMatch(/app\.use\('\/assignments\/\*', guardiaVisibilidadTransportista\)/);
  });
});
