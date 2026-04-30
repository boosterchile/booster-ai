import type { Logger } from '@booster-ai/logger';
import type { EmpresaOnboardingInput } from '@booster-ai/shared-schemas';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  type EmpresaRow,
  type MembershipRow,
  type UserRow,
  empresas,
  memberships,
  plans,
  users,
} from '../db/schema.js';

/**
 * Resultado del onboarding exitoso. Mismo shape que /me onboarded para
 * que el cliente web pueda hacer queryClient.setQueryData(['me'], ...) y
 * navegar a /app sin refetch.
 */
export interface OnboardingResult {
  user: UserRow;
  empresa: EmpresaRow;
  membership: MembershipRow;
}

export class UserAlreadyExistsError extends Error {
  constructor(public readonly firebaseUid: string) {
    super(`User with firebase_uid=${firebaseUid} already exists`);
    this.name = 'UserAlreadyExistsError';
  }
}

export class EmpresaRutDuplicateError extends Error {
  constructor(public readonly rut: string) {
    super(`Empresa with rut=${rut} already exists`);
    this.name = 'EmpresaRutDuplicateError';
  }
}

export class PlanNotFoundError extends Error {
  constructor(public readonly slug: string) {
    super(`Plan with slug=${slug} not found`);
    this.name = 'PlanNotFoundError';
  }
}

export class EmailAlreadyInUseError extends Error {
  constructor(public readonly email: string) {
    super(`User with email=${email} already exists with a different firebase_uid`);
    this.name = 'EmailAlreadyInUseError';
  }
}

/**
 * Onboarding atómico: crea user + empresa + membership en una transacción.
 *
 * Pre-condiciones (validadas dentro de la transacción para evitar TOCTOU):
 *   - No existe user con `firebaseUid` (sino UserAlreadyExistsError 409).
 *   - No existe user con `email` (sino EmailAlreadyInUseError 409).
 *   - No existe empresa con `input.empresa.rut` (sino EmpresaRutDuplicateError 409).
 *   - El plan slug existe en `plans` y está activo (sino PlanNotFoundError 400).
 *
 * En éxito: user.status='active', empresa.status='pending_verification',
 * membership.status='active' role='owner'. La empresa queda en
 * pending_verification para que ops valide RUT antes de habilitar
 * matching/billing real.
 */
export async function onboardEmpresa(opts: {
  db: Db;
  logger: Logger;
  firebaseUid: string;
  firebaseEmail: string;
  input: EmpresaOnboardingInput;
}): Promise<OnboardingResult> {
  const { db, logger, firebaseUid, firebaseEmail, input } = opts;

  return await db.transaction(async (tx) => {
    // 1. Verificar user no existe (por firebase_uid).
    const existingByUid = await tx
      .select()
      .from(users)
      .where(eq(users.firebaseUid, firebaseUid))
      .limit(1);
    if (existingByUid.length > 0) {
      throw new UserAlreadyExistsError(firebaseUid);
    }

    // 2. Verificar email no usado por otro user.
    const existingByEmail = await tx
      .select()
      .from(users)
      .where(eq(users.email, firebaseEmail))
      .limit(1);
    if (existingByEmail.length > 0) {
      throw new EmailAlreadyInUseError(firebaseEmail);
    }

    // 3. Verificar empresa.rut no duplicado.
    const existingEmpresa = await tx
      .select()
      .from(empresas)
      .where(eq(empresas.rut, input.empresa.rut))
      .limit(1);
    if (existingEmpresa.length > 0) {
      throw new EmpresaRutDuplicateError(input.empresa.rut);
    }

    // 4. Resolver plan_id desde slug.
    const planRow = await tx.select().from(plans).where(eq(plans.slug, input.plan_slug)).limit(1);
    const plan = planRow[0];
    if (!plan || !plan.isActive) {
      throw new PlanNotFoundError(input.plan_slug);
    }

    // 5. Insertar user.
    const userInsert = await tx
      .insert(users)
      .values({
        firebaseUid,
        email: firebaseEmail,
        fullName: input.user.full_name,
        phone: input.user.phone,
        ...(input.user.rut ? { rut: input.user.rut } : {}),
        status: 'active',
        isPlatformAdmin: false,
      })
      .returning();
    const user = userInsert[0];
    if (!user) {
      throw new Error('Insert user returned no row');
    }

    // 6. Insertar empresa.
    const empresaInsert = await tx
      .insert(empresas)
      .values({
        legalName: input.empresa.legal_name,
        rut: input.empresa.rut,
        contactEmail: input.empresa.contact_email,
        contactPhone: input.empresa.contact_phone,
        addressStreet:
          input.empresa.address.street +
          (input.empresa.address.number ? ` ${input.empresa.address.number}` : ''),
        addressCity: input.empresa.address.city,
        addressRegion: input.empresa.address.region,
        ...(input.empresa.address.postalCode
          ? { addressPostalCode: input.empresa.address.postalCode }
          : {}),
        isShipper: input.empresa.is_shipper,
        isCarrier: input.empresa.is_carrier,
        planId: plan.id,
        status: 'pending_verification',
        timezone: 'America/Santiago',
      })
      .returning();
    const empresa = empresaInsert[0];
    if (!empresa) {
      throw new Error('Insert empresa returned no row');
    }

    // 7. Crear membership owner active.
    const membershipInsert = await tx
      .insert(memberships)
      .values({
        userId: user.id,
        empresaId: empresa.id,
        role: 'owner',
        status: 'active',
        invitedByUserId: null,
        joinedAt: new Date(),
      })
      .returning();
    const membership = membershipInsert[0];
    if (!membership) {
      throw new Error('Insert membership returned no row');
    }

    logger.info(
      {
        userId: user.id,
        empresaId: empresa.id,
        rut: empresa.rut,
        planSlug: plan.slug,
        isShipper: empresa.isShipper,
        isCarrier: empresa.isCarrier,
      },
      'empresa onboarded',
    );

    return { user, empresa, membership };
  });
}
