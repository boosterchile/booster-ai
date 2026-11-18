import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const template = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../nginx.conf.template'),
  'utf8',
);

function bloqueExacto(uri: string): string {
  const marker = `location = ${uri} {`;
  const start = template.indexOf(marker);
  expect(start, marker).toBeGreaterThanOrEqual(0);
  const end = template.indexOf('\n    }', start);
  expect(end).toBeGreaterThan(start);
  return template.slice(start, end);
}

describe('nginx — caché de la PWA', () => {
  it('sirve registerSW.js y sw.js con no-cache, fuera del immutable de *.js', () => {
    for (const uri of ['/registerSW.js', '/sw.js']) {
      const bloque = bloqueExacto(uri);
      expect(bloque).toContain('no-cache');
      expect(bloque).not.toContain('immutable');
      expect(bloque).not.toContain('31536000');
    }
    expect(template).toContain('location ~* \\.(js|css|woff2|svg|png|jpg|jpeg|gif|ico)$');
    expect(template).toContain('add_header Cache-Control "public, immutable"');
  });
});
