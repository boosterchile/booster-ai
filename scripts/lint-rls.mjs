#!/usr/bin/env node
/**
 * Linter custom RLS — escanea apps/api/src/routes/*.ts y reporta queries
 * SELECT/UPDATE/DELETE que NO incluyen un filtro `empresaId` en su WHERE.
 *
 * Cierra ADR-028 §"Acciones derivadas §3" — defense-in-depth contra
 * IDOR cross-tenant. Se ejecuta en CI (lint job) para impedir que un PR
 * agregue una query nueva sin scope empresa.
 *
 * Estrategia:
 *   - Lee cada archivo .ts en routes/.
 *   - Para cada `db.select(...).from(table)...` o `db.update(table)...`
 *     o `db.delete(table)...` busca en las siguientes ~30 líneas la
 *     presencia de uno de los identificadores que indican filtro tenant:
 *     `empresaId`, `empresa_id`, `EmpresaId`, `generadorCargaEmpresaId`.
 *   - Si NO encuentra → reporta como warning con file:line + tabla.
 *   - Si la query está marcada con allowlist comment
 *     `// rls-allowlist: <razón>` la ignora.
 *
 * No es un parser AST completo — es un matcher pragmático suficiente
 * para evitar regresiones obvias. Para análisis profundo, complementar
 * con auditoría manual (ver references/security/idor-audit-2026-05-10.md).
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROUTES_DIR = resolve('apps/api/src/routes');

/** Tablas que NO requieren filtro empresaId — globales, públicas o pre-tenant. */
const TENANT_FREE_TABLES = new Set([
  'users', // resolución por firebase_uid (auth, no por empresa)
  'pendingDevices', // dispositivos globales pre-asignación, ver IDOR audit
  'whatsAppIntakeDrafts', // intake anónimo público
  'plans', // planes catalogados, públicos
  'memberships', // se filtra por userId, no empresa (es la pivot table)
  'consents', // se filtra por grantedByUserId/stakeholderId
  'stakeholders', // se filtra por userId/stakeholderId
  'stakeholderAccessLog', // append-only audit log
  'tripEvents', // siempre se inserta dentro de transacción de un trip ya validado
  'metricasViaje', // se filtra por trip_id (que ya está validado)
  'tripMetrics', // alias inglés de metricasViaje
  'chatMessages', // se filtra por assignment_id (que ya validó tenant en resolveChatAccess)
  'pushSubscriptions', // se filtra por userId
  'telemetryPoints', // se filtra por vehicleId (que ya validó tenant)
  'posicionesMovilConductor', // se filtra por vehicleId (que ya validó tenant), igual que telemetryPoints
]);

/** Tokens que indican filtro empresaId presente. Match case-insensitive. */
const TENANT_FILTER_TOKENS = [
  'empresaId',
  'empresa_id',
  'generadorCargaEmpresaId',
  'generador_carga_empresa_id',
  // ADR-029 v1: factoring usa columnas explícitas con rol del tenant
  // (carrier|shipper) para soportar dos filtros distintos en queries
  // cross-rol — siguen siendo filtros tenant válidos.
  'empresaCarrierId',
  'empresa_carrier_id',
  'empresaShipperId',
  'empresa_shipper_id',
];

/** Comment que marca una query como allowlisted explícitamente. */
const ALLOWLIST_COMMENT_RE = /\/\/\s*rls-allowlist:\s*(.+)/;

const QUERY_RE = /\.(?:from|update|delete)\(\s*([a-zA-Z_]\w*)\s*[,)]/g;

const findings = [];

function scanFile(filePath) {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  // Recorrer queries
  QUERY_RE.lastIndex = 0;
  for (const match of content.matchAll(QUERY_RE)) {
    const tableName = match[1];
    if (TENANT_FREE_TABLES.has(tableName)) {
      continue;
    }

    // Línea de la query
    const queryStart = content.lastIndexOf('\n', match.index) + 1;
    const lineNumber = content.slice(0, queryStart).split('\n').length;

    // Ventana de búsqueda: 10 líneas anteriores + 30 siguientes. El
    // WHERE típicamente está dentro de las primeras ~5 líneas; el lookback
    // de 10 cubre allowlist comments que quedan arriba de un `.select({...})`
    // multilinea antes del `.from(table)`.
    const windowStart = Math.max(0, lineNumber - 11);
    const windowEnd = Math.min(lineNumber - 1 + 30, lines.length);
    const window = lines.slice(windowStart, windowEnd).join('\n');

    // Allowlist explícita
    const allowMatch = window.match(ALLOWLIST_COMMENT_RE);
    if (allowMatch) {
      continue;
    }

    // Buscar token de filtro tenant
    const hasTenantFilter = TENANT_FILTER_TOKENS.some((tok) => window.includes(tok));
    if (hasTenantFilter) {
      continue;
    }

    findings.push({
      file: filePath.replace(`${process.cwd()}/`, ''),
      line: lineNumber,
      table: tableName,
      snippet: lines[lineNumber - 1]?.trim() ?? '',
    });
  }
}

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full);
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
      scanFile(full);
    }
  }
}

walk(ROUTES_DIR);

if (findings.length === 0) {
  console.log('✅ lint-rls: 0 queries sin filtro empresaId fuera de allowlist.');
  process.exit(0);
}

console.error('❌ lint-rls: queries sin filtro empresaId detectadas.\n');
for (const f of findings) {
  console.error(`  ${f.file}:${f.line}`);
  console.error(`    tabla: ${f.table}`);
  console.error(`    código: ${f.snippet}`);
  console.error('');
}
console.error('Soluciones posibles:');
console.error(
  '  1. Agregar filtro: .where(and(eq(table.id, id), eq(table.empresaId, ctx.activeMembership.empresa.id)))',
);
console.error(
  '  2. Si es una tabla tenant-free legítima, agregarla a TENANT_FREE_TABLES en este script con razón.',
);
console.error(
  '  3. Si es una excepción puntual justificada, marcar la query con `// rls-allowlist: <razón breve>` en la línea anterior.',
);
process.exit(1);
