import type { Logger } from '@booster-ai/logger';
import { ensureRutHasDash, rutSchema } from '@booster-ai/shared-schemas';
import { and, eq, ne } from 'drizzle-orm';
import type { Auth } from 'firebase-admin/auth';
import type { Db } from '../db/client.js';
import { users } from '../db/schema.js';
import { hashClaveNumerica, isValidClaveFormat } from './clave-numerica.js';

/**
 * Gap A del alta de usuarios (diagnóstico hito CORFO §7,
 * `.specs/bootstrap-platform-admin/spec.md`) — bootstrap reproducible del
 * platform admin.
 *
 * Responde la pregunta que ADR-052 dejó sin diseñar: ¿cómo NACE el primer
 * admin que aprueba todas las altas? Este service crea/reconcilia, de forma
 * idempotente y no destructiva:
 *
 *   1. La cuenta Firebase del email (Admin SDK `createUser`, mismo call que
 *      el approve en `signup-request.ts`).
 *   2. La fila `usuarios` con TODO lo que la operación necesita:
 *      `is_platform_admin=true` (misma shape que el auto-provision de
 *      `/me`), `rut` canónico + `clave_numerica_hash` scrypt — las columnas
 *      exactas que `POST /auth/login-rut` consulta. Resultado: el admin
 *      entra por LoginUniversal (tarjeta Booster) sin depender del login
 *      legacy ni de `?legacy=1`.
 *
 * Invariantes no destructivos (criterio 3 de la spec):
 *   - email fuera de la allowlist ⇒ abort (la allowlist NO se edita acá; su
 *     fuente de verdad es Terraform).
 *   - RUT ya declarado y distinto ⇒ abort (espeja la inmutabilidad de
 *     `PATCH /me/profile`).
 *   - RUT en poder de otro usuario ⇒ abort (proteger el lookup de login-rut).
 *   - clave existente ⇒ no-op salvo `rotateClave` explícito.
 *
 * Orden Firebase→BD igual que el approve de producción: si la transacción BD
 * aborta después de crear la cuenta Firebase, la cuenta queda (re-corrida la
 * reutiliza); jamás queda una fila `usuarios` a medias.
 */

export interface BootstrapPlatformAdminInput {
  email: string;
  fullName: string;
  /** Cualquier formato que acepte `ensureRutHasDash`+`rutSchema`; se persiste canónico. */
  rut: string;
  /** Clave numérica de 6 dígitos (formato de `isValidClaveFormat`). */
  clave: string;
  /** Reemplaza una clave ya seteada. Sin esto, clave existente = no-op. */
  rotateClave?: boolean;
  /** Reporta acciones sin escribir en Firebase ni BD. */
  dryRun?: boolean;
}

export interface BootstrapPlatformAdminResult {
  firebase: 'created' | 'existing';
  user: 'created' | 'reconciled' | 'unchanged';
  /** Una entrada legible por acción tomada (o que se tomaría, en dry-run). */
  actions: string[];
  /** uid Firebase real; en dry-run sin cuenta previa: `dry-run-pending`. */
  firebaseUid: string;
  /** id de la fila `usuarios`; null solo en dry-run sin fila previa. */
  userId: string | null;
  dryRun: boolean;
}

export class InvalidBootstrapInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidBootstrapInputError';
  }
}

export class NotInAllowlistError extends Error {
  constructor(email: string) {
    super(
      `El email ${email} no está en BOOSTER_PLATFORM_ADMIN_EMAILS. ` +
        'La allowlist se administra en Terraform (variables del servicio api), no desde este script.',
    );
    this.name = 'NotInAllowlistError';
  }
}

export class RutConflictError extends Error {
  constructor(rut: string) {
    super(`El RUT ${rut} ya pertenece a otro usuario. Abort sin escrituras.`);
    this.name = 'RutConflictError';
  }
}

export class RutImmutableError extends Error {
  constructor(declared: string, requested: string) {
    super(
      `La fila del admin ya declara RUT ${declared} y se pidió ${requested}. ` +
        'Cambiar un RUT declarado no es alcance del bootstrap (espejo de PATCH /me/profile).',
    );
    this.name = 'RutImmutableError';
  }
}

export class FirebaseUidConflictError extends Error {
  constructor(firebaseUid: string, email: string) {
    super(
      `El firebase_uid ${firebaseUid} ya pertenece a la fila de ${email}. ` +
        'Resolver manualmente antes de re-correr (posible cuenta Firebase compartida).',
    );
    this.name = 'FirebaseUidConflictError';
  }
}

export async function bootstrapPlatformAdmin(opts: {
  db: Db;
  firebaseAuth: Auth;
  logger: Logger;
  /** Allowlist vigente (misma semántica que `BOOSTER_PLATFORM_ADMIN_EMAILS` parseada). */
  allowlist: string[];
  input: BootstrapPlatformAdminInput;
}): Promise<BootstrapPlatformAdminResult> {
  const { db, firebaseAuth, logger, input } = opts;
  const dryRun = input.dryRun === true;
  const actions: string[] = [];
  const note = (action: string) => {
    actions.push(dryRun ? `dry-run: ${action}` : action);
  };

  // 1. Normalización + validación de entradas (mismos primitivos que el
  //    resto del stack — el RUT queda EXACTAMENTE en la forma que
  //    login-rut busca con eq(users.rut, ...)).
  const email = input.email.trim().toLowerCase();
  const fullName = input.fullName.trim();
  if (!fullName) {
    throw new InvalidBootstrapInputError('fullName vacío');
  }
  const rutParsed = rutSchema.safeParse(ensureRutHasDash(input.rut.trim()));
  if (!rutParsed.success) {
    throw new InvalidBootstrapInputError(
      `RUT inválido: ${rutParsed.error.issues[0]?.message ?? 'formato no reconocido'}`,
    );
  }
  const rut = rutParsed.data;
  if (!isValidClaveFormat(input.clave)) {
    throw new InvalidBootstrapInputError('La clave debe ser exactamente 6 dígitos.');
  }

  // 2. Gate de allowlist — fail-closed ANTES de tocar Firebase o BD.
  const allowlist = opts.allowlist.map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (!allowlist.includes(email)) {
    throw new NotInAllowlistError(email);
  }

  // 3. Firebase primero (mismo orden que el approve). Idempotente por email.
  let firebase: BootstrapPlatformAdminResult['firebase'];
  let firebaseUid: string;
  const existingFbUser = await firebaseAuth.getUserByEmail(email).catch((err: unknown) => {
    if ((err as { code?: string } | null)?.code === 'auth/user-not-found') {
      return null;
    }
    throw err;
  });
  if (existingFbUser) {
    firebase = 'existing';
    firebaseUid = existingFbUser.uid;
    note(`cuenta Firebase existente reutilizada (uid=${firebaseUid})`);
  } else {
    firebase = 'created';
    if (dryRun) {
      firebaseUid = 'dry-run-pending';
      note(`crearía cuenta Firebase para ${email}`);
    } else {
      const created = await firebaseAuth.createUser({
        email,
        displayName: fullName,
        emailVerified: false,
      });
      firebaseUid = created.uid;
      note(`cuenta Firebase creada (uid=${firebaseUid})`);
    }
  }

  // 4. Fila `usuarios` en una transacción: o se reconcilia completa o nada.
  const outcome = await db.transaction(async (tx) => {
    // 4a. El RUT no puede pertenecer a otro usuario.
    const rutOwner = await tx
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(and(eq(users.rut, rut), ne(users.email, email)))
      .limit(1);
    if (rutOwner.length > 0) {
      throw new RutConflictError(rut);
    }

    const existingRows = await tx.select().from(users).where(eq(users.email, email)).limit(1);
    const existing = existingRows[0];

    // 4b. Defensa: el uid Firebase no puede estar en la fila de OTRO email.
    if (firebaseUid !== 'dry-run-pending') {
      const uidOwner = await tx
        .select({ email: users.email })
        .from(users)
        .where(and(eq(users.firebaseUid, firebaseUid), ne(users.email, email)))
        .limit(1);
      const uidOwnerEmail = uidOwner[0]?.email;
      if (uidOwnerEmail) {
        throw new FirebaseUidConflictError(firebaseUid, uidOwnerEmail);
      }
    }

    if (!existing) {
      note(
        `fila usuarios creada: rut=${rut}, is_platform_admin=true, status=activo, clave seteada`,
      );
      if (dryRun) {
        return { user: 'created' as const, userId: null };
      }
      const inserted = await tx
        .insert(users)
        .values({
          firebaseUid,
          email,
          fullName,
          rut,
          claveNumericaHash: hashClaveNumerica(input.clave),
          isPlatformAdmin: true,
          status: 'activo',
        })
        .returning({ id: users.id });
      const userId = inserted[0]?.id;
      if (!userId) {
        throw new Error('INSERT usuarios no retornó fila');
      }
      return { user: 'created' as const, userId };
    }

    // 4c. Reconciliación por columna sobre la fila existente.
    if (existing.rut !== null && existing.rut !== rut) {
      throw new RutImmutableError(existing.rut, rut);
    }

    const patch: Partial<typeof users.$inferInsert> = {};
    if (existing.firebaseUid !== firebaseUid && firebaseUid !== 'dry-run-pending') {
      patch.firebaseUid = firebaseUid;
      note(`firebase_uid actualizado ${existing.firebaseUid} → ${firebaseUid}`);
    }
    if (existing.rut === null) {
      patch.rut = rut;
      note(`rut seteado a ${rut} (estaba NULL)`);
    }
    if (existing.claveNumericaHash === null) {
      patch.claveNumericaHash = hashClaveNumerica(input.clave);
      note('clave numérica seteada (estaba NULL)');
    } else if (input.rotateClave) {
      patch.claveNumericaHash = hashClaveNumerica(input.clave);
      note('clave numérica ROTADA (--rotate-clave)');
    } else {
      note('clave numérica existente conservada (sin --rotate-clave)');
    }
    if (!existing.isPlatformAdmin) {
      patch.isPlatformAdmin = true;
      note('is_platform_admin corregido a true');
    }
    if (existing.status !== 'activo') {
      patch.status = 'activo';
      note(`status corregido ${existing.status} → activo`);
    }
    if (existing.fullName !== fullName) {
      patch.fullName = fullName;
      note(`nombre actualizado a "${fullName}"`);
    }

    if (Object.keys(patch).length === 0) {
      return { user: 'unchanged' as const, userId: existing.id };
    }
    if (dryRun) {
      return { user: 'reconciled' as const, userId: existing.id };
    }
    patch.updatedAt = new Date();
    await tx.update(users).set(patch).where(eq(users.id, existing.id));
    return { user: 'reconciled' as const, userId: existing.id };
  });

  logger.info(
    {
      email,
      firebase,
      user: outcome.user,
      userId: outcome.userId,
      dryRun,
      // La clave y su hash JAMÁS se loguean; las acciones solo describen.
      actions,
    },
    'bootstrap-platform-admin: completado',
  );

  return {
    firebase,
    user: outcome.user,
    actions,
    firebaseUid,
    userId: outcome.userId,
    dryRun,
  };
}
