#!/usr/bin/env node
/**
 * Linter custom RLS — escanea apps/api/src/{routes,services,jobs}/*.ts y reporta
 * queries SELECT/UPDATE/DELETE (Drizzle y raw SQL) que NO incluyen un filtro
 * `empresaId` en su WHERE.
 *
 * Cierra ADR-028 §"Acciones derivadas §3" — defense-in-depth contra IDOR
 * cross-tenant. Corre en CI (`pnpm lint` → `biome check . && pnpm lint:rls`)
 * para impedir que un PR agregue una query nueva sin scope empresa.
 *
 * Estrategia (matcher textual, no AST — ver references/security/idor-audit-2026-05-10.md):
 *   - Drizzle: `.from|update|delete(<ident>)` cuenta como query SOLO si `<ident>`
 *     es una tabla real del schema (fix-1: descarta Buffer.from/Array.from/…).
 *   - Raw SQL: `db.execute(sql`…`)` / `pool.query(`…`)` — la tabla sale del texto
 *     SQL por su nombre snake_case (fix-2).
 *   - Para cada query busca en la ventana −10/+30 líneas un token de filtro tenant
 *     (`empresaId`/`empresa_id`/…) o un allowlist comment `// rls-allowlist: <razón>`.
 *   - Si NO encuentra → finding. Tablas globales/pre-tenant en TENANT_FREE_TABLES.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SRC_DIR = 'apps/api/src';
const DOC_EXENCIONES = 'docs/rls-exemptions.md';

/**
 * Directorios escaneados (spec lint-rls-services-jobs §3.1). Antes: solo
 * `routes/`. Ahora también `services/` y `jobs/`, que acceden a la DB y no
 * estaban cubiertos por ninguna herramienta (censo multi-tenant 2026-07-14 §2).
 */
const SCAN_DIRS = ['routes', 'services', 'jobs'].map((d) => resolve(SRC_DIR, d));

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
  'tripMetrics', // alias inglés de metricasViaje
  'chatMessages', // se filtra por assignment_id (que ya validó tenant en resolveChatAccess)
  'pushSubscriptions', // se filtra por userId
  'telemetryPoints', // se filtra por vehicleId (que ya validó tenant)
  'posicionesMovilConductor', // se filtra por vehicleId (que ya validó tenant), igual que telemetryPoints
  'cuentasDemo', // T1 SEC-001 Sprint 2a: 4-row global registry de cuentas demo (no per-tenant). Ver ADR-053 + docs/qa/demo-accounts.md.
  // +4 (spec lint-rls-services-jobs §3.4, censo §1/§6): sin discriminador ni FK indirecto a tabla tenant-scoped.
  'solicitudesRegistro', // pre-tenant: signup público gated por admin, la empresa aún no existe (censo §5)
  'matchingBacktestRuns', // admin/global: backtest platform-admin sobre todas las empresas (rls-viabilidad §3)
  'empresas', // raíz del tenant: es la tabla `empresas` misma, no se auto-filtra por empresa_id (censo §1)
  'membershipTiers', // catálogo global de tiers de membresía (censo §1)
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

/**
 * Sitios de raw SQL (fix-2, §3.3): `db.execute(sql`…`)`, `pool.query(`…`)`,
 * `client.query('…')`. Matchea hasta el delimitador de apertura del cuerpo SQL.
 * `\.query\(` exige comilla/backtick inmediato → no colisiona con el query
 * builder relacional de Drizzle (`db.query.users.findMany(`).
 */
const RAW_CALL_RE = /\bexecute\(\s*sql(`)|\.query\(\s*(`|'|")/g;

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Extrae el cuerpo de un string/template delimitado desde el delimitador de
 * apertura `openIdx`: corta en el siguiente delimitador igual no escapado.
 * Escaneo textual pragmático (no parser); suficiente para SQL crudo (§6).
 */
function extractDelimited(content, openIdx, delim) {
  for (let i = openIdx + 1; i < content.length; i += 1) {
    if (content[i] === '\\') {
      i += 1; // salta el carácter escapado (p. ej. un delimitador \` dentro del cuerpo)
      continue;
    }
    if (content[i] === delim) {
      return { body: content.slice(openIdx + 1, i), endIdx: i };
    }
  }
  return { body: content.slice(openIdx + 1), endIdx: content.length };
}

/**
 * Parsea `export const <ident> = pgTable('<sql_name>', …)` del fuente de
 * schema.ts → mapa identJS → nombreSQL (39 tablas). Soporta single-line y
 * multi-line (nombre SQL en la línea siguiente).
 */
export function parseSchemaTables(schemaSource) {
  const map = new Map();
  const re = /export const (\w+) = pgTable\(\s*["'`]([^"'`]+)["'`]/g;
  for (const m of schemaSource.matchAll(re)) {
    map.set(m[1], m[2]);
  }
  return map;
}

/**
 * Propiedades Drizzle que discriminan el tenant en una tabla. Una tabla sin
 * ninguna de ellas no se puede filtrar por empresa directamente.
 */
const TENANT_COLUMN_PROPS = [
  'empresaId',
  'generadorCargaEmpresaId',
  'empresaCarrierId',
  'empresaShipperId',
];

/**
 * Identificadores Drizzle de las tablas de schema.ts sin columna de tenant
 * (T10-13). Lee el cuerpo de cada `pgTable(...)` hasta el siguiente export.
 */
export function tablasSinColumnaTenant(schemaSource) {
  const sinTenant = new Set();
  const re = /export const (\w+) = pgTable\(/g;
  const matches = [...schemaSource.matchAll(re)];
  matches.forEach((m, i) => {
    const desde = (m.index ?? 0) + m[0].length;
    const hasta = matches[i + 1]?.index ?? schemaSource.length;
    const cuerpo = schemaSource.slice(desde, hasta);
    const tieneTenant = TENANT_COLUMN_PROPS.some((prop) =>
      new RegExp(`\\b${prop}\\s*:`).test(cuerpo),
    );
    if (!tieneTenant) {
      sinTenant.add(m[1]);
    }
  });
  return sinTenant;
}

const SECCION_EXENTAS = '## Exentas por tabla';
const SECCION_POR_QUERY = '## Sin columna `empresa_id`';

/** Identificadores en la primera columna (`` `ident` ``) de las filas de una sección. */
function tablasDeSeccion(docSource, encabezado) {
  const inicio = docSource.indexOf(encabezado);
  if (inicio === -1) {
    return null;
  }
  const resto = docSource.slice(inicio + encabezado.length);
  const fin = resto.search(/\n## /);
  const seccion = fin === -1 ? resto : resto.slice(0, fin);
  const idents = new Set();
  for (const m of seccion.matchAll(/^\|\s*`(\w+)`\s*\|/gm)) {
    idents.add(m[1]);
  }
  return idents;
}

/**
 * T10-13: `docs/rls-exemptions.md` coincide con `TENANT_FREE_TABLES` y
 * documenta cada tabla del schema sin columna de tenant. Devuelve la lista de
 * problemas (vacía si está consistente).
 */
export function verificarDocExenciones({ docSource, schemaSource, tenantFree }) {
  const problemas = [];
  const tablas = parseSchemaTables(schemaSource);
  const sinTenant = tablasSinColumnaTenant(schemaSource);
  const exentasDoc = tablasDeSeccion(docSource, SECCION_EXENTAS);
  const porQueryDoc = tablasDeSeccion(docSource, SECCION_POR_QUERY);
  if (!exentasDoc || !porQueryDoc) {
    return [
      `docs/rls-exemptions.md debe tener las secciones «${SECCION_EXENTAS}» y «${SECCION_POR_QUERY}»`,
    ];
  }
  for (const t of tenantFree) {
    if (!tablas.has(t)) {
      problemas.push(`${t}: está en TENANT_FREE_TABLES pero no es una tabla de schema.ts`);
    }
    if (!exentasDoc.has(t)) {
      problemas.push(`${t}: está en TENANT_FREE_TABLES y falta en la sección de exentas del doc`);
    }
  }
  for (const t of exentasDoc) {
    if (!tenantFree.has(t)) {
      problemas.push(`${t}: figura como exenta en el doc pero no está en TENANT_FREE_TABLES`);
    }
  }
  for (const t of porQueryDoc) {
    if (!tablas.has(t)) {
      problemas.push(`${t}: figura en el doc pero no es una tabla de schema.ts`);
    }
  }
  for (const t of sinTenant) {
    if (!exentasDoc.has(t) && !porQueryDoc.has(t)) {
      problemas.push(`${t}: tabla sin columna de tenant sin documentar en docs/rls-exemptions.md`);
    }
  }
  return problemas;
}

/**
 * Escanea el contenido de un archivo y devuelve findings { line, table, kind }.
 * @param {string} content
 * @param {{ tables: Map<string,string>, tenantFree: Set<string> }} opts
 */
export function scanContent(content, opts) {
  const { tables, tenantFree } = opts;
  const tableIdents = new Set(tables.keys());
  // Nombres SQL (snake_case) de tablas tenant-scoped (ident ∉ tenant-free),
  // insumo del matcher raw (fix-2). `empresas`, `planes`, etc. quedan fuera.
  const tenantScopedSql = [];
  for (const [ident, sqlName] of tables) {
    if (!tenantFree.has(ident)) {
      tenantScopedSql.push(sqlName);
    }
  }

  const findings = [];
  const lines = content.split('\n');

  // Ventana −10/+30 alrededor de [startLine, endLine]: allowlist o token tenant.
  const hasFilterOrAllowlist = (startLine, endLine) => {
    const windowStart = Math.max(0, startLine - 11);
    const windowEnd = Math.min(endLine - 1 + 30, lines.length);
    const window = lines.slice(windowStart, windowEnd).join('\n');
    if (ALLOWLIST_COMMENT_RE.test(window)) {
      return true;
    }
    return TENANT_FILTER_TOKENS.some((tok) => window.includes(tok));
  };

  // --- fix-1: Drizzle .from/.update/.delete(ident) — solo si ident es tabla real del schema ---
  for (const match of content.matchAll(QUERY_RE)) {
    const tableName = match[1];
    if (!tableIdents.has(tableName)) {
      continue; // Buffer.from/Array.from/Date.from → no son tablas
    }
    if (tenantFree.has(tableName)) {
      continue;
    }
    const queryStart = content.lastIndexOf('\n', match.index) + 1;
    const lineNumber = content.slice(0, queryStart).split('\n').length;
    if (hasFilterOrAllowlist(lineNumber, lineNumber)) {
      continue;
    }
    findings.push({ line: lineNumber, table: tableName, kind: 'drizzle' });
  }

  // --- fix-2: raw SQL — tabla tenant-scoped por su nombre SQL en el cuerpo ---
  for (const rm of content.matchAll(RAW_CALL_RE)) {
    const delim = rm[0][rm[0].length - 1];
    const openIdx = rm.index + rm[0].length - 1;
    const { body, endIdx } = extractDelimited(content, openIdx, delim);

    const hit = tenantScopedSql.find((name) =>
      new RegExp(`\\b${escapeRegExp(name)}\\b`).test(body),
    );
    if (!hit) {
      continue;
    }
    const callStart = content.lastIndexOf('\n', rm.index) + 1;
    const callLine = content.slice(0, callStart).split('\n').length;
    const endLine = content.slice(0, endIdx).split('\n').length;
    if (hasFilterOrAllowlist(callLine, endLine)) {
      continue;
    }
    findings.push({ line: callLine, table: hit, kind: 'raw' });
  }

  return findings;
}

function walk(dir, opts, findings) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, opts, findings);
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
      const content = readFileSync(full, 'utf-8');
      for (const f of scanContent(content, opts)) {
        findings.push({ ...f, file: full.replace(`${process.cwd()}/`, '') });
      }
    }
  }
  return findings;
}

/** Recorre `scanDirs` y devuelve todos los findings con `file` resuelto. */
export function collectFindings(scanDirs, opts) {
  const findings = [];
  for (const dir of scanDirs) {
    walk(dir, opts, findings);
  }
  return findings;
}

/**
 * Entry point. Parametrizable para tests (scanDirs, schemaSource, sinks de log).
 * @returns {0|1} exit code.
 */
export function main({
  scanDirs = SCAN_DIRS,
  schemaSource,
  // `undefined` lee docs/rls-exemptions.md; `null` omite la verificación
  // (tests de main() que no tratan del doc).
  docSource,
  log = console.log,
  err = console.error,
} = {}) {
  const src = schemaSource ?? readFileSync(resolve(SRC_DIR, 'db/schema.ts'), 'utf-8');
  const tables = parseSchemaTables(src);
  const findings = collectFindings(scanDirs, { tables, tenantFree: TENANT_FREE_TABLES });

  // T10-13: el doc de exenciones se mantiene sincronizado con el código.
  if (docSource !== null) {
    const problemas = verificarDocExenciones({
      docSource: docSource ?? readFileSync(DOC_EXENCIONES, 'utf-8'),
      schemaSource: src,
      tenantFree: TENANT_FREE_TABLES,
    });
    if (problemas.length > 0) {
      err('❌ lint-rls: docs/rls-exemptions.md no coincide con el schema o TENANT_FREE_TABLES.\n');
      for (const p of problemas) {
        err(`  ${p}`);
      }
      return 1;
    }
  }

  if (findings.length === 0) {
    log('✅ lint-rls: 0 queries sin filtro empresaId fuera de allowlist.');
    return 0;
  }

  err('❌ lint-rls: queries sin filtro empresaId detectadas.\n');
  for (const f of findings) {
    err(`  ${f.file}:${f.line}`);
    err(`    tabla: ${f.table} (${f.kind})`);
    err('');
  }
  err('Soluciones posibles:');
  err(
    '  1. Agregar filtro: .where(and(eq(t.id, id), eq(t.empresaId, ctx.activeMembership.empresa.id)))',
  );
  err('  2. Si es tabla tenant-free legítima, agregarla a TENANT_FREE_TABLES con razón.');
  err(
    '  3. Si es excepción justificada, marcar con `// rls-allowlist: <razón>` en la ventana de la query.',
  );
  return 1;
}

export { TENANT_FREE_TABLES, TENANT_FILTER_TOKENS };

// CLI entrypoint — solo corre cuando se ejecuta directo, no al importar.
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  process.exit(main());
}
