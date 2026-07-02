import type { Logger } from '@booster-ai/logger';
import type { EmpresaOnboardingInput } from '@booster-ai/shared-schemas';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  type EmpresaRow,
  type MembershipRow,
  type UserRow,
  carrierMemberships,
  empresas,
  memberships,
  plans,
  solicitudesRegistro,
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
 * SEC-001 hotfix — self-service onboarding está deshabilitado
 * (`EMPRESA_SELF_ONBOARDING_ENABLED=false`). Service-layer invariant:
 * `onboardEmpresa` rechaza `authorizedBy='self_service'` cuando el flag
 * está OFF, independiente del gate de ruta. Defensa en profundidad para
 * que el futuro flujo aprobación→dueño no auto-provisione por accidente.
 */
export class SelfOnboardingDisabledError extends Error {
  constructor() {
    super('Self-service company onboarding is disabled (EMPRESA_SELF_ONBOARDING_ENABLED=false)');
    this.name = 'SelfOnboardingDisabledError';
  }
}

/**
 * onboarding-flow-redesign T1.5a — onboarding `admin_provisioned` requiere el
 * token de consumo. Defensa: ningún caller `admin_provisioned` puede saltarse
 * el gate del token one-shot.
 */
export class OnboardingTokenRequiredError extends Error {
  constructor() {
    super('admin_provisioned onboarding requires an onboarding token consumption');
    this.name = 'OnboardingTokenRequiredError';
  }
}

/**
 * onboarding-flow-redesign T1.5a — el token de onboarding no es consumible: ya
 * consumido, expirado, inexistente, o `token_hash` no coincide. Uniforme (sin
 * oráculo): el route (T1.5b) lo colapsa en una respuesta genérica.
 */
export class OnboardingTokenNotConsumableError extends Error {
  constructor() {
    super('Onboarding token is not consumable (already consumed, expired, or not found)');
    this.name = 'OnboardingTokenNotConsumableError';
  }
}

/**
 * Quién autoriza la creación del dueño. `self_service` = el propio usuario
 * vía `POST /empresas/onboarding` (gated por `EMPRESA_SELF_ONBOARDING_ENABLED`).
 * `admin_provisioned` = un caller administrativo confiable (p.ej. el futuro
 * flujo aprobación→dueño). Arg requerido (sin default) para forzar a todo
 * caller a declarar explícitamente la base de autorización.
 */
export type OnboardingAuthorization = 'self_service' | 'admin_provisioned';

/**
 * Onboarding atómico: crea user + empresa + membership en una transacción.
 *
 * Pre-condiciones (validadas dentro de la transacción para evitar TOCTOU):
 *   - No existe user con `firebaseUid` (sino UserAlreadyExistsError 409).
 *   - No existe user con `email` (sino EmailAlreadyInUseError 409).
 *   - No existe empresa con `input.empresa.rut` (sino EmpresaRutDuplicateError 409).
 *   - El plan slug existe en `planes` y está activo (sino PlanNotFoundError 400).
 *
 * En éxito: user.estado='activo', empresa.estado='pendiente_verificacion',
 * membership.estado='activa' rol='dueno'.
 */
export async function onboardEmpresa(opts: {
  db: Db;
  logger: Logger;
  firebaseUid: string;
  firebaseEmail: string;
  input: EmpresaOnboardingInput;
  /** Base de autorización del caller (arg requerido — ver OnboardingAuthorization). */
  authorizedBy: OnboardingAuthorization;
  /** Valor del flag `EMPRESA_SELF_ONBOARDING_ENABLED`; consultado solo para `self_service`. */
  selfServiceEnabled: boolean;
  /**
   * onboarding-flow-redesign T1.5a — consumo del token one-shot. REQUERIDO
   * cuando `authorizedBy='admin_provisioned'`. El route (T1.5b) verifica el
   * token (firma+expiración) y pasa el `solicitudId` (sid FIRMADO) + el
   * `tokenHash` (= sha256 del token canónico) para localizar y consumir la
   * fila atómicamente dentro de la transacción.
   */
  onboardingTokenConsumption?: { solicitudId: string; tokenHash: string };
}): Promise<OnboardingResult> {
  const { db, logger, firebaseUid, firebaseEmail, input, authorizedBy, selfServiceEnabled } = opts;

  // SEC-001 hotfix — service-layer invariant (defensa en profundidad). El
  // gate de ruta `/empresas/onboarding` ya rechaza self-service cuando el
  // flag está OFF; este check garantiza que ningún caller (presente o
  // futuro) pueda auto-provisionar saltándose ese gate. `admin_provisioned`
  // no se ve afectado.
  if (authorizedBy === 'self_service' && !selfServiceEnabled) {
    throw new SelfOnboardingDisabledError();
  }

  // T1.5a — admin_provisioned exige el token de consumo (gate de autorización).
  if (authorizedBy === 'admin_provisioned' && !opts.onboardingTokenConsumption) {
    throw new OnboardingTokenRequiredError();
  }

  return await db.transaction(async (tx) => {
    // 0. (admin-provisioned) Consumir el token one-shot ATÓMICAMENTE. El
    //    `WHERE consumido_en IS NULL` garantiza un solo consumo bajo concurrencia
    //    (doble consumo → uno gana; el otro ve 0 filas). Localiza por el `sid`
    //    FIRMADO + `token_hash` (defensa en profundidad) y exige no-expirado
    //    (clock de la BD). 0 filas ⇒ no consumible ⇒ throw ⇒ rollback total
    //    (no se crea user/empresa/membership). Uniforme: no distingue
    //    consumido/expirado/inexistente/hash-mismatch (sin oráculo).
    const consumption = opts.onboardingTokenConsumption;
    if (consumption) {
      const consumed = await tx
        .update(solicitudesRegistro)
        .set({ consumidoEn: new Date() })
        .where(
          and(
            eq(solicitudesRegistro.id, consumption.solicitudId),
            // `estado='aprobado'` explícito (defensa en profundidad, review
            // emit+consume): hoy `token_hash IS NOT NULL ⇒ estado='aprobado'`
            // por construcción, pero esto blinda contra un futuro revoke
            // (aprobado→rechazado) que dejaría un token vivo consumible.
            eq(solicitudesRegistro.estado, 'aprobado'),
            eq(solicitudesRegistro.tokenHash, consumption.tokenHash),
            isNull(solicitudesRegistro.consumidoEn),
            // Expiración por el clock de la BD (autoritativo); el `exp` firmado
            // que verifica el route (T1.5b) es un pre-gate barato.
            gt(solicitudesRegistro.expiraEn, sql`now()`),
          ),
        )
        .returning({ id: solicitudesRegistro.id });
      if (consumed.length === 0) {
        throw new OnboardingTokenNotConsumableError();
      }
    }

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
        whatsappE164: input.user.whatsapp_e164,
        ...(input.user.rut ? { rut: input.user.rut } : {}),
        status: 'activo',
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
        isGeneradorCarga: input.empresa.is_generador_carga,
        isTransportista: input.empresa.is_transportista,
        planId: plan.id,
        status: 'pendiente_verificacion',
        timezone: 'America/Santiago',
      })
      .returning();
    const empresa = empresaInsert[0];
    if (!empresa) {
      throw new Error('Insert empresa returned no row');
    }

    // 7. Crear membership dueno activa.
    const membershipInsert = await tx
      .insert(memberships)
      .values({
        userId: user.id,
        empresaId: empresa.id,
        role: 'dueno',
        status: 'activa',
        invitedByUserId: null,
        joinedAt: new Date(),
      })
      .returning();
    const membership = membershipInsert[0];
    if (!membership) {
      throw new Error('Insert membership returned no row');
    }

    // 8. Si la empresa opera como transportista, crear automáticamente
    // carrier_memberships tier 'free' activa (ADR-031 §3). El consent
    // T&Cs v2 queda null hasta que el carrier acepte vía UI.
    if (empresa.isTransportista) {
      await tx.insert(carrierMemberships).values({
        empresaId: empresa.id,
        tierSlug: 'free',
        status: 'activa',
      });
    }

    logger.info(
      {
        userId: user.id,
        empresaId: empresa.id,
        rut: empresa.rut,
        planSlug: plan.slug,
        isGeneradorCarga: empresa.isGeneradorCarga,
        isTransportista: empresa.isTransportista,
      },
      'empresa onboarded',
    );

    return { user, empresa, membership };
  });
}
