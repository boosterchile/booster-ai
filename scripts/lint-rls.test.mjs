import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { TENANT_FREE_TABLES, main, parseSchemaTables, scanContent } from './lint-rls.mjs';

// Usa node:test (no vitest) porque scripts/ raíz no está en el vitest workspace
// (apps/*, packages/*), mismo criterio que scripts/repo-checks/check-migration-safety.test.mjs.
//
// Cubre la lógica nueva del spec lint-rls-services-jobs con ROJO exhibido:
//   - fix-1: `.from(ident)` solo es query si `ident` es tabla real del schema
//     (Buffer.from / Array.from dejan de ser falsos positivos).
//   - fix-2: raw SQL `db.execute(sql`…`)` / `pool.query(`…`)` — tabla por su
//     nombre SQL snake_case; exige token de filtro tenant o allowlist.
//   - T3: TENANT_FREE_TABLES += 4.

// Mapa mínimo identJS -> nombreSQL (subconjunto real del schema) para scanContent.
const tables = new Map([
  ['vehicles', 'vehiculos'],
  ['trips', 'viajes'],
  ['tripMetrics', 'metricas_viaje'],
  ['empresas', 'empresas'],
  ['plans', 'planes'],
  ['memberships', 'membresias'],
]);
// tenant-free por identJS (empresas/plans/memberships/tripMetrics no se auto-filtran).
const tenantFree = new Set(['empresas', 'plans', 'memberships', 'tripMetrics']);
const opts = { tables, tenantFree };

describe('parseSchemaTables', () => {
  it('parsea pgTable single-line y multi-line -> Map identJS a nombreSQL', () => {
    const src = [
      "import { pgTable, uuid } from 'drizzle-orm/pg-core';",
      "export const plans = pgTable('planes', { id: uuid('id') });",
      'export const empresas = pgTable(',
      "  'empresas',",
      '  { id: uuid("id") },',
      ');',
      "const notATable = pgEnum('estado', ['a']);",
    ].join('\n');
    const map = parseSchemaTables(src);
    assert.equal(map.get('plans'), 'planes');
    assert.equal(map.get('empresas'), 'empresas');
    assert.equal(map.size, 2);
    assert.ok(!map.has('notATable'));
  });
});

describe('scanContent — Drizzle (fix-1: gate por set de tablas del schema)', () => {
  it('flaggea una query de services sin filtro empresaId', () => {
    const content = 'const rows = await db.select().from(vehicles).where(eq(vehicles.id, id));';
    const findings = scanContent(content, opts);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].table, 'vehicles');
    assert.equal(findings[0].kind, 'drizzle');
  });

  it('NO flaggea Buffer.from / Array.from (no son tablas del schema)', () => {
    const content = [
      "const key = Buffer.from(saltHex, 'hex');",
      'const arr = Array.from(items);',
      'const d = Date.from(x);',
    ].join('\n');
    assert.equal(scanContent(content, opts).length, 0);
  });

  it('NO flaggea si el token empresaId está en la ventana', () => {
    const content =
      'await db.select().from(vehicles).where(eq(vehicles.empresaId, ctx.activeMembership.empresa.id));';
    assert.equal(scanContent(content, opts).length, 0);
  });

  it('NO flaggea una tabla tenant-free (empresas)', () => {
    const content = 'await db.select().from(empresas).where(eq(empresas.id, id));';
    assert.equal(scanContent(content, opts).length, 0);
  });

  it('respeta // rls-allowlist en la ventana -10/+30', () => {
    const content = [
      '// rls-allowlist: scoped por tripId ya validado en la ruta llamadora',
      'await db.update(vehicles).set({ retirado: true });',
    ].join('\n');
    assert.equal(scanContent(content, opts).length, 0);
  });
});

describe('scanContent — raw SQL (fix-2: db.execute(sql`…`) / pool.query)', () => {
  it('flaggea raw db.execute(sql`… FROM vehiculos …`) sin filtro tenant', () => {
    const content = 'await db.execute(sql`SELECT * FROM vehiculos WHERE id = ${id}`);';
    const findings = scanContent(content, opts);
    assert.ok(findings.some((f) => f.kind === 'raw' && f.table === 'vehiculos'));
  });

  it('NO flaggea raw SQL con filtro empresa_id', () => {
    const content = 'await db.execute(sql`SELECT * FROM vehiculos WHERE empresa_id = ${e}`);';
    assert.equal(scanContent(content, opts).length, 0);
  });

  it('NO flaggea raw SQL con allowlist comment', () => {
    const content = [
      '// rls-allowlist: job de sistema, BYPASSRLS por diseño (rls-viabilidad §2D)',
      'await pool.query(`DELETE FROM vehiculos WHERE creado_en < now()`);',
    ].join('\n');
    assert.equal(scanContent(content, opts).length, 0);
  });

  it('NO flaggea raw SQL que solo toca tablas tenant-free', () => {
    const content = 'await db.execute(sql`SELECT * FROM planes ORDER BY nombre`);';
    assert.equal(scanContent(content, opts).length, 0);
  });

  it('flaggea pool.query(`… viajes …`) sin filtro', () => {
    const content = "await pool.query(`UPDATE viajes SET estado = 'x' WHERE id = ${id}`);";
    const findings = scanContent(content, opts);
    assert.ok(findings.some((f) => f.kind === 'raw' && f.table === 'viajes'));
  });
});

describe('TENANT_FREE_TABLES (T3: +4 con razón)', () => {
  for (const t of ['solicitudesRegistro', 'matchingBacktestRuns', 'empresas', 'membershipTiers']) {
    it(`incluye ${t}`, () => {
      assert.ok(TENANT_FREE_TABLES.has(t));
    });
  }
});

describe('main — integración sobre fixtures en disco (cubre walk/collectFindings/main)', () => {
  let dir;
  const noop = () => undefined;
  const schemaSource = [
    "export const vehicles = pgTable('vehiculos', {});",
    "export const empresas = pgTable('empresas', {});",
  ].join('\n');

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lint-rls-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('falla (exit 1) ante una query Drizzle sin filtro en un fixture services/', () => {
    const svc = join(dir, 'services');
    mkdirSync(svc);
    writeFileSync(
      join(svc, 'bad.ts'),
      'export const f = () => db.select().from(vehicles).where(eq(vehicles.id, id));',
    );
    const messages = [];
    const code = main({ scanDirs: [svc], schemaSource, log: noop, err: (m) => messages.push(m) });
    assert.equal(code, 1);
    assert.ok(messages.some((m) => m.includes('vehiculos') || m.includes('bad.ts')));
  });

  it('pasa (exit 0) con filtro empresaId, allowlist y tenant-free; salta .test.ts y recorre subdirs', () => {
    const svc = join(dir, 'services');
    const sub = join(svc, 'sub');
    mkdirSync(sub, { recursive: true });
    writeFileSync(
      join(svc, 'ok-filtro.ts'),
      'export const f = () => db.select().from(vehicles).where(eq(vehicles.empresaId, e));',
    );
    writeFileSync(
      join(sub, 'ok-allowlist.ts'),
      ['// rls-allowlist: scoped por id validado', 'db.update(vehicles).set({});'].join('\n'),
    );
    writeFileSync(join(svc, 'ok-tenantfree.ts'), 'db.select().from(empresas);');
    // .test.ts se ignora aunque tenga una query sucia:
    writeFileSync(join(svc, 'dirty.test.ts'), 'db.select().from(vehicles);');
    const code = main({ scanDirs: [svc], schemaSource, log: noop, err: noop });
    assert.equal(code, 0);
  });
});
