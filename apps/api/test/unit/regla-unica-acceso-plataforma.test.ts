import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `.specs/acceso-panel-plataforma` SC1: una sola regla de acceso al panel.
 *
 * La decide `tieneAccesoPlataforma` (`src/auth/acceso-plataforma.ts`), y la
 * aplican `requirePlatformAdmin` y `GET /me`. Este recorrido falla si una ruta
 * vuelve a declarar su propio guard o a comparar la lista de respaldo en línea.
 */

const RAIZ_API = join(import.meta.dirname, '..', '..');
const SRC = join(RAIZ_API, 'src');
const PERMITIDOS = new Set(['src/auth/acceso-plataforma.ts']);

function archivosTs(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) {
      return archivosTs(ruta);
    }
    return nombre.endsWith('.ts') && !nombre.endsWith('.test.ts') ? [ruta] : [];
  });
}

const fuentes = archivosTs(SRC).map((ruta) => ({
  ruta: relative(RAIZ_API, ruta),
  texto: readFileSync(ruta, 'utf8'),
}));

describe('regla única de acceso al panel (SC1)', () => {
  it('solo el middleware declara requirePlatformAdmin', () => {
    const declarantes = fuentes
      .filter((f) => /function\s+requirePlatformAdmin\s*\(/.test(f.texto))
      .map((f) => f.ruta);
    expect(declarantes).toEqual(['src/middleware/require-platform-admin.ts']);
  });

  it('ninguna ruta compara la lista de respaldo en línea', () => {
    const patron =
      /(BOOSTER_PLATFORM_ADMIN_EMAILS|allowlist|adminAllowlist|listaPersonal)\s*\.\s*(includes|has)\s*\(/;
    const conCopia = fuentes
      .filter((f) => !PERMITIDOS.has(f.ruta) && patron.test(f.texto))
      .map((f) => f.ruta);
    expect(conCopia).toEqual([]);
  });

  it('el recorrido ve el guard y la regla', () => {
    const rutas = fuentes.map((f) => f.ruta);
    expect(rutas).toContain('src/middleware/require-platform-admin.ts');
    expect(rutas).toContain('src/auth/acceso-plataforma.ts');
  });
});
