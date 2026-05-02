// =============================================================================
// Cloud Run Job — merge de users duplicados por email
// =============================================================================
// Caso: Firebase Auth (default) crea cuentas separadas por provider. Si un user
// se registra con email/password y luego entra con Google del mismo email,
// quedan 2 firebase_uids → 2 rows en `usuarios`.
//
// Este job mergea los 2 users en transacción, reasignando todas las FKs hacia
// el user a mantener antes de borrar el duplicado. Idempotente: si ya hay un
// solo user con ese email, no-op.
//
// Variables:
//   TARGET_EMAIL   email del usuario duplicado a mergear (required)
//   DRY_RUN        "false" para commitear; cualquier otro valor = rollback (default true)
//   DATABASE_URL   inyectado vía Secret Manager por Cloud Run Job
//
// Regla de decisión:
//   - keep = user con membresías (fuente de verdad de las relaciones)
//   - drop = el otro
//   - si ninguno tiene membresías → keep = más antiguo (por creado_en)
//   - si ambos tienen membresías → ABORT (revisión manual)
//
// Acción:
//   - reasigna las 8 FKs hacia `usuarios.id` desde drop → keep
//   - actualiza keep.firebase_uid = drop.firebase_uid (asume drop = sesión activa)
//   - borra drop
//   - verifica que quede exactamente 1 user con ese email
// =============================================================================

import pg from 'pg';

interface UserRow {
  id: string;
  firebase_uid: string;
  email: string;
  nombre_completo: string;
  estado: string;
  creado_en: Date;
}

interface FkRef {
  table: string;
  col: string;
}

const FK_REFS: FkRef[] = [
  { table: 'membresias', col: 'usuario_id' },
  { table: 'membresias', col: 'invitado_por_id' },
  { table: 'viajes', col: 'creado_por_id' },
  { table: 'asignaciones', col: 'conductor_id' },
  { table: 'eventos_viaje', col: 'registrado_por_id' },
  { table: 'stakeholders', col: 'usuario_id' },
  { table: 'consentimientos', col: 'otorgado_por_id' },
  { table: 'dispositivos_pendientes', col: 'asignado_por_id' },
];

function log(level: string, msg: string, fields: Record<string, unknown> = {}): void {
  // Stdout JSON line — Cloud Logging la parsea a structured log automáticamente.
  process.stdout.write(
    `${JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields })}\n`,
  );
}

function fatal(msg: string, fields: Record<string, unknown> = {}, code = 1): never {
  log('fatal', msg, fields);
  process.exit(code);
}

const TARGET_EMAIL = process.env.TARGET_EMAIL;
// DRY_RUN default = true. Solo commitea si se setea explícitamente "false".
const DRY_RUN = process.env.DRY_RUN !== 'false';
const DATABASE_URL = process.env.DATABASE_URL;

if (!TARGET_EMAIL) {
  fatal('TARGET_EMAIL env var is required', {}, 2);
}
if (!DATABASE_URL) {
  fatal('DATABASE_URL env var is required', {}, 2);
}

const pool = new pg.Pool({
  connectionString: DATABASE_URL,
  max: 2,
  connectionTimeoutMillis: 10_000,
});

async function countFks(client: pg.PoolClient, userId: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const fk of FK_REFS) {
    const { rows } = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM ${fk.table} WHERE ${fk.col} = $1`,
      [userId],
    );
    counts[`${fk.table}.${fk.col}`] = rows[0]?.n ?? 0;
  }
  return counts;
}

async function run(): Promise<void> {
  log('info', 'merge-duplicate-users job started', {
    target_email: TARGET_EMAIL,
    dry_run: DRY_RUN,
  });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: users } = await client.query<UserRow>(
      `SELECT id, firebase_uid, email, nombre_completo, estado, creado_en
         FROM usuarios
        WHERE email = $1
        ORDER BY creado_en ASC`,
      [TARGET_EMAIL],
    );
    log('info', 'users found by email', { count: users.length, users });

    if (users.length === 0) {
      log('info', 'no users with target email — no-op (idempotent)');
      await client.query('ROLLBACK');
      return;
    }
    if (users.length === 1) {
      // Diagnóstico: reportar FKs del único user para saber si tiene
      // membresías, viajes, etc. Útil para detectar empty-state post-fix.
      // biome-ignore lint/style/noNonNullAssertion: length checked above
      const onlyUser = users[0]!;
      const fkCounts = await countFks(client, onlyUser.id);
      log('info', 'exactly one user — no merge needed; reporting FK counts as diagnostic', {
        user: onlyUser,
        fk_counts: fkCounts,
        total_refs: Object.values(fkCounts).reduce((a, b) => a + b, 0),
      });
      await client.query('ROLLBACK');
      return;
    }
    if (users.length > 2) {
      await client.query('ROLLBACK');
      fatal(
        'more than 2 users with target email — manual review required',
        { count: users.length },
        3,
      );
    }

    // Contar FKs por user
    const fkCounts: Record<string, Record<string, number>> = {};
    for (const u of users) {
      fkCounts[u.id] = await countFks(client, u.id);
    }
    log('info', 'fk reference counts per user', { fk_counts: fkCounts });

    // Decisión determinista
    const usersWithMemberships = users.filter(
      (u) => (fkCounts[u.id]?.['membresias.usuario_id'] ?? 0) > 0,
    );

    let keep: UserRow;
    let drop: UserRow;

    if (usersWithMemberships.length === 2) {
      await client.query('ROLLBACK');
      fatal('both users have memberships — ambiguous, manual review required', { users }, 4);
    } else if (usersWithMemberships.length === 1) {
      // biome-ignore lint/style/noNonNullAssertion: length checked above
      keep = usersWithMemberships[0]!;
      // biome-ignore lint/style/noNonNullAssertion: keep is one of users; the other always exists since users.length === 2
      drop = users.find((u) => u.id !== keep.id)!;
      log('info', 'decision: keep user with memberships', { reason: 'memberships_present' });
    } else {
      // Ninguno tiene memberships — keep = más antiguo (users ya viene ASC por creado_en)
      // biome-ignore lint/style/noNonNullAssertion: users.length === 2 checked above
      keep = users[0]!;
      // biome-ignore lint/style/noNonNullAssertion: users.length === 2 checked above
      drop = users[1]!;
      log('info', 'decision: keep older user (no memberships on either)', {
        reason: 'older_creado_en',
      });
    }

    log('info', 'merge plan', {
      keep: { id: keep.id, firebase_uid: keep.firebase_uid, creado_en: keep.creado_en },
      drop: { id: drop.id, firebase_uid: drop.firebase_uid, creado_en: drop.creado_en },
      action:
        'reassign 8 FKs from drop to keep, update keep.firebase_uid to drop.firebase_uid, delete drop',
    });

    // Reasignar FKs: drop → keep
    for (const fk of FK_REFS) {
      const result = await client.query(
        `UPDATE ${fk.table} SET ${fk.col} = $1 WHERE ${fk.col} = $2`,
        [keep.id, drop.id],
      );
      if ((result.rowCount ?? 0) > 0) {
        log('info', 'fk reassigned', { table: fk.table, col: fk.col, rows: result.rowCount });
      }
    }

    // Actualizar firebase_uid del keep al del drop (la sesión Google activa).
    // El backend /me ya tiene account-linking automático (commit 29d32ca) que
    // mantendrá esto en sync si el user vuelve a usar email/password después.
    const previousUid = keep.firebase_uid;
    await client.query(
      'UPDATE usuarios SET firebase_uid = $1, actualizado_en = NOW() WHERE id = $2',
      [drop.firebase_uid, keep.id],
    );
    log('info', 'keep.firebase_uid updated', {
      user_id: keep.id,
      previous_firebase_uid: previousUid,
      new_firebase_uid: drop.firebase_uid,
    });

    // Borrar drop
    const deleteResult = await client.query('DELETE FROM usuarios WHERE id = $1', [drop.id]);
    log('info', 'drop user deleted', { user_id: drop.id, rows: deleteResult.rowCount });

    // Verificar invariante
    const { rows: postMerge } = await client.query<UserRow>(
      'SELECT id, firebase_uid, email, nombre_completo FROM usuarios WHERE email = $1',
      [TARGET_EMAIL],
    );
    log('info', 'post-merge state (within tx)', { users: postMerge });

    if (postMerge.length !== 1) {
      await client.query('ROLLBACK');
      fatal('post-merge invariant violation — expected 1 user', { count: postMerge.length }, 5);
    }

    if (DRY_RUN) {
      log('info', 'DRY_RUN=true — rolling back transaction (no changes persisted)');
      await client.query('ROLLBACK');
    } else {
      await client.query('COMMIT');
      log('info', 'merge committed successfully');
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {
      // ROLLBACK puede fallar si la conexión ya está rota; el error original ya se loguea abajo.
    });
    log('fatal', 'transaction failed, rolled back', {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    throw err;
  } finally {
    client.release();
  }
}

run()
  .then(async () => {
    await pool.end();
    log('info', 'job finished cleanly');
    process.exit(0);
  })
  .catch(async (err) => {
    await pool.end().catch(() => {
      // pool.end() puede fallar si ya se cerró; igual estamos saliendo con error.
    });
    log('fatal', 'job failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    process.exit(1);
  });
