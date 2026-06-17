import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { findDestructiveStatements, hasContractMarker, main } from './check-migration-safety.mjs';

// P1-H (audit 2026-06-14) — guard bloqueante: una migración Drizzle NUEVA con
// DDL destructivo (DROP/RENAME/SET NOT NULL/TYPE/DROP CONSTRAINT/TRUNCATE) sin
// el marcador `-- contract-phase: <ref>` rompe el contrato expand/contract
// (ADR-066) → exit 1. Con marcador, o solo aditiva, pasa. Usa node:test porque
// los scripts/ no están en el vitest workspace (apps/*, packages/*).

describe('findDestructiveStatements', () => {
  it('detecta DROP TABLE', () => {
    assert.ok(findDestructiveStatements('DROP TABLE usuarios;').includes('DROP TABLE'));
  });

  it('detecta DROP COLUMN (ALTER TABLE)', () => {
    const sql = 'ALTER TABLE "viajes" DROP COLUMN "precio";';
    assert.ok(findDestructiveStatements(sql).includes('DROP COLUMN'));
  });

  it('detecta RENAME TO y RENAME COLUMN', () => {
    assert.ok(findDestructiveStatements('ALTER TABLE a RENAME TO b;').includes('RENAME'));
    assert.ok(findDestructiveStatements('ALTER TABLE a RENAME COLUMN x TO y;').includes('RENAME'));
  });

  it('detecta SET NOT NULL', () => {
    const sql = 'ALTER TABLE "u" ALTER COLUMN "rut" SET NOT NULL;';
    assert.ok(findDestructiveStatements(sql).includes('SET NOT NULL'));
  });

  it('detecta cambio de tipo (TYPE / SET DATA TYPE)', () => {
    assert.ok(
      findDestructiveStatements('ALTER TABLE u ALTER COLUMN x TYPE integer;').includes(
        'ALTER COLUMN TYPE',
      ),
    );
    assert.ok(
      findDestructiveStatements('ALTER TABLE u ALTER COLUMN x SET DATA TYPE text;').includes(
        'ALTER COLUMN TYPE',
      ),
    );
  });

  it('detecta DROP CONSTRAINT y TRUNCATE', () => {
    assert.ok(
      findDestructiveStatements('ALTER TABLE u DROP CONSTRAINT fk;').includes('DROP CONSTRAINT'),
    );
    assert.ok(findDestructiveStatements('TRUNCATE TABLE logs;').includes('TRUNCATE'));
  });

  it('es case-insensitive', () => {
    assert.ok(findDestructiveStatements('drop table x;').includes('DROP TABLE'));
  });

  it('NO marca migración puramente aditiva', () => {
    const sql = `CREATE TABLE "nueva" ("id" uuid PRIMARY KEY);
      ALTER TABLE "viajes" ADD COLUMN "nota" text;
      CREATE INDEX "idx_x" ON "viajes" ("empresa_id");`;
    assert.deepEqual(findDestructiveStatements(sql), []);
  });

  it('ignora la palabra "drop" dentro de comentarios (no FP)', () => {
    const sql = `-- esta migración NO hace DROP TABLE, solo agrega
      ALTER TABLE "v" ADD COLUMN "x" text;`;
    assert.deepEqual(findDestructiveStatements(sql), []);
  });

  it('detecta el statement real aunque haya un comentario en la misma línea', () => {
    const sql = 'ALTER TABLE v DROP COLUMN y; -- limpieza';
    assert.ok(findDestructiveStatements(sql).includes('DROP COLUMN'));
  });
});

describe('hasContractMarker', () => {
  it('reconoce el marcador con una ref', () => {
    assert.equal(hasContractMarker('-- contract-phase: ADR-066\nDROP TABLE x;'), true);
  });

  it('tolera espacios y mayúsculas variables', () => {
    assert.equal(hasContractMarker('--   Contract-Phase:   ISSUE-123\n'), true);
  });

  it('NO acepta el marcador sin ref', () => {
    assert.equal(hasContractMarker('-- contract-phase:\nDROP TABLE x;'), false);
  });

  it('NO confunde una mención cualquiera', () => {
    assert.equal(hasContractMarker('-- esto es una contract-phase futura quizá\n'), false);
  });
});

describe('main (CLI)', () => {
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'migsafe-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function write(name, content) {
    const p = join(dir, name);
    writeFileSync(p, content);
    return p;
  }

  it('exit 0 sin archivos', () => {
    assert.equal(main([]), 0);
  });

  it('exit 0 para migración aditiva', () => {
    const f = write('0100_add.sql', 'ALTER TABLE v ADD COLUMN x text;');
    assert.equal(main([f]), 0);
  });

  it('exit 1 para DROP COLUMN sin marcador', () => {
    const f = write('0101_drop.sql', 'ALTER TABLE v DROP COLUMN x;');
    assert.equal(main([f]), 1);
  });

  it('exit 0 para DROP COLUMN CON marcador contract-phase', () => {
    const f = write(
      '0102_contract.sql',
      '-- contract-phase: ADR-066\nALTER TABLE v DROP COLUMN x;',
    );
    assert.equal(main([f]), 0);
  });

  it('exit 2 si un archivo no existe', () => {
    assert.equal(main([join(dir, 'no-existe.sql')]), 2);
  });

  it('evalúa múltiples archivos y falla si UNO es destructivo', () => {
    const ok = write('0103_ok.sql', 'ALTER TABLE v ADD COLUMN x text;');
    const bad = write('0104_bad.sql', 'DROP TABLE v;');
    assert.equal(main([ok, bad]), 1);
  });
});
