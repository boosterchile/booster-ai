import type { PersonaDemo } from '@booster-ai/shared-schemas';
import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { cuentasDemo } from '../db/schema.js';

/**
 * Helper del subsistema `cuentas_demo` (T3/T4 SEC-001 Sprint 2a, ADR-053).
 *
 * Reubicado desde `seed-demo.ts` al retirar la superficie de seed/login demo
 * (`chore/retiro-subsistema-demo`, Fase 2): el seed y `POST /demo/login` se
 * eliminaron, pero `harden-demo-accounts.ts` (hardening + TTL de las cuentas
 * Firebase demo, ADR-053) sigue necesitando resolver el email determinístico
 * por persona. Se conserva acá, desacoplado del seed eliminado.
 */

/**
 * T3 SEC-001 Sprint 2a — Email determinístico por persona (ADR-053
 * post-disclosure account replacement). Usado como fallback para el primer
 * cold-start cuando `cuentas_demo` está vacía; subsecuentes lecturas vienen de
 * DB (preservando lo creado por `harden-demo-accounts.ts --recreate`).
 *
 * Naming: persona key Spanish per CLAUDE.md + spec v3.3. Email value English
 * como identificador estable. Conductor email matchea SC-1.1.1 v3.2
 * (`drivers+demo-2026-conductor@boosterchile.invalid`).
 */
const DEMO_DETERMINISTIC_EMAILS: Record<PersonaDemo, string> = {
  generador_carga: 'demo-2026-shipper@boosterchile.com',
  transportista: 'demo-2026-carrier@boosterchile.com',
  stakeholder: 'demo-2026-stakeholder@boosterchile.com',
  conductor: 'drivers+demo-2026-conductor@boosterchile.invalid',
};

/**
 * T3 SEC-001 Sprint 2a — Lookup email activo en `cuentas_demo` (persona=X AND
 * deshabilitado_en IS NULL). Si no existe row activa, INSERT con email
 * determinístico y retorna.
 *
 * Race-safe para cold-starts concurrentes en múltiples réplicas: PK sobre email
 * + `onConflictDoNothing()` previene duplicados; ambas réplicas retornan el
 * mismo email determinístico. Spec §3 H1.1 SC-1.1.8 v3.2.
 */
export async function lookupOrCreateCuentaDemoEmail(db: Db, persona: PersonaDemo): Promise<string> {
  const rows = await db
    .select({ email: cuentasDemo.email })
    .from(cuentasDemo)
    .where(and(eq(cuentasDemo.persona, persona), isNull(cuentasDemo.deshabilitadoEn)))
    .limit(1);
  if (rows[0]) {
    return rows[0].email;
  }
  const email = DEMO_DETERMINISTIC_EMAILS[persona];
  await db.insert(cuentasDemo).values({ persona, email }).onConflictDoNothing();
  return email;
}
